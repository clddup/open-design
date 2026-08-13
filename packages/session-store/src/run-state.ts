export interface SessionRunFailure {
  code: string;
  message: string;
  retryable: boolean;
  provider?: string;
  providerRequestId?: string;
  modelRequestId?: string;
  timeout?: {
    phase: "first-response" | "stream-idle" | "total";
    thresholdMs: number;
  };
}

export interface SessionRunContinuation {
  parentRunId: string;
  rootRunId: string;
  attempt: 1 | 2 | 3;
  maxAttempts: 3;
  reason: "incomplete" | "budget" | "retryable-error";
}

export type RunStopReason = "complete" | "cancelled" | "error" | "budget";
export type ModelReasoningEffort =
  "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export interface SessionModelSelection {
  providerId: string;
  modelId: string;
  reasoningEffort?: ModelReasoningEffort;
}

export interface RunStatePayload {
  status: "started" | "completed" | "cancelled" | "error" | "budget";
  startedAt: string;
  finishedAt?: string;
  stopReason?: RunStopReason;
  modelSelection?: SessionModelSelection;
  failure?: SessionRunFailure;
  continuation?: SessionRunContinuation;
}

export function isRunStatus(
  value: unknown,
): value is RunStatePayload["status"] {
  return ["started", "completed", "cancelled", "error", "budget"].includes(
    String(value),
  );
}

export function isRunStopReason(value: unknown): value is RunStopReason {
  return ["complete", "cancelled", "error", "budget"].includes(String(value));
}

export function isModelSelection(
  value: unknown,
): value is SessionModelSelection {
  return (
    isRecord(value) &&
    boundedIdentifier(value.providerId) &&
    boundedIdentifier(value.modelId) &&
    (value.reasoningEffort === undefined ||
      (typeof value.reasoningEffort === "string" &&
        ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(
          value.reasoningEffort,
        )))
  );
}

export function isRunFailure(value: unknown): value is SessionRunFailure {
  if (
    !isRecord(value) ||
    !boundedIdentifier(value.code) ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 20_000 ||
    typeof value.retryable !== "boolean" ||
    (value.provider !== undefined && !boundedIdentifier(value.provider)) ||
    (value.providerRequestId !== undefined &&
      !boundedIdentifier(value.providerRequestId)) ||
    (value.modelRequestId !== undefined &&
      !boundedIdentifier(value.modelRequestId))
  ) {
    return false;
  }
  if (
    value.timeout !== undefined &&
    (!isRecord(value.timeout) ||
      !["first-response", "stream-idle", "total"].includes(
        String(value.timeout.phase),
      ) ||
      !Number.isInteger(value.timeout.thresholdMs) ||
      Number(value.timeout.thresholdMs) < 1 ||
      Number(value.timeout.thresholdMs) > 86_400_000 ||
      Object.keys(value.timeout).some(
        (key) => !["phase", "thresholdMs"].includes(key),
      ))
  ) {
    return false;
  }
  return Object.keys(value).every((key) =>
    [
      "code",
      "message",
      "retryable",
      "provider",
      "providerRequestId",
      "modelRequestId",
      "timeout",
    ].includes(key),
  );
}

export function isRunContinuation(
  value: unknown,
): value is SessionRunContinuation {
  return (
    isRecord(value) &&
    boundedIdentifier(value.parentRunId) &&
    boundedIdentifier(value.rootRunId) &&
    (value.attempt === 1 || value.attempt === 2 || value.attempt === 3) &&
    value.maxAttempts === 3 &&
    ["incomplete", "budget", "retryable-error"].includes(
      String(value.reason),
    ) &&
    Object.keys(value).length === 5
  );
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
