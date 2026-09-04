import type {
  RunStopReason,
  ToolRisk,
  TrustedToolFailure,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { readProgressDetails } from "./pi-tool-protocol.js";

export interface PiToolStartProjection {
  duplicate: boolean;
  input: unknown;
  risk: ToolRisk;
  toolCallId: string;
  toolName: string;
}

export interface PiToolProgressProjection {
  message: string;
  progress: number;
  toolCallId: string;
}

export type PiToolTerminalProjection =
  | {
      status: "completed";
      toolCallId: string;
      content: unknown;
      previousRevision: number;
      observedRevision?: number;
      designRevision?: NonNullable<TrustedToolResult["designRevision"]>;
    }
  | {
      status: "failed";
      toolCallId: string;
      code: string;
      message: string;
      retryable: boolean;
      recoverable: boolean;
      details?: NonNullable<TrustedToolFailure["details"]>;
    };

export interface ActiveToolCall extends PiToolStartProjection {
  budgetExceeded: boolean;
  inputValidated: boolean;
  revisionAtStart: number;
  sequence: number;
}

export class PiToolCallTracker {
  readonly #active = new Map<string, ActiveToolCall>();
  readonly #failures = new Map<string, TrustedToolFailure>();
  readonly #maxToolCalls: number;
  readonly #seen = new Set<string>();
  #toolCallCount = 0;
  #toolSequence = 0;

  constructor(maxToolCalls: number) {
    if (!Number.isInteger(maxToolCalls) || maxToolCalls < 0) {
      throw new RangeError("Pi tool-call limit must be a non-negative integer");
    }
    this.#maxToolCalls = maxToolCalls;
  }

  get hasPending(): boolean {
    return this.#active.size > 0;
  }

  begin(
    event: { toolCallId: string; toolName: string; args: unknown },
    revision: number,
    risk: ToolRisk,
  ): PiToolStartProjection {
    if (this.#active.has(event.toolCallId)) {
      throw new Error(`Pi started an already active tool: ${event.toolCallId}`);
    }
    const duplicate = this.#seen.has(event.toolCallId);
    const budgetExceeded =
      !duplicate && this.#toolCallCount >= this.#maxToolCalls;
    if (!duplicate) {
      this.#seen.add(event.toolCallId);
      if (!budgetExceeded) this.#toolCallCount += 1;
    }
    const active: ActiveToolCall = {
      duplicate,
      budgetExceeded,
      inputValidated: false,
      revisionAtStart: revision,
      sequence: ++this.#toolSequence,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.args,
      risk,
    };
    this.#active.set(event.toolCallId, active);
    return active;
  }

  update(
    toolCallId: string,
    partialResult: unknown,
  ): PiToolProgressProjection | undefined {
    const active = this.require(toolCallId);
    if (active.duplicate) return undefined;
    const details = readProgressDetails(partialResult);
    return { toolCallId, message: details.message, progress: details.progress };
  }

  require(toolCallId: string): ActiveToolCall {
    const active = this.#active.get(toolCallId);
    if (!active) {
      throw new Error(`Pi referenced an inactive tool call: ${toolCallId}`);
    }
    return active;
  }

  get(toolCallId: string): ActiveToolCall | undefined {
    return this.#active.get(toolCallId);
  }

  failure(toolCallId: string): TrustedToolFailure | undefined {
    return this.#failures.get(toolCallId);
  }

  setFailure(toolCallId: string, failure: TrustedToolFailure): void {
    this.#failures.set(toolCallId, failure);
  }

  acknowledge(toolCallId: string): void {
    this.require(toolCallId);
    this.#active.delete(toolCallId);
    this.#failures.delete(toolCallId);
  }

  finalize(
    stopReason: RunStopReason,
  ): Array<Extract<PiToolTerminalProjection, { status: "failed" }>> {
    const code = stopReason === "cancelled" ? "run_cancelled" : "run_error";
    const message =
      stopReason === "cancelled"
        ? "Tool call was cancelled before completion"
        : "Tool call did not complete because the run ended";
    const failures = [...this.#active.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((active) =>
        active.duplicate
          ? []
          : [
              {
                status: "failed" as const,
                toolCallId: active.toolCallId,
                code,
                message,
                retryable: false,
                recoverable: false,
              },
            ],
      );
    this.#active.clear();
    this.#failures.clear();
    return failures;
  }
}
