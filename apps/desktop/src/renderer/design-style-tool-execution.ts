import type {
  DesignDocument,
  DesignError,
  DesignOperation,
  DesignTransaction,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { DesignStyleToolInput } from "../shared/design-style-tool";
import type { RendererDesignToolResponse } from "../shared/design-tool-bridge";
import { planDesignStyleTool } from "./design-style-tool-plan";

export function executeDesignStyleTool({
  document,
  input,
  requestId,
  runtime,
  sessionId,
  throwTransactionFailure,
  toolCallId,
}: {
  document: DesignDocument;
  input: DesignStyleToolInput;
  requestId: string;
  runtime: EditorRuntime;
  sessionId: string;
  throwTransactionFailure: (
    error: DesignError,
    commands: readonly DesignOperation[],
  ) => never;
  toolCallId: string;
}): RendererDesignToolResponse {
  assertInputPage(document, input);
  const operationId = `agent_style_${toolCallId}_${document.revision}`
    .replace(/[^A-Za-z0-9._:-]/g, "_")
    .slice(0, 220);
  const plan = planDesignStyleTool(document, input, operationId);
  if (!plan.ok)
    throw new Error(`style-operation.${plan.code}: ${plan.message}`);
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
  if (!preview.ok) throwTransactionFailure(preview.error, transaction.commands);
  const result = runtime.apply(transaction);
  if (!result.ok) throwTransactionFailure(result.error, transaction.commands);
  return {
    requestId,
    ok: true,
    result: {
      observedRevision: result.revision.revision,
      content: {
        kind: "style-operation-result",
        version: 1,
        action: input.action,
        styleId: input.styleId,
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

function assertInputPage(
  document: DesignDocument,
  input: DesignStyleToolInput,
): void {
  const page = document.pagesById[input.pageId];
  if (!page) throw new Error(`Style operation Page not found: ${input.pageId}`);
  if (
    "nodeId" in input &&
    !pageNodeIds(document, page.rootNodeIds).has(input.nodeId)
  ) {
    throw new Error(
      `Style operation node ${input.nodeId} is outside Page ${input.pageId}`,
    );
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
