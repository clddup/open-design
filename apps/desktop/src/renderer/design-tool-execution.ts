import type { SelectionScope } from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  DesignOperation,
  DesignTransaction,
  DesignTransactionSuccess,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  isDesignApplyToolInput,
  isInternalDesignApplyToolInput,
} from "../shared/design-agent-tools";
import type {
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../shared/design-tool-bridge";

export async function executeDesignToolRequest(
  request: RendererDesignToolRequest,
  runtime: EditorRuntime,
  activePageId: string,
  options: {
    signal?: AbortSignal;
    stageDelayMs?: number;
  } = {},
): Promise<RendererDesignToolResponse> {
  const snapshot = runtime.getSnapshot();
  const document = snapshot.document;
  if (document.documentId !== request.context.documentId) {
    throw new Error("The active Design File changed before tool execution");
  }
  if (request.call.toolName === DESIGN_INSPECT_TOOL_NAME) {
    if (document.revision < request.context.revision) {
      throw new Error(
        `Design revision conflict: expected at least ${request.context.revision}, current ${document.revision}`,
      );
    }
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: document.revision,
        content: createScopedInspection(
          document,
          request.context.scope,
          activePageId,
          snapshot.state.selection,
        ),
      },
    };
  }

  if (document.revision !== request.context.revision) {
    throw new Error(
      `Design revision conflict: expected ${request.context.revision}, current ${document.revision}`,
    );
  }

  if (!(
    (request.call.toolName === DESIGN_APPLY_TOOL_NAME &&
      isDesignApplyToolInput(request.call.input)) ||
    (request.call.toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME &&
      isInternalDesignApplyToolInput(request.call.input))
  )) {
    throw new Error(`Unsupported design tool: ${request.call.toolName}`);
  }
  assertCommandsWithinScope(
    document,
    request.call.input.commands,
    request.context.scope,
    activePageId,
  );
  const transactionId = `transaction_agent_${request.call.toolCallId}_${Date.now()}`;
  const transaction = {
    transactionId,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: {
      type: "agent",
      id: `agent_${request.context.sessionId}`,
      displayName: "OpenDesign Agent",
    },
    label: request.call.input.label,
    ...(request.call.input.summary === undefined
      ? {}
      : { summary: request.call.input.summary }),
    commands: request.call.input.commands,
  } satisfies DesignTransaction;
  const preview = runtime.preview(transaction);
  if (!preview.ok)
    throw new Error(`${preview.error.code}: ${preview.error.message}`);
  return await applyProgressively(
    request,
    runtime,
    transaction,
    preview,
    options.signal,
    options.stageDelayMs ?? 100,
  );
}

