import type {
  DesignMutationTarget,
  SelectionScope,
} from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  DesignOperation,
  DesignTransaction,
  DesignTransactionSuccess,
} from "@opendesign/design-contracts";
import {
  diagnoseDesignPages,
  planArrangeNodes,
  planGroupNodes,
  planImageNodeUpdate,
  planReparentNodes,
  planReorderNodes,
  planUngroupNode,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  isDesignArrangeToolInput,
  isDesignApplyToolInput,
  isDesignHierarchyToolInput,
  isInternalDesignApplyToolInput,
  isInternalUpdateImageToolInput,
} from "../shared/design-agent-tools";
import type {
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../shared/design-tool-bridge";

export async function executeDesignToolRequest(
  request: RendererDesignToolRequest,
  runtime: EditorRuntime,
  _activePageId: string,
  options: {
    captureCanvas?: () => Promise<{
      attachment: {
        attachmentId: string;
        byteSize: number;
        mimeType: "image/jpeg";
        name: string;
      };
      height: number;
      width: number;
    }>;
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
          request.context.mutationTarget,
          request.context.scope,
        ),
      },
    };
  }
  if (request.call.toolName === DESIGN_CAPTURE_TOOL_NAME) {
    if (document.revision < request.context.revision) {
      throw new Error(
        `Design revision conflict: expected at least ${request.context.revision}, current ${document.revision}`,
      );
    }
    if (!options.captureCanvas) {
      throw new Error("Canvas preview capture is unavailable");
    }
    const preview = await options.captureCanvas();
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: document.revision,
        content: {
          ok: true,
          revision: document.revision,
          width: preview.width,
          height: preview.height,
          attachment: preview.attachment,
          attachments: [preview.attachment],
        },
      },
    };
  }

  if (document.revision !== request.context.revision) {
    throw new Error(
      `Design revision conflict: expected ${request.context.revision}, current ${document.revision}`,
    );
  }

  if (
    request.call.toolName === DESIGN_HIERARCHY_TOOL_NAME &&
    isDesignHierarchyToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Hierarchy",
    );
    const commandPrefix =
      `hierarchy_${input.action}_${request.call.toolCallId}`.slice(0, 200);
    const plan =
      input.action === "group"
        ? planGroupNodes(document, input.pageId, input.nodeIds, {
            groupId: input.groupId,
            name: input.name,
            commandPrefix,
          })
        : input.action === "ungroup"
          ? planUngroupNode(
              document,
              input.pageId,
              input.groupId,
              commandPrefix,
            )
          : input.action === "reorder"
            ? planReorderNodes(
                document,
                input.pageId,
                input.nodeIds,
                input.order,
                commandPrefix,
              )
            : planReparentNodes(document, input.pageId, input.nodeIds, {
                parentId: input.parentId,
                index: input.index,
                commandPrefix,
              });
    if (!plan.ok) {
      throw new Error(`hierarchy.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.commands,
      request.context.mutationTarget,
    );
    const transactionId =
      `transaction_agent_hierarchy_${request.call.toolCallId}_${Date.now()}`.slice(
        0,
        256,
      );
    const transaction = {
      transactionId,
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: {
        type: "agent",
        id: `agent_${request.context.sessionId}`,
        displayName: "OpenDesign Agent",
      },
      label: input.label,
      commands: plan.commands,
    } satisfies DesignTransaction;
    throwIfAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw new Error(`${preview.error.code}: ${preview.error.message}`);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const appliedDocument = runtime.getSnapshot().document;
    const childNodeIds =
      input.action === "group"
        ? (appliedDocument.nodesById[input.groupId]?.childIds ?? [])
        : input.action === "ungroup"
          ? plan.selectionNodeIds
          : undefined;
    const resultParentId =
      input.action === "reparent"
        ? input.parentId
        : input.action === "reorder"
          ? (appliedDocument.nodesById[plan.selectionNodeIds[0] ?? ""]
              ?.parentId ?? null)
          : undefined;
    const siblingOrder =
      input.action === "reorder" || input.action === "reparent"
        ? resultParentId
          ? appliedDocument.nodesById[resultParentId]?.childIds
          : appliedDocument.pagesById[input.pageId]?.rootNodeIds
        : undefined;
    const hierarchyResult =
      input.action === "reorder"
        ? {
            order: input.order,
            nodeIds: plan.selectionNodeIds,
            siblingOrder: siblingOrder ?? [],
          }
        : input.action === "reparent"
          ? {
              nodeIds: plan.selectionNodeIds,
              parentId: input.parentId,
              index: input.index,
              siblingOrder: siblingOrder ?? [],
            }
          : { groupId: input.groupId, childNodeIds };
    const warnings = [
      ...new Set([...(plan.warnings ?? []), ...result.warnings]),
    ];
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        content: {
          ok: true,
          action: input.action,
          label: input.label,
          pageId: input.pageId,
          ...hierarchyResult,
          revision: result.revision.revision,
          atomic: true,
          changes: result.changes,
          warnings,
        },
        designRevision: {
          previousRevision: transaction.baseRevision,
          revision: result.revision.revision,
          transactionId: transaction.transactionId,
        },
      },
    };
  }

  if (
    request.call.toolName === DESIGN_ARRANGE_TOOL_NAME &&
    isDesignArrangeToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Arrangement",
    );
    const operation =
      input.action === "set-horizontal-spacing" ||
      input.action === "set-vertical-spacing"
        ? { action: input.action, spacing: input.spacing }
        : { action: input.action };
    const commandPrefix =
      `arrange_${input.action}_${request.call.toolCallId}`.slice(0, 200);
    const plan = planArrangeNodes(
      document,
      input.pageId,
      input.nodeIds,
      operation,
      commandPrefix,
    );
    if (!plan.ok) {
      throw new Error(`arrange.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.commands,
      request.context.mutationTarget,
    );
    const transaction = {
      transactionId:
        `transaction_agent_arrange_${request.call.toolCallId}_${Date.now()}`.slice(
          0,
          256,
        ),
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: {
        type: "agent",
        id: `agent_${request.context.sessionId}`,
        displayName: "OpenDesign Agent",
      },
      label: input.label,
      commands: plan.commands,
    } satisfies DesignTransaction;
    throwIfAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw new Error(`${preview.error.code}: ${preview.error.message}`);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        content: {
          ok: true,
          action: input.action,
          label: input.label,
          pageId: input.pageId,
          nodeIds: plan.selectionNodeIds,
          orderedNodeIds: plan.orderedNodeIds,
          ...(plan.resolvedSpacing === undefined
            ? {}
            : { resolvedSpacing: plan.resolvedSpacing }),
          revision: result.revision.revision,
          atomic: true,
          changes: result.changes,
          warnings: result.warnings,
        },
        designRevision: {
          previousRevision: transaction.baseRevision,
          revision: result.revision.revision,
          transactionId: transaction.transactionId,
        },
      },
    };
  }

  if (
    request.call.toolName === INTERNAL_UPDATE_IMAGE_TOOL_NAME &&
    isInternalUpdateImageToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Image update",
    );
    const commandPrefix =
      `image_${input.action}_${request.call.toolCallId}`.slice(0, 200);
    const plan = planImageNodeUpdate(
      document,
      input.action === "set-placement"
        ? {
            action: input.action,
            pageId: input.pageId,
            nodeId: input.nodeId,
            placement: input.placement,
          }
        : {
            action: input.action,
            pageId: input.pageId,
            nodeId: input.nodeId,
            asset: input.asset,
            ...(input.placement === undefined
              ? {}
              : { placement: input.placement }),
          },
      commandPrefix,
    );
    if (!plan.ok) {
      throw new Error(`image-update.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.commands,
      request.context.mutationTarget,
      { allowedAssetDeletionId: plan.deletedAssetId },
    );
    const transaction = {
      transactionId:
        `transaction_agent_image_${request.call.toolCallId}_${Date.now()}`.slice(
          0,
          256,
        ),
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: {
        type: "agent",
        id: `agent_${request.context.sessionId}`,
        displayName: "OpenDesign Agent",
      },
      label: input.label,
      commands: plan.commands,
    } satisfies DesignTransaction;
    throwIfAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw new Error(`${preview.error.code}: ${preview.error.message}`);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw new Error(`${result.error.code}: ${result.error.message}`);
    }
    const applied = runtime.getSnapshot().document.nodesById[input.nodeId];
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        content: {
          ok: true,
          action: input.action,
          label: input.label,
          pageId: input.pageId,
          nodeId: input.nodeId,
          assetId:
            applied?.kind === "image" ? applied.properties.assetId : undefined,
          placement:
            applied?.kind === "image"
              ? applied.properties.placement
              : undefined,
          ...(plan.deletedAssetId === undefined
            ? {}
            : { deletedAssetId: plan.deletedAssetId }),
          revision: result.revision.revision,
          atomic: true,
          changes: result.changes,
          warnings: result.warnings,
        },
        designRevision: {
          previousRevision: transaction.baseRevision,
          revision: result.revision.revision,
          transactionId: transaction.transactionId,
        },
      },
    };
  }

  if (!(
    (request.call.toolName === DESIGN_APPLY_TOOL_NAME &&
      isDesignApplyToolInput(request.call.input)) ||
    (request.call.toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME &&
      isInternalDesignApplyToolInput(request.call.input))
  )) {
    throw new Error(`Unsupported design tool: ${request.call.toolName}`);
  }
  assertCommandsWithinMutationTarget(
    document,
    request.call.input.commands,
    request.context.mutationTarget,
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

function assertPageWithinMutationTarget(
  pageId: string,
  mutationTarget: DesignMutationTarget,
  operationName: string,
): void {
  if (mutationTarget.kind === "document") return;
  if (pageId !== mutationTarget.pageId) {
    throw new Error(
      `${operationName} operation targets Page ${pageId} outside the registered page mutation target`,
    );
  }
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
  mutationTarget: DesignMutationTarget,
  selectionContext: SelectionScope,
) {
  const nodeIds = mutationTargetNodeIds(document, mutationTarget);
  const pageIds =
    mutationTarget.kind === "document"
      ? [...document.pageOrder]
      : [requiredMutationPageId(document, mutationTarget)];
  const pagesById = Object.fromEntries(
    pageIds.map((pageId) => {
      const page = document.pagesById[pageId];
      if (!page) throw new Error(`Design scope Page not found: ${pageId}`);
      return [
        pageId,
        {
          id: page.id,
          name: page.name,
          rootNodeIds: page.rootNodeIds.filter((nodeId) => nodeIds.has(nodeId)),
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
      if (!asset) return [];
      // Inspection is model context, not an asset transport. Returning a data
      // URI here duplicates the full binary as tool-result text and can exceed
      // the model context window after a single image is placed. Pixels remain
      // available through the bounded canvas capture tool.
      return [
        [
          assetId,
          {
            id: asset.id,
            kind: asset.kind,
            name: asset.name,
            mimeType: asset.mimeType,
            sourceType: asset.source.type,
            ...(asset.size === undefined
              ? {}
              : { size: structuredClone(asset.size) }),
            extensionKeys: Object.keys(asset.extensions),
          },
        ],
      ];
    }),
  );
  const diagnostics = diagnoseDesignPages(document, pageIds);

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
    activePageId: inspectionPageId(document, mutationTarget, selectionContext),
    mutationTarget: structuredClone(mutationTarget),
    diagnostics,
    selectionContext: structuredClone(selectionContext),
    selection: {
      nodeIds: selectionContext.selectedNodeIds.filter((nodeId) =>
        nodeIds.has(nodeId),
      ),
      anchorNodeId:
        selectionContext.primaryNodeId &&
        nodeIds.has(selectionContext.primaryNodeId)
          ? selectionContext.primaryNodeId
          : null,
    },
  };
}

function assertCommandsWithinMutationTarget(
  document: DesignDocument,
  commands: readonly DesignOperation[],
  mutationTarget: DesignMutationTarget,
  options: { allowedAssetDeletionId?: string } = {},
): void {
  if (mutationTarget.kind === "document") return;
  const pageId = requiredMutationPageId(document, mutationTarget);
  const allowedNodeIds = mutationTargetNodeIds(document, mutationTarget);
  const assertNode = (nodeId: string, commandId: string) => {
    if (!allowedNodeIds.has(nodeId)) {
      throw new Error(
        `Agent command ${commandId} exceeds the registered page mutation target: ${nodeId}`,
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
    if (parentId !== null && !allowedNodeIds.has(parentId)) {
      throw new Error(
        `Agent command ${commandId} targets a parent outside the registered page mutation target`,
      );
    }
  };

  for (const command of commands) {
    if (command.type === "put_asset") continue;
    if (command.type === "delete_asset") {
      if (options.allowedAssetDeletionId === command.assetId) continue;
      throw new Error("Agent asset deletion requires a dedicated scoped tool");
    }
    if (command.type === "insert_element") {
      assertTarget(command.pageId, command.parentId, command.commandId);
      // Commands are executed in order. A composite design may create its
      // container first and then insert children into that new container in
      // the same transaction. Once an insertion has been proven to target
      // this Page, its node becomes an in-scope parent for later commands.
      allowedNodeIds.add(command.node.id);
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
    if (command.type === "replace_subtree") {
      command.nodes.forEach((node) => allowedNodeIds.add(node.id));
    }
  }
}

function mutationTargetNodeIds(
  document: DesignDocument,
  mutationTarget: DesignMutationTarget,
): Set<string> {
  if (mutationTarget.kind === "document") {
    return new Set(Object.keys(document.nodesById));
  }
  return pageNodeIds(document, mutationTarget.pageId);
}

function requiredMutationPageId(
  document: DesignDocument,
  mutationTarget: DesignMutationTarget,
): string {
  if (mutationTarget.kind !== "page") {
    throw new Error("A page mutation target is required");
  }
  if (!document.pagesById[mutationTarget.pageId]) {
    throw new Error(
      `Design mutation target Page not found: ${mutationTarget.pageId}`,
    );
  }
  return mutationTarget.pageId;
}

function inspectionPageId(
  document: DesignDocument,
  mutationTarget: DesignMutationTarget,
  selectionContext: SelectionScope,
): string {
  if (mutationTarget.kind === "page") {
    return requiredMutationPageId(document, mutationTarget);
  }
  if (selectionContext.pageId && document.pagesById[selectionContext.pageId]) {
    return selectionContext.pageId;
  }
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
