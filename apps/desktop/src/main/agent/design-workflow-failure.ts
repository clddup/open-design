import type { TrustedToolFailure } from "@opendesign/agent-contracts";
import { classifyDesignWorkflowFailure } from "@/shared/design-workflow-failure-classification.js";

const INSPECT_AND_REVISE = {
  action: "inspect-and-revise" as const,
  toolName: "opendesign_inspect_document" as const,
  required: true as const,
};

export function trustedDesignWorkflowFailure(
  error: Error,
): TrustedToolFailure | undefined {
  const message = error.message;
  const classification = classifyDesignWorkflowFailure(message);
  if (!classification) return undefined;
  if (classification.code === "logo_exploration_required") {
    return {
      code: "design_logo_exploration_required",
      message,
      retryable: false,
      recoverable: true,
    };
  }
  if (classification.code === "plan_amendment_invalid") {
    return failure(
      "design_plan_amendment_invalid",
      message,
      "Preserve every material targetId, pageId, artboard frameId, and planned region nodeId. Inspect the current document, keep those stable IDs, and amend only the target intent, visual system, labels, implementation steps, validation checks, or unfinished targets. Rebuild content inside the existing stable artboard instead of deleting the target.",
    );
  }
  if (classification.code === "new_node_id_namespace_required") {
    return failure(
      "design_new_node_id_namespace_required",
      message,
      "Use the latest inspection's exact newNodeIdPrefix for every genuinely new node. A prior Run ID may be reused only when unfinishedDelivery explicitly lists it as a reservedNodeId; keep inspected existing IDs unchanged.",
    );
  }
  if (classification.code === "design_target_stale") {
    const commandId = /^Design command (.+?) targets/u.exec(message)?.[1];
    return failure(
      "design_target_stale",
      message,
      "Inspect the current document before retrying. Use only current node IDs that are descendants of the active delivery artboard, or insert a replacement under that stable artboard Frame. Do not reuse node IDs removed by an earlier replace or delete transaction.",
      commandId ? { commandId } : undefined,
    );
  }
  if (classification.code === "component_strategy_incomplete") {
    return failure(
      "design_component_strategy_incomplete",
      message,
      componentStrategyRecovery(message),
    );
  }
  if (classification.code === "layout_quality_failed") {
    return failure(
      "design_layout_quality_failed",
      message,
      "Inspect the exact captured revision, apply the reported parent-local geometry corrections inside the stable artboard, then inspect and capture that same target again. Preserve all target, Page, artboard, and region IDs.",
    );
  }
  return failure(
    `design_${classification.code}`,
    message,
    classification.requiresInspection
      ? "Inspect the current document and follow the workflow's stated next action using the current revision and stable target IDs. Do not replace or amend the Plan unless the failure explicitly identifies the Plan itself."
      : "Follow the workflow's stated next action using the current revision and stable target IDs. Do not replace or amend the Plan to bypass this gate.",
  );
}

function componentStrategyRecovery(message: string): string {
  const main =
    /Declared Component Main (\S+) must bind Frame\/Group (\S+) on Page (\S+);/u.exec(
      message,
    );
  if (main) {
    const [, componentId, rootNodeId, pageId] = main;
    return `Inspect the current document, then call opendesign_manage_components with exactly {"action":"create-component","label":"Promote ${rootNodeId} Main","pageId":"${pageId}","rootNodeId":"${rootNodeId}","componentId":"${componentId}","name":"${componentId}"}. Keep the current Plan and all stable IDs unchanged. After the component write succeeds, inspect and capture the same target again. Do not submit a Plan amendment.`;
  }
  return "Inspect the current document, repair only the declared component Main/Instance/ordinary binding with opendesign_manage_components or the existing hierarchy, then inspect and capture the same stable target again. Do not submit a Plan amendment.";
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
