import type { AgentEvent } from "@opendesign/agent-contracts";
import {
  isDesignDeliveryLedger,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
} from "../../shared/design-agent-tools.js";
import type { RendererDesignToolPerformanceSample } from "./renderer-design-tool-host.js";
import type { ModelProviderPerformanceSample } from "../model/model-provider-stream.js";
import type { DiagnosticInput } from "../../shared/diagnostics.js";

const MAX_ACTIVE_RUNS = 64;
const MAX_TRACKED_TOOL_CALLS = 512;

type ToolKind =
  "plan" | "mutation" | "capture" | "review" | "inspect" | "other";

type DurationAggregate = {
  count: number;
  maxMs: number;
  totalMs: number;
};

type RunState = {
  allAllocatedAtMs: number | null;
  agentTools: Record<ToolKind, DurationAggregate>;
  firstReviewedAtMs: number | null;
  firstRevisionAtMs: number | null;
  firstVerifiedAtMs: number | null;
  allVerifiedAtMs: number | null;
  model: {
    attempts: number;
    completed: number;
    failed: number;
    firstContentMs: DurationAggregate;
    firstProviderEventMs: DurationAggregate;
    retries: number;
    totalMs: DurationAggregate;
  };
  planAcceptedAtMs: number | null;
  renderer: {
    canvasWaitCount: number;
    canvasWaitMs: number;
    completed: number;
    failed: number;
    firstResponseMs: DurationAggregate;
    phaseDurationMs: Record<RendererPhase, DurationAggregate>;
    phaseProgressEvents: Record<RendererPhase, number>;
    reportedCanvasWaitTools: number;
    configuredStageDelayMs: number;
    totalMs: DurationAggregate;
  };
  startedAtMs: number;
  targetCount: number | null;
  toolCalls: Map<string, { kind: ToolKind; requestedAtMs: number }>;
  toolCallsDropped: number;
};

type RendererPhase = "accepted" | "applying" | "capturing" | "persisting";

export type DesignGenerationPerformanceSummary = {
  version: 1;
  runId: string;
  terminal: "completed" | "error";
  stopReason: string | null;
  targetCount: number | null;
  milestonesMs: {
    T_plan: number | null;
    T0: number | null;
    T1: number | null;
    T2: number | null;
    T_all: number | null;
    firstReviewed: number | null;
  };
  unavailable: { T0: null | "allocation-not-observed" };
  provider: {
    attempts: number;
    completed: number;
    failed: number;
    retries: number;
    totalMs: DurationAggregate;
    firstProviderEventMs: DurationAggregate;
    firstContentMs: DurationAggregate;
  };
  renderer: {
    canvasWaitCount: number;
    canvasWaitMs: number;
    completed: number;
    failed: number;
    totalMs: DurationAggregate;
    firstResponseMs: DurationAggregate;
    phaseDurationMs: Record<RendererPhase, DurationAggregate>;
    phaseProgressEvents: Record<RendererPhase, number>;
    reportedCanvasWaitTools: number;
    configuredStageDelayMs: number;
  };
  agentTools: Record<ToolKind, DurationAggregate>;
  droppedToolCalls: number;
};

export function designGenerationPerformanceDiagnostic(
  summary: DesignGenerationPerformanceSummary,
  conversationId?: string,
): DiagnosticInput {
  return {
    level: "info",
    source: "agent",
    presentation: "silent",
    code: "design_generation_performance_v1",
    message: JSON.stringify(summary),
    context: {
      runId: summary.runId,
      ...(conversationId ? { conversationId } : {}),
    },
  };
}

export class DesignGenerationPerformanceTracker {
  readonly #runs = new Map<string, RunState>();

  constructor(private readonly now: () => number = Date.now) {}

  forgetRun(runId: string): void {
    this.#runs.delete(runId);
  }

