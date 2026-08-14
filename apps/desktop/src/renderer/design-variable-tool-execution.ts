import type {
  DesignDocument,
  DesignError,
  DesignOperation,
  DesignTransaction,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { DesignVariableToolInput } from "../shared/design-variable-tool";
import type { RendererDesignToolResponse } from "../shared/design-tool-bridge";
import { planDesignVariableTool } from "./design-variable-tool-plan";

export function executeDesignVariableTool({
  document,
  input,
  requestId,
  runtime,
  sessionId,
  throwTransactionFailure,
  toolCallId,
}: {
  document: DesignDocument;
  input: DesignVariableToolInput;
  requestId: string;
  runtime: EditorRuntime;
  sessionId: string;
  throwTransactionFailure: (
    error: DesignError,
    commands: readonly DesignOperation[],
  ) => never;
  toolCallId: string;
}): RendererDesignToolResponse {
  assertVariableInputPage(document, input);
  const operationId = `agent_variable_${toolCallId}_${document.revision}`
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 220);
  const plan = planDesignVariableTool(document, input, operationId);
  if (!plan.ok) {
    throw new Error(`variable-operation.${plan.code}: ${plan.message}`);
  }
  const transaction = {
    transactionId: `transaction_${operationId}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: {
      type: "agent",
      id: `agent_${sessionId}`,
      displayName: "OpenDesign Agent",
    },
    label: input.label,
    commands: plan.commands,
  } satisfies DesignTransaction;
  const preview = runtime.preview(transaction);
  if (!preview.ok) {
    throwTransactionFailure(preview.error, transaction.commands);
  }
  const result = runtime.apply(transaction);
  if (!result.ok) {
    throwTransactionFailure(result.error, transaction.commands);
  }
  return {
    requestId,
    ok: true,
    result: {
      observedRevision: result.revision.revision,
      content: {
        kind: "variable-operation-result",
        version: 1,
        action: input.action,
        ...resultIds(input),
        revision: result.revision.revision,
        atomic: true,
      },
      designRevision: {
        previousRevision: transaction.baseRevision,
        revision: result.revision.revision,
        transactionId: transaction.transactionId,
      },
    },
  };
}

function resultIds(input: DesignVariableToolInput): {
  collectionId?: string;
  variableId?: string;
} {
  switch (input.action) {
    case "create-collection":
    case "rename-collection":
    case "delete-collection":
    case "add-mode":
    case "rename-mode":
    case "remove-mode":
    case "set-mode":
      return { collectionId: input.collectionId };
    case "create-variable":
    case "set-value":
    case "update-variable":
    case "delete-variable":
      return { variableId: input.variableId };
    case "set-binding":
      return {};
  }
}

function assertVariableInputPage(
  document: DesignDocument,
  input: DesignVariableToolInput,
): void {
  const page = document.pagesById[input.pageId];
  if (!page) {
    throw new Error(`Variable operation Page not found: ${input.pageId}`);
  }
  const targetNodeId =
    input.action === "set-binding"
      ? input.target.nodeId
      : input.action === "set-mode" && input.target.kind === "node"
        ? input.target.id
        : null;
  if (
    targetNodeId &&
    !pageNodeIds(document, page.rootNodeIds).has(targetNodeId)
  ) {
    throw new Error(
      `Variable operation node ${targetNodeId} is outside Page ${input.pageId}`,
    );
  }
  if (
    input.action === "set-mode" &&
    input.target.kind === "page" &&
    input.target.id !== input.pageId
  ) {
    throw new Error("Variable Page mode target must match pageId");
  }
}

function pageNodeIds(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): Set<string> {
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    ids.add(nodeId);
    document.nodesById[nodeId]?.childIds.forEach(visit);
  };
  rootNodeIds.forEach(visit);
  return ids;
}
