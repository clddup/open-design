import type {
  CanonicalStreamEvent,
  ModelGateway,
  ModelRequest,
  ModelSelection,
} from "@opendesign/model-gateway";

export type ModelStreamTimeouts = {
  firstResponseTimeoutMs: number;
  idleTimeoutMs: number;
  totalTimeoutMs: number;
};

export type ModelProviderPerformanceSample = {
  attemptId: string;
  status: "completed" | "failed" | "cancelled";
  totalMs: number;
  firstProviderEventMs: number | null;
  firstContentEventMs: number | null;
  retries: number;
};

type StreamModelProviderOptions = {
  gateway: (selection: ModelSelection) => ModelGateway;
  observePerformance?: (sample: ModelProviderPerformanceSample) => void;
  request: Omit<ModelRequest, "signal">;
  signal: AbortSignal;
  timeouts: ModelStreamTimeouts;
};

const transientRetryDelaysMs = [400, 900, 1_800, 3_200, 5_000] as const;

export async function* streamModelProvider(
  options: StreamModelProviderOptions,
): AsyncIterable<CanonicalStreamEvent> {
  const { request, signal, timeouts } = options;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });
  const startedAt = Date.now();
  let completed = false;
  let performanceReported = false;
  let firstContentEventAt: number | undefined;
  let firstProviderEventAt: number | undefined;
  let providerRequestId: string | undefined;
  let retries = 0;
  let latestAttemptStarted:
    Extract<CanonicalStreamEvent, { type: "attempt.started" }> | undefined;
  const reportPerformance = (
    status: ModelProviderPerformanceSample["status"],
  ): void => {
    if (performanceReported) return;
    performanceReported = true;
    const finishedAt = Date.now();
    try {
      options.observePerformance?.({
        attemptId: request.attemptId,
        status,
        totalMs: roundedDuration(finishedAt - startedAt),
        firstProviderEventMs:
          firstProviderEventAt === undefined
            ? null
            : roundedDuration(firstProviderEventAt - startedAt),
        firstContentEventMs:
          firstContentEventAt === undefined
            ? null
            : roundedDuration(firstContentEventAt - startedAt),
        retries,
      });
    } catch {
      // Performance observation must not change provider streaming semantics.
    }
  };

  try {
    for (
      let retryIndex = 0;
      retryIndex <= transientRetryDelaysMs.length;
      retryIndex += 1
    ) {
      providerRequestId = undefined;
      const attemptController = new AbortController();
      const abortAttempt = () =>
        attemptController.abort(controller.signal.reason);
      if (controller.signal.aborted) abortAttempt();
      else
        controller.signal.addEventListener("abort", abortAttempt, {
          once: true,
        });
      const source = options.gateway(request.modelSelection).stream({
        ...request,
        signal: attemptController.signal,
      });
      const iterator = source[Symbol.asyncIterator]();
      const attemptEvents: CanonicalStreamEvent[] = [];
      let attemptStarted:
        Extract<CanonicalStreamEvent, { type: "attempt.started" }> | undefined;
      let retry = false;
      let waitingForFirstResponse = true;
      try {
        while (true) {
          const elapsed = Date.now() - startedAt;
          const totalRemaining = timeouts.totalTimeoutMs - elapsed;
          if (totalRemaining <= 0) {
            throw modelTimeout(
              "total",
              timeouts.totalTimeoutMs,
              `Model provider timed out after the ${timeouts.totalTimeoutMs} ms total time limit`,
            );
          }
          const phaseTimeout = waitingForFirstResponse
            ? timeouts.firstResponseTimeoutMs
            : timeouts.idleTimeoutMs;
          const totalExpiresFirst = totalRemaining <= phaseTimeout;
          const timeoutMs = Math.min(phaseTimeout, totalRemaining);
          const timeoutError = modelTimeout(
            totalExpiresFirst
              ? "total"
              : waitingForFirstResponse
                ? "first-response"
                : "stream-idle",
            totalExpiresFirst ? timeouts.totalTimeoutMs : phaseTimeout,
            totalExpiresFirst
              ? `Model provider timed out after the ${timeouts.totalTimeoutMs} ms total time limit`
              : waitingForFirstResponse
                ? `Model provider timed out after ${timeouts.firstResponseTimeoutMs} ms waiting for a response`
                : `Model provider stream timed out after ${timeouts.idleTimeoutMs} ms without activity`,
          );
          const result = await nextModelEvent(
            iterator,
            attemptController,
            timeoutMs,
            timeoutError,
          );
          const event: CanonicalStreamEvent = result.done
            ? providerEndedEvent(request, providerRequestId)
            : result.value;
          if (!result.done) firstProviderEventAt ??= Date.now();
          if (event.type !== "attempt.started") {
            waitingForFirstResponse = false;
            if (isModelContentEvent(event)) firstContentEventAt ??= Date.now();
          }
          const observedRequestId = observedProviderRequestId(event);
          if (observedRequestId !== undefined) {
            providerRequestId = observedRequestId;
          }
          if (event.type === "attempt.started") {
            attemptStarted = event;
            latestAttemptStarted = event;
            continue;
          }
          if (event.type === "attempt.failed") {
            retry = shouldRetry(event.error, retryIndex);
            if (retry) break;
            completed = true;
            reportPerformance("failed");
            if (attemptStarted) yield attemptStarted;
            yield event;
            return;
          }
          if (event.type === "attempt.completed") {
            completed = true;
            reportPerformance("completed");
            if (retryIndex > 0) {
              yield {
                type: "attempt.recovered",
                attemptId: request.attemptId,
                retriesUsed: retryIndex,
                maxRetries: transientRetryDelaysMs.length,
              };
            }
            if (attemptStarted) yield attemptStarted;
            for (const buffered of attemptEvents) yield buffered;
            yield event;
            return;
          }
          attemptEvents.push(event);
        }
      } finally {
        controller.signal.removeEventListener("abort", abortAttempt);
        if (!completed && !attemptController.signal.aborted) {
          attemptController.abort(
            new DOMException("Model provider attempt closed", "AbortError"),
          );
        }
        void iterator.return?.().catch(() => undefined);
      }
      const retryDelay = transientRetryDelaysMs[retryIndex];
      if (!retry || retryDelay === undefined) return;
      retries += 1;
      yield {
        type: "attempt.retrying",
        attemptId: request.attemptId,
        retry: retryIndex + 1,
        maxRetries: transientRetryDelaysMs.length,
        delayMs: retryDelay,
      };
      await waitForProviderRetry(retryDelay, signal);
    }
  } catch (error) {
    if (error instanceof ModelStreamTimeoutError) {
      reportPerformance("failed");
      if (latestAttemptStarted) yield latestAttemptStarted;
      yield {
        type: "attempt.failed",
        attemptId: request.attemptId,
        error: {
          code: "provider_timeout",
          message: error.message,
          retryable: true,
          provider: request.modelSelection.providerId,
          ...(providerRequestId === undefined ? {} : { providerRequestId }),
          timeout: {
            phase: error.phase,
            thresholdMs: error.thresholdMs,
          },
        },
      };
      return;
    }
    reportPerformance(signal.aborted ? "cancelled" : "failed");
    throw error;
  } finally {
    if (!performanceReported) {
      reportPerformance(signal.aborted ? "cancelled" : "failed");
    }
    signal.removeEventListener("abort", abort);
    if (!completed && !controller.signal.aborted) {
      controller.abort(
        new DOMException("Model provider stream closed", "AbortError"),
      );
    }
  }
}

