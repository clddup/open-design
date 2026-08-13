import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import type {
  RendererDesignCaptureTarget,
  RendererDesignToolPerformance,
  RendererDesignToolCancel,
  RendererDesignToolProgress,
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../../shared/design-tool-bridge";

type PendingRequest = {
  context: TrustedToolContext;
  currentPhase?: RendererDesignToolProgress["phase"];
  currentPhaseStartedAt?: number;
  firstResponseTimeout: ReturnType<typeof setTimeout>;
  firstResponseMs: number | null;
  idleTimeout?: ReturnType<typeof setTimeout>;
  phaseDurationMs: Record<RendererDesignToolProgress["phase"], number>;
  phaseProgressEvents: Record<RendererDesignToolProgress["phase"], number>;
  reportProgress?: (message: string, progress: number) => void;
  reject: (error: Error) => void;
  resolve: (result: TrustedToolResult) => void;
  startedAt: number;
  toolCallId: string;
  toolName: string;
  totalTimeout: ReturnType<typeof setTimeout>;
};

type RendererCircuitState = {
  consecutiveTimeouts: number;
  open: boolean;
};

export type RendererDesignToolPerformanceSample = {
  runId: string;
  toolCallId: string;
  toolName: string;
  status: "completed" | "failed" | "cancelled" | "timeout";
  canvasWaitCount: number | null;
  canvasWaitMs: number | null;
  configuredStageDelayMs: number | null;
  totalMs: number;
  firstResponseMs: number | null;
  phaseDurationMs: Record<RendererDesignToolProgress["phase"], number>;
  phaseProgressEvents: Record<RendererDesignToolProgress["phase"], number>;
};

export interface RendererDesignToolTimeouts {
  firstResponseTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
}

const DEFAULT_RENDERER_TOOL_TIMEOUTS: RendererDesignToolTimeouts = {
  firstResponseTimeoutMs: 30_000,
  idleTimeoutMs: 90_000,
  totalTimeoutMs: 15 * 60_000,
};
const RENDERER_CIRCUIT_TIMEOUT_THRESHOLD = 2;

export class RendererDesignToolHost {
  readonly #pending = new Map<string, PendingRequest>();
  readonly #circuitsByRunId = new Map<string, RendererCircuitState>();
  #performanceObserver?: (sample: RendererDesignToolPerformanceSample) => void;
  #sequence = 0;

  constructor(
    private readonly send: (request: RendererDesignToolRequest) => void,
    private readonly sendCancel: (
      request: RendererDesignToolCancel,
    ) => void = () => undefined,
    private readonly timeouts: RendererDesignToolTimeouts = DEFAULT_RENDERER_TOOL_TIMEOUTS,
  ) {}

  setPerformanceObserver(
    observer: (sample: RendererDesignToolPerformanceSample) => void,
  ): void {
    this.#performanceObserver = observer;
  }

  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    options: {
      captureTarget?: RendererDesignCaptureTarget;
      reportProgress?: (message: string, progress: number) => void;
    } = {},
  ): Promise<TrustedToolResult> {
    if (this.#circuitsByRunId.get(context.runId)?.open) {
      return Promise.reject(rendererCircuitOpen());
    }
    const requestId = `renderer_tool_${Date.now()}_${++this.#sequence}`;
    return new Promise((resolve, reject) => {
      const failTimeout = (
        phase: "first-response" | "idle" | "total",
        thresholdMs: number,
      ) => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        this.#pending.delete(requestId);
        clearPendingTimeouts(pending);
        this.sendCancel({ requestId });
        this.#recordPerformance(pending, "timeout");
        pending.reject(
          this.#recordTimeout(pending)
            ? rendererCircuitOpen()
            : rendererToolTimeout(phase, thresholdMs),
        );
      };
      const firstResponseTimeout = setTimeout(
        () =>
          failTimeout("first-response", this.timeouts.firstResponseTimeoutMs),
        this.timeouts.firstResponseTimeoutMs,
      );
      const totalTimeout = setTimeout(
        () => failTimeout("total", this.timeouts.totalTimeoutMs),
        this.timeouts.totalTimeoutMs,
      );
      const abort = () => {
        const pending = this.#pending.get(requestId);
        if (!pending) return;
        clearPendingTimeouts(pending);
        this.#pending.delete(requestId);
        this.sendCancel({ requestId });
        this.#recordPerformance(pending, "cancelled");
        reject(new Error("Renderer design tool was cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.#pending.set(requestId, {
        context,
        resolve: (result) => {
          signal.removeEventListener("abort", abort);
          resolve(result);
        },
        reject: (error) => {
          signal.removeEventListener("abort", abort);
          reject(error);
        },
        firstResponseTimeout,
        firstResponseMs: null,
        phaseDurationMs: emptyPhaseNumbers(),
        phaseProgressEvents: emptyPhaseNumbers(),
        ...(options.reportProgress
          ? { reportProgress: options.reportProgress }
          : {}),
        startedAt: Date.now(),
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        totalTimeout,
      });
      try {
        this.send({ requestId, call, context, ...options });
      } catch (error) {
        const pending = this.#pending.get(requestId);
        if (pending) clearPendingTimeouts(pending);
        this.#pending.delete(requestId);
        signal.removeEventListener("abort", abort);
        if (pending) this.#recordPerformance(pending, "failed");
        reject(
          error instanceof Error
            ? error
            : new Error("Renderer design tool dispatch failed"),
        );
      }
    });
  }

  progress(progress: RendererDesignToolProgress): boolean {
    const pending = this.#pending.get(progress.requestId);
    if (!pending) return false;
    const observedAt = Date.now();
    pending.firstResponseMs ??= observedAt - pending.startedAt;
    pending.phaseProgressEvents[progress.phase] += 1;
    if (progress.message) {
      pending.reportProgress?.(progress.message, progress.progress);
    }
    if (pending.currentPhase !== progress.phase) {
      finishCurrentPhase(pending, observedAt);
      pending.currentPhase = progress.phase;
      pending.currentPhaseStartedAt = observedAt;
    }
    clearTimeout(pending.firstResponseTimeout);
    if (pending.idleTimeout !== undefined) {
      clearTimeout(pending.idleTimeout);
    }
    pending.idleTimeout = setTimeout(() => {
      const active = this.#pending.get(progress.requestId);
      if (!active) return;
      this.#pending.delete(progress.requestId);
      clearPendingTimeouts(active);
      this.sendCancel({ requestId: progress.requestId });
      this.#recordPerformance(active, "timeout");
      active.reject(
        this.#recordTimeout(active)
          ? rendererCircuitOpen()
          : rendererToolTimeout(
              "idle",
              this.timeouts.idleTimeoutMs,
              progress.phase,
            ),
      );
    }, this.timeouts.idleTimeoutMs);
    return true;
  }

  resolve(response: RendererDesignToolResponse): boolean {
    const pending = this.#pending.get(response.requestId);
    if (!pending) return false;
    clearPendingTimeouts(pending);
    this.#pending.delete(response.requestId);
    this.#recordPerformance(
      pending,
      response.ok ? "completed" : "failed",
      response.performance,
    );
    if (response.ok && didPerformCanvasWork(pending)) {
      this.#circuitsByRunId.delete(pending.context.runId);
    }
    if (response.ok) pending.resolve(response.result);
    else
      pending.reject(
        new Error(response.error.message, { cause: response.error }),
      );
    return true;
  }

  rejectAll(message: string): void {
    for (const [requestId, pending] of this.#pending) {
      clearPendingTimeouts(pending);
      this.sendCancel({ requestId });
      this.#recordPerformance(pending, "failed");
      pending.reject(new Error(message));
    }
    this.#pending.clear();
    this.#circuitsByRunId.clear();
  }

  forgetRun(runId: string): void {
    this.#circuitsByRunId.delete(runId);
  }

  #recordTimeout(pending: PendingRequest): boolean {
    if (!didPerformCanvasWork(pending)) return false;
    const current = this.#circuitsByRunId.get(pending.context.runId) ?? {
      consecutiveTimeouts: 0,
      open: false,
    };
    current.consecutiveTimeouts += 1;
    current.open =
      current.consecutiveTimeouts >= RENDERER_CIRCUIT_TIMEOUT_THRESHOLD;
    this.#circuitsByRunId.set(pending.context.runId, current);
    return current.open;
  }

  #recordPerformance(
    pending: PendingRequest,
    status: RendererDesignToolPerformanceSample["status"],
    performance?: RendererDesignToolPerformance,
  ): void {
    const finishedAt = Date.now();
    finishCurrentPhase(pending, finishedAt);
    try {
      this.#performanceObserver?.({
        runId: pending.context.runId,
        toolCallId: pending.toolCallId,
        toolName: pending.toolName,
        status,
        canvasWaitCount: performance?.canvasWaitCount ?? null,
        canvasWaitMs: performance?.canvasWaitMs ?? null,
        configuredStageDelayMs: performance?.configuredStageDelayMs ?? null,
        totalMs: roundedDuration(finishedAt - pending.startedAt),
        firstResponseMs:
          pending.firstResponseMs === null
            ? null
            : roundedDuration(pending.firstResponseMs),
        phaseDurationMs: { ...pending.phaseDurationMs },
        phaseProgressEvents: { ...pending.phaseProgressEvents },
      });
    } catch {
      // Performance observation must never change tool execution semantics.
    }
  }
}