  recordAgentEvent(
    event: AgentEvent,
  ): DesignGenerationPerformanceSummary | null {
    if (event.type === "run.started") {
      const startedAtMs = timestampMs(event.startedAt, this.now());
      const existing = this.#runs.get(event.runId);
      if (existing) {
        existing.startedAtMs = Math.min(existing.startedAtMs, startedAtMs);
      } else {
        this.#startRun(event.runId, startedAtMs);
      }
      return null;
    }
    const runId = "runId" in event ? event.runId : undefined;
    if (!runId) return null;
    const state = this.#runs.get(runId);
    if (!state) return null;
    const observedAtMs = this.now();

    if (event.type === "tool.requested") {
      const kind = classifyTool(event.toolName);
      if (state.toolCalls.size < MAX_TRACKED_TOOL_CALLS) {
        state.toolCalls.set(event.toolCallId, {
          kind,
          requestedAtMs: observedAtMs,
        });
      } else {
        state.toolCallsDropped += 1;
      }
      return null;
    }
    if (event.type === "tool.completed") {
      const tracked = state.toolCalls.get(event.toolCallId);
      state.toolCalls.delete(event.toolCallId);
      if (tracked) {
        addDuration(
          state.agentTools[tracked.kind],
          observedAtMs - tracked.requestedAtMs,
        );
      }
      const delivery = deliveryFromResult(event.result);
      if (tracked?.kind === "plan") {
        state.planAcceptedAtMs ??= observedAtMs;
        if (delivery) state.targetCount = delivery.targets.length;
      }
      this.#recordDeliveryMilestones(
        state,
        delivery,
        event.revision,
        observedAtMs,
      );
      return null;
    }
    if (event.type === "tool.failed") {
      const tracked = state.toolCalls.get(event.toolCallId);
      state.toolCalls.delete(event.toolCallId);
      if (tracked) {
        addDuration(
          state.agentTools[tracked.kind],
          observedAtMs - tracked.requestedAtMs,
        );
      }
      return null;
    }
    if (event.type === "run.completed") {
      return this.#finishRun(runId, "completed", event.stopReason);
    }
    if (event.type === "agent.error") {
      return this.#finishRun(runId, "error", null);
    }
    return null;
  }

  recordModelProvider(sample: ModelProviderPerformanceSample): void {
    const runId = runIdFromAttemptId(sample.attemptId);
    if (!runId) return;
    const state = this.#runs.get(runId);
    if (!state) return;
    state.model.attempts += 1;
    state.model.retries += sample.retries;
    if (sample.status === "completed") state.model.completed += 1;
    else state.model.failed += 1;
    addDuration(state.model.totalMs, sample.totalMs);
    if (sample.firstProviderEventMs !== null) {
      addDuration(
        state.model.firstProviderEventMs,
        sample.firstProviderEventMs,
      );
    }
    if (sample.firstContentEventMs !== null) {
      addDuration(state.model.firstContentMs, sample.firstContentEventMs);
    }
  }

  recordRendererTool(sample: RendererDesignToolPerformanceSample): void {
    let state = this.#runs.get(sample.runId);
    if (!state) {
      this.#startRun(sample.runId, this.now() - sample.totalMs);
      state = this.#runs.get(sample.runId);
    }
    if (!state) return;
    if (sample.status === "completed") state.renderer.completed += 1;
    else state.renderer.failed += 1;
    addDuration(state.renderer.totalMs, sample.totalMs);
    if (
      sample.canvasWaitCount !== null &&
      sample.canvasWaitMs !== null &&
      sample.configuredStageDelayMs !== null
    ) {
      state.renderer.reportedCanvasWaitTools += 1;
      state.renderer.canvasWaitCount += sample.canvasWaitCount;
      state.renderer.canvasWaitMs += sample.canvasWaitMs;
      state.renderer.configuredStageDelayMs += sample.configuredStageDelayMs;
    }
    if (sample.firstResponseMs !== null) {
      addDuration(state.renderer.firstResponseMs, sample.firstResponseMs);
    }
    for (const phase of rendererPhases) {
      addDuration(
        state.renderer.phaseDurationMs[phase],
        sample.phaseDurationMs[phase],
      );
      state.renderer.phaseProgressEvents[phase] +=
        sample.phaseProgressEvents[phase];
    }
  }

  #startRun(runId: string, startedAtMs: number): void {
    if (!this.#runs.has(runId) && this.#runs.size >= MAX_ACTIVE_RUNS) {
      const oldestRunId = this.#runs.keys().next().value;
      if (oldestRunId) this.#runs.delete(oldestRunId);
    }
    this.#runs.set(runId, createRunState(startedAtMs));
  }

  #recordDeliveryMilestones(
    state: RunState,
    delivery: DesignDeliveryLedger | null,
    revision: number | undefined,
    observedAtMs: number,
  ): void {
    if (!delivery) return;
    state.targetCount = delivery.targets.length;
    if (delivery.targets.every((target) => target.status !== "pending")) {
      state.allAllocatedAtMs ??= observedAtMs;
    }
    if (
      revision !== undefined &&
      delivery.targets.some(
        (target) =>
          target.status !== "pending" && target.status !== "allocated",
      )
    ) {
      state.firstRevisionAtMs ??= observedAtMs;
    }
    if (delivery.targets.some((target) => target.status === "reviewed")) {
      state.firstReviewedAtMs ??= observedAtMs;
    }
    if (delivery.targets.some((target) => target.status === "verified")) {
      state.firstVerifiedAtMs ??= observedAtMs;
    }
    if (delivery.targets.every((target) => target.status === "verified")) {
      state.allVerifiedAtMs ??= observedAtMs;
    }
  }

  #finishRun(
    runId: string,
    terminal: "completed" | "error",
    stopReason: string | null,
  ): DesignGenerationPerformanceSummary | null {
    const state = this.#runs.get(runId);
    if (!state) return null;
    this.#runs.delete(runId);
    if (state.planAcceptedAtMs === null) return null;
    return {
      version: 1,
      runId,
      terminal,
      stopReason,
      targetCount: state.targetCount,
      milestonesMs: {
        T_plan: elapsedMs(state.startedAtMs, state.planAcceptedAtMs),
        T0: elapsedMs(state.startedAtMs, state.allAllocatedAtMs),
        T1: elapsedMs(state.startedAtMs, state.firstRevisionAtMs),
        T2: elapsedMs(state.startedAtMs, state.firstVerifiedAtMs),
        T_all: elapsedMs(state.startedAtMs, state.allVerifiedAtMs),
        firstReviewed: elapsedMs(state.startedAtMs, state.firstReviewedAtMs),
      },
      unavailable: {
        T0: state.allAllocatedAtMs === null ? "allocation-not-observed" : null,
      },
      provider: structuredClone(state.model),
      renderer: structuredClone(state.renderer),
      agentTools: structuredClone(state.agentTools),
      droppedToolCalls: state.toolCallsDropped,
    };
  }
}

