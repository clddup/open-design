import type { TrustedToolFailure } from "@opendesign/agent-contracts";

const MAX_REPEATED_INVALID_INPUTS = 2;
const MAX_REPEATED_RECOVERABLE_FAILURES = 2;

/**
 * Bounds model-driven recovery by stable root cause. Unrelated deterministic
 * failures must not be accumulated into a fake loop merely because no write
 * occurred between them; repeating one contract fingerprint is a real loop.
 */
export class PiToolProgressCircuit {
  readonly #invalidInputsByFingerprint = new Map<string, number>();
  readonly #recoverableFailuresByFingerprint = new Map<string, number>();

  recordFailure(
    toolName: string,
    failure: TrustedToolFailure,
  ): TrustedToolFailure {
    if (!failure.recoverable || failure.runTerminal) return failure;

    if (failure.code === "invalid_tool_input") {
      const fingerprint = failureFingerprint(toolName, failure);
      const invalidInputs =
        (this.#invalidInputsByFingerprint.get(fingerprint) ?? 0) + 1;
      this.#invalidInputsByFingerprint.set(fingerprint, invalidInputs);
      if (invalidInputs >= MAX_REPEATED_INVALID_INPUTS) {
        return terminalFailure(
          "tool_protocol_no_progress",
          `${toolName} repeated the same invalid tool input ${invalidInputs} times without a successful document revision. The run was stopped instead of continuing an invisible retry loop.`,
          failure,
        );
      }
      return failure;
    }

    // This is a host sequencing guard, not another occurrence of the
    // underlying document failure. Counting it would terminate before the
    // required inspection can run.
    if (failure.code === "design_inspection_required") return failure;

    const fingerprint = failureFingerprint(toolName, failure);
    const recoverableFailures =
      (this.#recoverableFailuresByFingerprint.get(fingerprint) ?? 0) + 1;
    this.#recoverableFailuresByFingerprint.set(
      fingerprint,
      recoverableFailures,
    );

    if (recoverableFailures >= MAX_REPEATED_RECOVERABLE_FAILURES) {
      return terminalFailure(
        "design_recovery_no_progress",
        `The run repeated the same recoverable design failure ${recoverableFailures} times without advancing the design document. The run was stopped instead of continuing an invisible recovery loop. Already committed revisions are preserved.`,
        failure,
      );
    }
    return failure;
  }

  recordSuccess(_toolName: string, revisionAdvanced: boolean): void {
    if (!revisionAdvanced) return;
    this.#recoverableFailuresByFingerprint.clear();
    this.#invalidInputsByFingerprint.clear();
  }
}

function failureFingerprint(
  toolName: string,
  failure: TrustedToolFailure,
): string {
  const structured = failure.details?.fingerprint;
  if (structured) return `${toolName}:${structured}`;
  const workflowCode = /^(design(?:_workflow)?\.[a-z0-9_.-]+):/i.exec(
    failure.message,
  )?.[1];
  return `${toolName}:${failure.code}:${workflowCode ?? failure.message}`;
}

function terminalFailure(
  code: string,
  message: string,
  source: TrustedToolFailure,
): TrustedToolFailure {
  return {
    code,
    message,
    retryable: false,
    recoverable: false,
    runTerminal: true,
    ...(source.details ? { details: source.details } : {}),
  };
}
