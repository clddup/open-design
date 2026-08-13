import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import {
  isDesignDeliveryLedger,
  type DesignDeliveryLedger,
} from "@opendesign/workspace-contracts";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;
type AgentRunContinuation = NonNullable<RunStartRequest["continuation"]>;
type AgentContinuationReason = AgentRunContinuation["reason"];

export type AgentContinuationDecision =
  | {
      kind: "schedule";
      continuation: AgentRunContinuation;
      nextRunId: string;
      source: RunStartRequest;
    }
  | {
      kind: "needs-attention";
      attempt: 1 | 2 | 3;
      maxAttempts: 3;
      reason: AgentContinuationReason;
    };

const MAX_CONTINUATION_ATTEMPTS = 3 as const;
export const AGENT_CONTINUATION_PROMPT =
  "Automatically continue the unfinished design delivery from the previous Run. First inspect the current document and its unfinishedDelivery ledger, preserve every stable target/Page/Frame identity and committed revision, then resume from the first incomplete target. Do not ask the user to send continue and do not declare completion until every target is verified.";

export class AgentContinuationScheduler {
  readonly #deliveryByRunId = new Map<string, DesignDeliveryLedger>();
  readonly #failureByRunId = new Map<
    string,
    Extract<AgentEvent, { type: "agent.error" }>["failure"]
  >();
  readonly #requestsByRunId = new Map<string, RunStartRequest>();
  #sequence = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  registerRun(request: RunStartRequest): void {
    this.#requestsByRunId.set(request.runId, structuredClone(request));
  }

  forgetRun(runId: string): void {
    this.#requestsByRunId.delete(runId);
    this.#deliveryByRunId.delete(runId);
    this.#failureByRunId.delete(runId);
  }

  record(event: AgentEvent): AgentContinuationDecision | null {
    const runId = "runId" in event ? event.runId : undefined;
    if (!runId) return null;
    const delivery = deliveryFromEvent(event);
    if (delivery) this.#deliveryByRunId.set(runId, structuredClone(delivery));
    if (event.type === "agent.error") {
      this.#failureByRunId.set(runId, event.failure);
      return null;
    }
    if (event.type !== "run.completed") return null;

    const source = this.#requestsByRunId.get(runId);
    const currentDelivery = this.#deliveryByRunId.get(runId);
    const failure = this.#failureByRunId.get(runId);
    this.#requestsByRunId.delete(runId);
    this.#deliveryByRunId.delete(runId);
    this.#failureByRunId.delete(runId);
    if (!source || !currentDelivery || !hasIncompleteTarget(currentDelivery))
      return null;
    if (event.stopReason === "cancelled") return null;

    const reason = continuationReason(event.stopReason);
    if (!reason) return null;
    const previousAttempt = source.continuation?.attempt ?? 0;
    const nextAttempt = previousAttempt + 1;
    if (
      nextAttempt > MAX_CONTINUATION_ATTEMPTS ||
      failure?.retryable === false
    ) {
      return {
        kind: "needs-attention",
        attempt: clampAttempt(Math.max(previousAttempt, 1)),
        maxAttempts: MAX_CONTINUATION_ATTEMPTS,
        reason: failure?.retryable === false ? "non-retryable-error" : reason,
      };
    }
    const nextRunId = `run_${this.now()}_auto_${++this.#sequence}`;
    this.#deliveryByRunId.set(nextRunId, structuredClone(currentDelivery));
    return {
      kind: "schedule",
      source: structuredClone(source),
      nextRunId,
      continuation: {
        parentRunId: runId,
        rootRunId: source.continuation?.rootRunId ?? runId,
        attempt: clampAttempt(nextAttempt),
        maxAttempts: MAX_CONTINUATION_ATTEMPTS,
        reason,
      },
    };
  }
}

function deliveryFromEvent(
  event: AgentEvent,
): DesignDeliveryLedger | undefined {
  if (event.type !== "tool.completed" || !isRecord(event.result))
    return undefined;
  if (isDesignDeliveryLedger(event.result.delivery))
    return event.result.delivery;
  return isDesignDeliveryLedger(event.result.unfinishedDelivery)
    ? event.result.unfinishedDelivery
    : undefined;
}

function hasIncompleteTarget(delivery: DesignDeliveryLedger | undefined) {
  return Boolean(
    delivery &&
    delivery.activeTargetId !== null &&
    delivery.targets.some((target) => target.status !== "verified"),
  );
}

function continuationReason(
  stopReason: Extract<AgentEvent, { type: "run.completed" }>["stopReason"],
): AgentContinuationReason | null {
  if (stopReason === "complete") return "incomplete";
  if (stopReason === "budget") return "budget";
  if (stopReason === "error") return "retryable-error";
  return null;
}

function clampAttempt(value: number): 1 | 2 | 3 {
  return Math.min(MAX_CONTINUATION_ATTEMPTS, Math.max(1, value)) as 1 | 2 | 3;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
