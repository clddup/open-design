import type { TrustedToolFailure } from "@opendesign/agent-contracts";

const MAX_CONSECUTIVE_INVALID_INPUTS_PER_TOOL = 2;
const MAX_RECOVERABLE_FAILURES_WITHOUT_REVISION = 4;

/**
 * Bounds model-driven recovery by user-visible document progress rather than
 * exact input fingerprints. Different malformed arguments are still the same
 * stalled recovery when no trusted design revision advances.
 */
export class PiToolProgressCircuit {
  readonly #invalidInputsByTool = new Map<string, number>();
  #recoverableFailuresWithoutRevision = 0;

  recordFailure(
    toolName: string,
    failure: TrustedToolFailure,
  ): TrustedToolFailure {
    if (!failure.recoverable || failure.runTerminal) return failure;

    this.#recoverableFailuresWithoutRevision += 1;
    if (failure.code === "invalid_tool_input") {
      const invalidInputs = (this.#invalidInputsByTool.get(toolName) ?? 0) + 1;
      this.#invalidInputsByTool.set(toolName, invalidInputs);
      if (invalidInputs >= MAX_CONSECUTIVE_INVALID_INPUTS_PER_TOOL) {
        return terminalFailure(
          "tool_protocol_no_progress",
          `${toolName} produced ${invalidInputs} consecutive invalid tool calls without a successful document revision. The selected model/provider is not reliably following this tool contract, so the run was stopped instead of continuing an invisible retry loop.`,
        );
      }
    }

    if (
      this.#recoverableFailuresWithoutRevision >=
      MAX_RECOVERABLE_FAILURES_WITHOUT_REVISION
    ) {
      return terminalFailure(
        "design_recovery_no_progress",
        `The run produced ${this.#recoverableFailuresWithoutRevision} recoverable tool failures without advancing the design document. The run was stopped instead of continuing an invisible recovery loop. Already committed revisions are preserved.`,
      );
    }
    return failure;
  }

  recordSuccess(toolName: string, revisionAdvanced: boolean): void {
    this.#invalidInputsByTool.delete(toolName);
    if (!revisionAdvanced) return;
    this.#recoverableFailuresWithoutRevision = 0;
    this.#invalidInputsByTool.clear();
  }
}

function terminalFailure(code: string, message: string): TrustedToolFailure {
  return {
    code,
    message,
    retryable: false,
    recoverable: false,
    runTerminal: true,
  };
}