export function assertModelStreamTimeouts(timeouts: ModelStreamTimeouts): void {
  for (const value of Object.values(timeouts)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError("Model stream timeouts must be positive");
    }
  }
  if (timeouts.totalTimeoutMs < timeouts.firstResponseTimeoutMs) {
    throw new RangeError(
      "Model total timeout cannot be shorter than the first response timeout",
    );
  }
}

function providerEndedEvent(
  request: Omit<ModelRequest, "signal">,
  providerRequestId: string | undefined,
): Extract<CanonicalStreamEvent, { type: "attempt.failed" }> {
  return {
    type: "attempt.failed",
    attemptId: request.attemptId,
    error: {
      code: "provider_error",
      message: "Model provider stream ended without a terminal event",
      retryable: true,
      provider: request.modelSelection.providerId,
      ...(providerRequestId === undefined ? {} : { providerRequestId }),
    },
  };
}

function observedProviderRequestId(
  event: CanonicalStreamEvent,
): string | undefined {
  return event.type === "attempt.failed"
    ? event.error.providerRequestId
    : event.type === "attempt.started" || event.type === "attempt.completed"
      ? event.providerRequestId
      : undefined;
}

function nextModelEvent(
  iterator: AsyncIterator<CanonicalStreamEvent>,
  controller: AbortController,
  timeoutMs: number,
  timeoutError: Error,
): Promise<IteratorResult<CanonicalStreamEvent>> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", aborted);
    };
    const finish = (
      action: (value: IteratorResult<CanonicalStreamEvent>) => void,
      value: IteratorResult<CanonicalStreamEvent>,
    ) => {
      if (settled) return;
      settled = true;
      cleanup();
      action(value);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        error instanceof Error ? error : new Error("Model provider failed"),
      );
    };
    const aborted = () => {
      fail(
        controller.signal.reason instanceof Error
          ? controller.signal.reason
          : new DOMException("Model request cancelled", "AbortError"),
      );
    };
    const timeout = setTimeout(
      () => {
        fail(timeoutError);
        controller.abort(timeoutError);
      },
      Math.max(1, Math.ceil(timeoutMs)),
    );
    controller.signal.addEventListener("abort", aborted, { once: true });
    if (controller.signal.aborted) {
      aborted();
      return;
    }
    void iterator.next().then(
      (result) => finish(resolve, result),
      (error: unknown) => fail(error),
    );
  });
}

function shouldRetry(
  error: Extract<CanonicalStreamEvent, { type: "attempt.failed" }>["error"],
  retryIndex: number,
): boolean {
  return (
    error.retryable &&
    error.timeout === undefined &&
    (error.code === "provider_error" ||
      error.code === "provider_request_failed") &&
    retryIndex < transientRetryDelaysMs.length
  );
}

function waitForProviderRetry(
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new DOMException("Model request cancelled", "AbortError"),
    );
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", aborted);
      resolve();
    }, delayMs);
    const aborted = () => {
      clearTimeout(timeout);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new DOMException("Model request cancelled", "AbortError"),
      );
    };
    signal.addEventListener("abort", aborted, { once: true });
  });
}

class ModelStreamTimeoutError extends Error {
  constructor(
    readonly phase: "first-response" | "stream-idle" | "total",
    readonly thresholdMs: number,
    message: string,
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

function modelTimeout(
  phase: ModelStreamTimeoutError["phase"],
  thresholdMs: number,
  message: string,
): ModelStreamTimeoutError {
  return new ModelStreamTimeoutError(phase, thresholdMs, message);
}

function isModelContentEvent(event: CanonicalStreamEvent): boolean {
  return (
    event.type === "block.started" ||
    event.type === "block.delta" ||
    event.type === "block.completed"
  );
}

function roundedDuration(value: number): number {
  return Math.max(0, Math.round(value));
}
