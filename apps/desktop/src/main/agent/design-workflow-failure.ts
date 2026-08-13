import type { TrustedToolFailure } from "@opendesign/agent-runtime";

const INSPECT_AND_REVISE = {
  action: "inspect-and-revise" as const,
  toolName: "opendesign_inspect_document" as const,
  required: true as const,
};

export function trustedDesignWorkflowFailure(
  error: Error,
): TrustedToolFailure | undefined {
  const message = error.message;
  if (message.startsWith("design_workflow.plan_amendment_invalid:")) {
    return failure(
      "design_plan_amendment_invalid",
      message,
      "Preserve every material targetId, pageId, artboard frameId, and planned region nodeId. Inspect the current document, keep those stable IDs, and amend only the target intent, visual system, labels, implementation steps, validation checks, or unfinished targets. Rebuild content inside the existing stable artboard instead of deleting the target.",
    );
  }
  if (
    /^Design command .+ targets content outside every declared delivery artboard$/u.test(
      message,
    )
  ) {
    const commandId = /^Design command (.+?) targets/u.exec(message)?.[1];
    return failure(
      "design_target_stale",
      message,
      "Inspect the current document before retrying. Use only current node IDs that are descendants of the active delivery artboard, or insert a replacement under that stable artboard Frame. Do not reuse node IDs removed by an earlier replace or delete transaction.",
      commandId ? { commandId } : undefined,
    );
  }
  return undefined;
}

function failure(
  code: string,
  message: string,
  recoveryMessage: string,
  target?: { commandId?: string; nodeId?: string },
): TrustedToolFailure {
  return {
    code,
    message: `${message}\nRecovery: ${recoveryMessage}`,
    retryable: false,
    recoverable: true,
    details: {
      kind: "design-transaction",
      fingerprint: `workflow_${hashText(`${code}:${message}`)}`,
      issues: [
        {
          ...target,
          path: "/designWorkflow",
          message: recoveryMessage,
        },
      ],
      recovery: INSPECT_AND_REVISE,
    },
  };
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
