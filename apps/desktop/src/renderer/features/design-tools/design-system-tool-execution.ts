import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import type { DesignMutationTarget } from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  DesignError,
  DesignOperation,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import {
  DesignStyleContract,
  DesignVariableContract,
  INTERNAL_DESIGN_STYLE_TOOL_NAME,
  INTERNAL_DESIGN_VARIABLE_TOOL_NAME,
} from "@/shared/design-agent-tools";
import type {
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "@/shared/design-tool-bridge";
import { executeDesignStyleTool } from "./design-style-tool-execution";
import { executeDesignVariableTool } from "./design-variable-tool-execution";

export function executeDesignSystemToolRequest({
  document,
  request,
  runtime,
  throwTransactionFailure,
}: {
  document: DesignDocument;
  request: RendererDesignToolRequest;
  runtime: EditorRuntime;
  throwTransactionFailure: (
    error: DesignError,
    commands: readonly DesignOperation[],
  ) => never;
}): RendererDesignToolResponse | null {
  const { call, context } = request;
  if (call.toolName === INTERNAL_DESIGN_VARIABLE_TOOL_NAME) {
    const parsed = DesignVariableContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError("Renderer received invalid canonical Variable input");
    }
    const input = parsed.value;
    assertRevision(document, context.revision, "Variable");
    assertPageTarget(input.pageId, context.mutationTarget, "Variable");
    return executeDesignVariableTool({
      document,
      input,
      requestId: request.requestId,
      runtime,
      sessionId: context.sessionId,
      throwTransactionFailure,
      toolCallId: call.toolCallId,
    });
  }
  if (call.toolName !== INTERNAL_DESIGN_STYLE_TOOL_NAME) {
    return null;
  }
  const parsed = DesignStyleContract.parse(call.input);
  if (!parsed.ok) {
    throw new TypeError("Renderer received invalid canonical Style input");
  }
  const input = parsed.value;
  assertRevision(document, context.revision, "Style");
  assertPageTarget(input.pageId, context.mutationTarget, "Style");
  if (
    context.mutationTarget.kind !== "document" &&
    (input.action === "update-from-node" || input.action === "delete")
  ) {
    const scoped = pageNodeIds(document, input.pageId);
    const outsideConsumer = Object.values(document.nodesById).find(
      (node) =>
        !scoped.has(node.id) &&
        styleReferenceFields.some((field) => node[field] === input.styleId),
    );
    if (outsideConsumer) {
      throw new Error(
        `Style ${input.styleId} has a consumer outside Page ${input.pageId}; request Page structure access before changing it`,
      );
    }
  }
  return executeDesignStyleTool({
    document,
    input,
    requestId: request.requestId,
    runtime,
    sessionId: context.sessionId,
    throwTransactionFailure,
    toolCallId: call.toolCallId,
  });
}

function assertRevision(
  document: DesignDocument,
  expected: number,
  kind: string,
): void {
  if (document.revision !== expected) {
    throw designWorkflowError(
      "revision_conflict",
      `${kind} operation revision conflict: expected ${expected}, current ${document.revision}`,
    );
  }
}

function assertPageTarget(
  pageId: string,
  mutationTarget: DesignMutationTarget,
  kind: string,
): void {
  if (mutationTarget.kind === "page" && mutationTarget.pageId !== pageId) {
    throw new Error(
      `${kind} operation Page ${pageId} is outside mutation target ${mutationTarget.pageId}`,
    );
  }
}

function pageNodeIds(document: DesignDocument, pageId: string): Set<string> {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Style operation Page not found: ${pageId}`);
  const ids = new Set<string>();
  const visit = (nodeId: string) => {
    if (ids.has(nodeId)) return;
    ids.add(nodeId);
    document.nodesById[nodeId]?.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  return ids;
}

const styleReferenceFields = [
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
] as const;
