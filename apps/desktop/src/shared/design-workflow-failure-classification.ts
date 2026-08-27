import {
  DESIGN_WORKFLOW_FAILURE_DEFINITIONS,
  TrustedToolFailureContract,
  designWorkflowFailureDefinition,
  type DesignWorkflowFailureCode,
  type DesignWorkflowFailurePhase,
  type TrustedToolFailure,
} from "@opendesign/agent-contracts";

export type {
  DesignWorkflowFailureCode,
  DesignWorkflowFailurePhase,
} from "@opendesign/agent-contracts";

export type DesignWorkflowFailurePresentation =
  | "applying-draft"
  | "capturing-canvas"
  | "repairing-components"
  | "repairing-plan"
  | "repairing-layout"
  | "canvas-changed"
  | "scope-conflict";

export interface DesignWorkflowFailureClassification {
  code: DesignWorkflowFailureCode;
  phase: DesignWorkflowFailurePhase;
  presentation: DesignWorkflowFailurePresentation;
  requiresInspection: boolean;
}

type WorkflowFailureOptions = {
  commandId?: string;
  nodeId?: string;
  path?: string;
  recovery?: string;
};

export function classifyDesignWorkflowFailure(
  code: DesignWorkflowFailureCode,
): DesignWorkflowFailureClassification {
  const definition = designWorkflowFailureDefinition(code);
  if (!definition) throw new TypeError(`Unknown design workflow code: ${code}`);
  return {
    ...definition,
    presentation: workflowPresentation(code, definition.phase),
  };
}

export function designWorkflowClassificationFromFailureCode(
  failureCode: string | undefined,
): DesignWorkflowFailureClassification | undefined {
  if (!failureCode?.startsWith("design_")) return undefined;
  const code = failureCode.slice("design_".length);
  if (!isDesignWorkflowFailureCode(code)) return undefined;
  return classifyDesignWorkflowFailure(code);
}

function isDesignWorkflowFailureCode(
  code: string,
): code is DesignWorkflowFailureCode {
  return DESIGN_WORKFLOW_FAILURE_DEFINITIONS.some(
    (definition) => definition.code === code,
  );
}

export function designWorkflowError(
  code: DesignWorkflowFailureCode,
  detail: string,
  options: WorkflowFailureOptions = {},
): Error {
  const classification = classifyDesignWorkflowFailure(code);
  const recovery = options.recovery ?? recoveryMessage(classification);
  const message = `design_workflow.${code}: ${detail}\nRecovery: ${recovery}`;
  const parsed = TrustedToolFailureContract.parse(
    workflowFailure(message, detail, recovery, classification, options),
  );
  if (!parsed.ok) {
    throw new TypeError("Host created an invalid design workflow failure");
  }
  return new Error(message, { cause: parsed.value });
}

function workflowFailure(
  message: string,
  detail: string,
  recovery: string,
  classification: DesignWorkflowFailureClassification,
  options: WorkflowFailureOptions,
): TrustedToolFailure {
  const { code, phase, requiresInspection } = classification;
  return {
    code: `design_${code}`,
    message,
    retryable: false,
    recoverable: true,
    details: {
      kind: "design-workflow",
      fingerprint: `workflow_${hashText(`${code}:${detail}`)}`,
      workflowCode: code,
      phase,
      requiresInspection,
      issues: [
        {
          code: `design_workflow.${code}`,
          ...(options.commandId ? { commandId: options.commandId } : {}),
          ...(options.nodeId ? { nodeId: options.nodeId } : {}),
          path: options.path ?? workflowIssuePath(code),
          message: detail,
          recovery,
        },
      ],
      recovery: { action: "follow-workflow", required: true },
    },
  };
}

function workflowIssuePath(code: DesignWorkflowFailureCode): string {
  if (code === "revision_conflict") return "/revision";
  if (code === "scope_conflict") return "/mutationTarget";
  if (code === "target_stale") return "/targetSet";
  return "/designWorkflow";
}

function recoveryMessage(
  classification: DesignWorkflowFailureClassification,
): string {
  if (classification.code === "plan_amendment_invalid") {
    return "Preserve every material target, Page, artboard, and region ID. Inspect the current document and amend only unfinished intent or content inside the existing stable artboard.";
  }
  if (classification.code === "new_node_id_namespace_required") {
    return "Use the latest inspection's exact newNodeIdPrefix for genuinely new nodes and keep inspected existing IDs unchanged.";
  }
  if (classification.code === "target_stale") {
    return "Inspect the current document and use current descendants of the active delivery artboard. Do not reuse IDs removed by an earlier replace or delete transaction.";
  }
  return classification.requiresInspection
    ? "Inspect the current document, then follow the stated next action using the current revision and stable target IDs."
    : "Follow the stated next action using the current revision and stable target IDs.";
}

function workflowPresentation(
  code: DesignWorkflowFailureCode,
  phase: DesignWorkflowFailurePhase,
): DesignWorkflowFailurePresentation {
  if (code === "revision_conflict") return "canvas-changed";
  if (code === "scope_conflict") return "scope-conflict";
  if (phase === "capture") return "capturing-canvas";
  if (phase === "component-repair") return "repairing-components";
  if (phase === "plan-repair") return "repairing-plan";
  if (phase === "layout-repair") return "repairing-layout";
  return "applying-draft";
}

function hashText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