const rendererPhases: readonly RendererPhase[] = [
  "accepted",
  "applying",
  "capturing",
  "persisting",
];

function createRunState(startedAtMs: number): RunState {
  return {
    allAllocatedAtMs: null,
    agentTools: {
      plan: emptyAggregate(),
      mutation: emptyAggregate(),
      capture: emptyAggregate(),
      review: emptyAggregate(),
      inspect: emptyAggregate(),
      other: emptyAggregate(),
    },
    firstReviewedAtMs: null,
    firstRevisionAtMs: null,
    firstVerifiedAtMs: null,
    allVerifiedAtMs: null,
    model: {
      attempts: 0,
      completed: 0,
      failed: 0,
      firstContentMs: emptyAggregate(),
      firstProviderEventMs: emptyAggregate(),
      retries: 0,
      totalMs: emptyAggregate(),
    },
    planAcceptedAtMs: null,
    renderer: {
      canvasWaitCount: 0,
      canvasWaitMs: 0,
      completed: 0,
      failed: 0,
      firstResponseMs: emptyAggregate(),
      phaseDurationMs: {
        accepted: emptyAggregate(),
        applying: emptyAggregate(),
        capturing: emptyAggregate(),
        persisting: emptyAggregate(),
      },
      phaseProgressEvents: {
        accepted: 0,
        applying: 0,
        capturing: 0,
        persisting: 0,
      },
      reportedCanvasWaitTools: 0,
      configuredStageDelayMs: 0,
      totalMs: emptyAggregate(),
    },
    startedAtMs,
    targetCount: null,
    toolCalls: new Map(),
    toolCallsDropped: 0,
  };
}

function classifyTool(toolName: string): ToolKind {
  if (
    toolName === DESIGN_PLAN_TOOL_NAME ||
    toolName === DESIGN_FIRST_SLICE_TOOL_NAME
  )
    return "plan";
  if (toolName === DESIGN_CAPTURE_TOOL_NAME) return "capture";
  if (toolName === DESIGN_REVIEW_TOOL_NAME) return "review";
  if (toolName === DESIGN_INSPECT_TOOL_NAME) return "inspect";
  if (
    toolName.startsWith("opendesign_") &&
    !toolName.includes("export") &&
    !toolName.includes("request_") &&
    !toolName.includes("read_")
  ) {
    return "mutation";
  }
  return "other";
}

function deliveryFromResult(result: unknown): DesignDeliveryLedger | null {
  if (!record(result)) return null;
  return isDesignDeliveryLedger(result.delivery) ? result.delivery : null;
}

function runIdFromAttemptId(attemptId: string): string | null {
  const match = /^(.*)_attempt_[1-9]\d*$/.exec(attemptId);
  return match?.[1] || null;
}

function addDuration(aggregate: DurationAggregate, value: number): void {
  if (!Number.isFinite(value)) return;
  const duration = Math.max(0, Math.round(value));
  aggregate.count += 1;
  aggregate.totalMs += duration;
  aggregate.maxMs = Math.max(aggregate.maxMs, duration);
}

function emptyAggregate(): DurationAggregate {
  return { count: 0, maxMs: 0, totalMs: 0 };
}

function elapsedMs(startedAtMs: number, value: number | null): number | null {
  return value === null ? null : Math.max(0, Math.round(value - startedAtMs));
}

function timestampMs(value: string, fallback: number): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