async function applyProgressively(
  request: RendererDesignToolRequest,
  runtime: EditorRuntime,
  transaction: DesignTransaction,
  preview: DesignTransactionSuccess,
  signal: AbortSignal | undefined,
  stageDelayMs: number,
): Promise<RendererDesignToolResponse> {
  const stages = progressiveStages(transaction.commands);
  let appliedStages = 0;
  let lastResult: DesignTransactionSuccess | undefined;
  try {
    for (const [index, commands] of stages.entries()) {
      throwIfAborted(signal);
      const currentRevision = runtime.getSnapshot().document.revision;
      const result = runtime.apply(
        {
          ...transaction,
          transactionId:
            stages.length === 1
              ? transaction.transactionId
              : `${transaction.transactionId}_stage_${index + 1}`,
          baseRevision: currentRevision,
          commands,
        },
        {
          historyGroupId: transaction.transactionId,
          finalizeHistoryGroup: index === stages.length - 1,
        },
      );
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`);
      }
      appliedStages += 1;
      lastResult = result;
      if (index < stages.length - 1) {
        await waitForCanvasPaint(signal, stageDelayMs);
      }
    }
  } catch (error) {
    if (appliedStages > 0) {
      runtime.rollbackHistoryGroup(
        transaction.transactionId,
        transaction.actor.id,
      );
    }
    throw error;
  }
  if (!lastResult) throw new Error("Design transaction had no visible stages");
  const changes = {
    ...preview.changes,
    toRevision: lastResult.revision.revision,
  };
  return {
    requestId: request.requestId,
    ok: true,
    result: {
      content: {
        ok: true,
        label: transaction.label,
        revision: lastResult.revision.revision,
        stages: stages.length,
        changes,
        warnings: lastResult.warnings,
      },
      designRevision: {
        previousRevision: transaction.baseRevision,
        revision: lastResult.revision.revision,
        transactionId: transaction.transactionId,
      },
    },
  };
}

function progressiveStages(
  commands: readonly DesignOperation[],
): DesignOperation[][] {
  if (commands.length <= 3) return [[...commands]];
  const stages: DesignOperation[][] = [[commands[0]]];
  for (let index = 1; index < commands.length; index += 3) {
    stages.push(commands.slice(index, index + 3));
  }
  return stages;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw new DOMException("Design generation stopped", "AbortError");
}

async function waitForCanvasPaint(
  signal: AbortSignal | undefined,
  delayMs: number,
): Promise<void> {
  await waitForAnimationFrame(signal);
  await waitForAnimationFrame(signal);
  if (delayMs <= 0) return;
  await waitForDelay(signal, delayMs);
}

function waitForAnimationFrame(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = { current: undefined as number | undefined };
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      if (frame.current !== undefined) {
        window.cancelAnimationFrame(frame.current);
      }
      reject(new DOMException("Design generation stopped", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    frame.current = window.requestAnimationFrame(finish);
  });
}

function waitForDelay(
  signal: AbortSignal | undefined,
  delayMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Design generation stopped", "AbortError"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function createScopedInspection(
  document: DesignDocument,
  scope: SelectionScope,
  activePageId: string,
  selection: { nodeIds: readonly string[]; anchorNodeId?: string },
) {
  const nodeIds = readableNodeIds(document, scope, activePageId);
  const pageIds =
    scope.kind === "document"
      ? [...document.pageOrder]
      : [requiredScopePageId(document, scope, activePageId)];
  const pagesById = Object.fromEntries(
    pageIds.map((pageId) => {
      const page = document.pagesById[pageId];
      if (!page) throw new Error(`Design scope Page not found: ${pageId}`);
      return [
        pageId,
        {
          id: page.id,
          name: page.name,
          rootNodeIds:
            scope.kind === "selection"
              ? [...scope.selectedNodeIds]
              : page.rootNodeIds.filter((nodeId) => nodeIds.has(nodeId)),
        },
      ];
    }),
  );
  const nodesById = Object.fromEntries(
    [...nodeIds].flatMap((nodeId) => {
      const node = document.nodesById[nodeId];
      return node ? [[nodeId, structuredClone(node)]] : [];
    }),
  );
  const assetIds = new Set<string>();
  for (const node of Object.values(nodesById)) {
    if (node.kind === "image") assetIds.add(node.properties.assetId);
    if (
      node.kind === "frame" ||
      node.kind === "rectangle" ||
      node.kind === "ellipse" ||
      node.kind === "text"
    ) {
      for (const paint of [
        ...node.properties.fills,
        ...node.properties.strokes,
      ]) {
        if (paint.type === "image") assetIds.add(paint.assetId);
      }
    }
  }
  const assetsById = Object.fromEntries(
    [...assetIds].flatMap((assetId) => {
      const asset = document.assetsById[assetId];
      return asset ? [[assetId, structuredClone(asset)]] : [];
    }),
  );

  return {
    document: {
      documentId: document.documentId,
      revision: document.revision,
      pageOrder: pageIds,
      pagesById,
      nodesById,
      assetsById,
      designSystemIds: {
        components: Object.keys(document.componentsById),
        variantSets: Object.keys(document.variantSetsById),
        tokenCollections: Object.keys(document.tokenCollectionsById),
        tokens: Object.keys(document.tokensById),
      },
    },
    activePageId: requiredScopePageId(document, scope, activePageId),
    requestedScope: structuredClone(scope),
    selection: {
      nodeIds: selection.nodeIds.filter((nodeId) => nodeIds.has(nodeId)),
      anchorNodeId:
        selection.anchorNodeId && nodeIds.has(selection.anchorNodeId)
          ? selection.anchorNodeId
          : null,
    },
  };
}

function assertCommandsWithinScope(
  document: DesignDocument,
  commands: readonly DesignOperation[],
  scope: SelectionScope,
  activePageId: string,
): void {
  if (scope.kind === "document") return;
  const pageId = requiredScopePageId(document, scope, activePageId);
  const allowedNodeIds = readableNodeIds(document, scope, activePageId);
  const assertNode = (nodeId: string, commandId: string) => {
    if (!allowedNodeIds.has(nodeId)) {
      throw new Error(
        `Agent command ${commandId} exceeds the registered ${scope.kind} scope: ${nodeId}`,
      );
    }
  };
  const assertTarget = (
    targetPageId: string,
    parentId: string | null,
    commandId: string,
  ) => {
    if (targetPageId !== pageId) {
      throw new Error(
        `Agent command ${commandId} targets Page ${targetPageId} outside the registered scope`,
      );
    }
    if (
      parentId !== null
        ? !allowedNodeIds.has(parentId)
        : scope.kind === "selection"
    ) {
      throw new Error(
        `Agent command ${commandId} targets a parent outside the registered ${scope.kind} scope`,
      );
    }
  };

  for (const command of commands) {
    if (command.type === "put_asset") continue;
    if (command.type === "delete_asset") {
      throw new Error("Agent asset deletion requires a dedicated scoped tool");
    }
    if (command.type === "insert_element") {
      assertTarget(command.pageId, command.parentId, command.commandId);
      continue;
    }
    if (command.type === "move_element") {
      assertNode(command.nodeId, command.commandId);
      assertTarget(command.pageId, command.parentId, command.commandId);
      continue;
    }
    const nodeId =
      command.type === "replace_subtree" ? command.rootNodeId : command.nodeId;
    assertNode(nodeId, command.commandId);
  }
}

function readableNodeIds(
  document: DesignDocument,
  scope: SelectionScope,
  activePageId: string,
): Set<string> {
  if (scope.kind === "document") {
    return new Set(Object.keys(document.nodesById));
  }
  if (scope.kind === "page") {
    return pageNodeIds(document, scope.pageId);
  }
  requiredScopePageId(document, scope, activePageId);
  const result = new Set<string>();
  for (const nodeId of scope.selectedNodeIds) {
    collectSubtreeNodeIds(document, nodeId, result);
  }
  return result;
}

function requiredScopePageId(
  document: DesignDocument,
  scope: SelectionScope,
  activePageId: string,
): string {
  if (scope.kind === "page") return scope.pageId;
  if (scope.kind === "selection") {
    const pageId =
      scope.pageId ?? nodePageId(document, scope.selectedNodeIds[0]);
    if (!pageId) throw new Error("Selection scope is not bound to a Page");
    const pageNodes = pageNodeIds(document, pageId);
    if (scope.selectedNodeIds.some((nodeId) => !pageNodes.has(nodeId))) {
      throw new Error("Selection scope contains a node outside its Page");
    }
    return pageId;
  }
  if (activePageId && document.pagesById[activePageId]) return activePageId;
  const firstPageId = document.pageOrder[0];
  if (!firstPageId) throw new Error("Design document has no active Page");
  return firstPageId;
}

function pageNodeIds(document: DesignDocument, pageId: string): Set<string> {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Design scope Page not found: ${pageId}`);
  const result = new Set<string>();
  for (const nodeId of page.rootNodeIds) {
    collectSubtreeNodeIds(document, nodeId, result);
  }
  return result;
}

function collectSubtreeNodeIds(
  document: DesignDocument,
  rootNodeId: string,
  result: Set<string>,
): void {
  const pending = [rootNodeId];
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (!nodeId || result.has(nodeId)) continue;
    const node = document.nodesById[nodeId];
    if (!node) throw new Error(`Design scope node not found: ${nodeId}`);
    result.add(nodeId);
    pending.push(...node.childIds);
  }
}

function nodePageId(
  document: DesignDocument,
  nodeId: string | undefined,
): string | undefined {
  if (!nodeId) return undefined;
  return document.pageOrder.find((pageId) =>
    pageNodeIds(document, pageId).has(nodeId),
  );
}