function didPerformCanvasWork(pending: PendingRequest): boolean {
  return (
    pending.phaseProgressEvents.applying > 0 ||
    pending.phaseProgressEvents.capturing > 0
  );
}

function finishCurrentPhase(pending: PendingRequest, finishedAt: number): void {
  if (
    pending.currentPhase === undefined ||
    pending.currentPhaseStartedAt === undefined
  ) {
    return;
  }
  pending.phaseDurationMs[pending.currentPhase] += roundedDuration(
    finishedAt - pending.currentPhaseStartedAt,
  );
  pending.currentPhaseStartedAt = finishedAt;
}

function emptyPhaseNumbers(): Record<
  RendererDesignToolProgress["phase"],
  number
> {
  return { accepted: 0, applying: 0, capturing: 0, persisting: 0 };
}

function roundedDuration(value: number): number {
  return Math.max(0, Math.round(value));
}

function clearPendingTimeouts(pending: PendingRequest): void {
  clearTimeout(pending.firstResponseTimeout);
  if (pending.idleTimeout !== undefined) clearTimeout(pending.idleTimeout);
  clearTimeout(pending.totalTimeout);
}

function rendererToolTimeout(
  phase: "first-response" | "idle" | "total",
  thresholdMs: number,
  activity?: RendererDesignToolProgress["phase"],
): Error {
  const activityDetail = activity ? ` during ${activity}` : "";
  const message =
    phase === "first-response"
      ? `renderer_tool.timeout.first_response: Renderer did not acknowledge the design tool within ${thresholdMs} ms`
      : phase === "idle"
        ? `renderer_tool.timeout.idle: Renderer design work made no progress for ${thresholdMs} ms${activityDetail}`
        : `renderer_tool.timeout.total: Renderer design work exceeded the ${thresholdMs} ms total limit`;
  return new Error(message, {
    cause: {
      code: `renderer_${phase.replace("-", "_")}_timeout`,
      message,
      retryable: true,
      recoverable: true,
    } satisfies TrustedToolFailure,
  });
}

function rendererCircuitOpen(): Error {
  const message =
    "renderer_tool.circuit_open: Canvas rendering repeatedly stalled in this task. OpenDesign stopped the task to preserve committed revisions. Restart OpenDesign before retrying visual generation.";
  return new Error(message, {
    cause: {
      code: "renderer_circuit_open",
      message,
      retryable: false,
      recoverable: false,
      runTerminal: true,
    } satisfies TrustedToolFailure,
  });
}
