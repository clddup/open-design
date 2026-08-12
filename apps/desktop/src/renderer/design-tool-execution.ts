import type {
  AgentToolFailureIssue,
  DesignMutationTarget,
  SelectionScope,
} from "@opendesign/agent-contracts";
import type { TrustedToolFailure } from "@opendesign/agent-runtime";
import type {
  DesignDocument,
  DesignError,
  DesignOperation,
  DesignTransaction,
  DesignTransactionSuccess,
} from "@opendesign/design-contracts";
import {
  diagnoseDesignTargetLayout,
  diagnoseDesignPages,
  planArrangeNodes,
  planCreatePage,
  planCreateBooleanGroup,
  planDeletePage,
  planDuplicatePage,
  planGroupNodes,
  planImageNodeUpdate,
  planReparentNodes,
  planReorderNodes,
  planRenamePage,
  planReorderPage,
  planSvgImport,
  planSetBooleanOperation,
  planUngroupBooleanGroup,
  planUngroupNode,
  planVectorLayersLineCut,
  planVectorSemanticEdit,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  isDesignArrangeToolInput,
  isDesignApplyToolInput,
  isDesignHierarchyToolInput,
  isDesignPageToolInput,
  isDesignVectorToolInput,
  isExportSvgToolInput,
  isExportRasterToolInput,
  isInternalDesignApplyToolInput,
  isInternalImportSvgToolInput,
  isInternalUpdateImageToolInput,
  type DesignPageToolInput,
} from "../shared/design-agent-tools";
import type {
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../shared/design-tool-bridge";
import { runSvgExportInWorker, runSvgImportInWorker } from "./svg-interchange";
import { exportDesignRaster } from "./raster-export";

type ExecuteDesignToolOptions = {
  captureCanvas?: (document: DesignDocument) => Promise<{
    attachment: {
      attachmentId: string;
      byteSize: number;
      mimeType: "image/jpeg";
      name: string;
    };
    height: number;
    width: number;
  }>;
  exportSvg?: typeof runSvgExportInWorker;
  exportRaster?: typeof exportDesignRaster;
  importSvg?: typeof runSvgImportInWorker;
  signal?: AbortSignal;
  stageDelayMs?: number;
};

export async function executeDesignToolRequest(
  request: RendererDesignToolRequest,
  runtime: EditorRuntime,
  activePageId: string,
  options: ExecuteDesignToolOptions = {},
): Promise<RendererDesignToolResponse> {
  try {
    return await executeDesignToolRequestUnsafe(
      request,
      runtime,
      activePageId,
      options,
    );
  } catch (error) {
    if (!(error instanceof DesignTransactionToolError)) throw error;
    return { requestId: request.requestId, ok: false, error: error.failure };
  }
}

async function executeDesignToolRequestUnsafe(
  request: RendererDesignToolRequest,
  runtime: EditorRuntime,
  _activePageId: string,
  options: ExecuteDesignToolOptions,
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
    if (!request.captureTarget) {
      throw new Error("Canvas capture target is unavailable");
    }
    const preview = await options.captureCanvas(document);
    const layoutQuality =
      request.captureTarget.kind === "frame"
        ? diagnoseDesignTargetLayout(
            document,
            request.captureTarget.pageId,
            request.captureTarget.nodeId,
          )
        : undefined;
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
          ...(layoutQuality ? { layoutQuality } : {}),
        },
      },
    };
  }

  if (document.revision !== request.context.revision) {
    if (
      document.revision < request.context.revision ||
      !canRebasePlannedInsert(request, document)
    ) {
      throw new Error(
        `Design revision conflict: expected ${request.context.revision}, current ${document.revision}`,
      );
    }
  }

  if (
    request.call.toolName === DESIGN_PAGE_TOOL_NAME &&
    isDesignPageToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageToolMutationTarget(input, request.context.mutationTarget);
    throwIfAborted(options.signal);
    const operationId =
      `agent_page_${request.call.toolCallId}_${document.revision}`.slice(
        0,
        220,
      );
    const plan =
      input.action === "create"
        ? planCreatePage(document, {
            pageId: `${operationId}_page`,
            name: input.name,
            ...(input.index === undefined ? {} : { index: input.index }),
            commandPrefix: operationId,
          })
        : input.action === "rename"
          ? planRenamePage(document, {
              pageId: input.pageId,
              name: input.name,
              commandPrefix: operationId,
            })
          : input.action === "duplicate"
            ? planDuplicatePage(document, {
                pageId: input.pageId,
                duplicatePageId: `${operationId}_page`,
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(input.index === undefined ? {} : { index: input.index }),
                commandPrefix: operationId,
                createNodeId: (_sourceNodeId, index) =>
                  `${operationId}_node_${index}`,
              })
            : input.action === "reorder"
              ? planReorderPage(document, {
                  pageId: input.pageId,
                  index: input.index,
                  commandPrefix: operationId,
                })
              : planDeletePage(document, {
                  pageId: input.pageId,
                  commandPrefix: operationId,
                });
    if (!plan.ok) {
      throw new Error(`page-operation.${plan.code}: ${plan.message}`);
    }
    const transaction = {
      transactionId: `transaction_${operationId}`,
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
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    const applied = runtime.getSnapshot().document;
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: result.revision.revision,
        content: {
          kind: "page-operation-result",
          version: 1,
          ok: true,
          action: input.action,
          pageId: plan.pageId,
          ...(applied.pagesById[plan.pageId]
            ? { name: applied.pagesById[plan.pageId].name }
            : {}),
          pageOrder: [...applied.pageOrder],
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

  if (
    request.call.toolName === INTERNAL_IMPORT_SVG_TOOL_NAME &&
    isInternalImportSvgToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "SVG import",
    );
    throwIfAborted(options.signal);
    const imported = await (options.importSvg ?? runSvgImportInWorker)(
      {
        svg: input.svg,
        idPrefix: input.idPrefix,
        name: input.name,
      },
      options.signal,
    );
    throwIfAborted(options.signal);
    const plan = planSvgImport(document, imported, {
      pageId: input.pageId,
      parentId: input.parentId,
      index: input.index,
      transform: [1, 0, 0, 1, input.x, input.y],
      commandPrefix: input.idPrefix,
    });
    if (!plan.ok) {
      throw new Error(`svg-import.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.commands,
      request.context.mutationTarget,
    );
    const transaction = {
      transactionId:
        `transaction_agent_svg_import_${request.call.toolCallId}_${Date.now()}`.slice(
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
      label: `Import SVG: ${input.name}`,
      commands: plan.commands,
    } satisfies DesignTransaction;
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    runtime.setSelection(plan.selectionNodeIds, plan.rootNodeId);
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: result.revision.revision,
        content: {
          kind: "svg-import-result",
          version: 1,
          ok: true,
          format: "svg",
          attachmentId: input.attachmentId,
          name: input.name,
          pageId: input.pageId,
          parentId: input.parentId,
          rootNodeId: plan.rootNodeId,
          importedNodeIds: imported.nodes.map((node) => node.id),
          revision: result.revision.revision,
          atomic: true,
          issues: plan.issues.map((issue) => ({ ...issue })),
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
    request.call.toolName === EXPORT_RASTER_TOOL_NAME &&
    isExportRasterToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Raster export",
    );
    throwIfAborted(options.signal);
    const exported = await (options.exportRaster ?? exportDesignRaster)(
      document,
      {
        version: 1,
        pageId: input.pageId,
        rootNodeId: input.rootNodeId,
        format: input.format,
        size: input.size,
        background: input.background,
        ...(input.quality === undefined ? {} : { quality: input.quality }),
        resampling: input.resampling,
      },
      options.signal,
    );
    throwIfAborted(options.signal);
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: document.revision,
        content: {
          kind: "raster-export-preparation",
          version: 1,
          suggestedName: input.suggestedName,
          format: input.format,
          mimeType: exported.mimeType,
          bytes: exported.bytes,
          width: exported.width,
          height: exported.height,
          revision: document.revision,
          rootNodeId: input.rootNodeId,
        },
      },
    };
  }

  if (
    request.call.toolName === EXPORT_SVG_TOOL_NAME &&
    isExportSvgToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "SVG export",
    );
    throwIfAborted(options.signal);
    const exported = await (options.exportSvg ?? runSvgExportInWorker)(
      {
        document,
        pageId: input.pageId,
        rootNodeIds: [...input.rootNodeIds],
        settings: {
          includeLayerIds: input.includeLayerIds ?? false,
          padding: input.padding ?? 0,
        },
      },
      options.signal,
    );
    throwIfAborted(options.signal);
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: exported.revision,
        content: {
          kind: "svg-export-preparation",
          version: 1,
          suggestedName: input.suggestedName,
          svg: exported.svg,
          revision: exported.revision,
          exportedNodeIds: [...exported.exportedNodeIds],
          issues: exported.issues.map((issue) => ({ ...issue })),
        },
      },
    };
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
          : input.action === "create-boolean"
            ? planCreateBooleanGroup(
                document,
                input.pageId,
                input.nodeIds,
                input.operation,
                {
                  booleanId: input.booleanId,
                  name: input.name,
                  commandPrefix,
                },
              )
            : input.action === "set-boolean-operation"
              ? planSetBooleanOperation(
                  document,
                  input.pageId,
                  input.booleanId,
                  input.operation,
                  commandPrefix,
                )
              : input.action === "ungroup-boolean"
                ? planUngroupBooleanGroup(
                    document,
                    input.pageId,
                    input.booleanId,
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
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    const appliedDocument = runtime.getSnapshot().document;
    const childNodeIds =
      input.action === "group"
        ? (appliedDocument.nodesById[input.groupId]?.childIds ?? [])
        : input.action === "ungroup"
          ? plan.selectionNodeIds
          : input.action === "create-boolean" ||
              input.action === "set-boolean-operation"
            ? (appliedDocument.nodesById[input.booleanId]?.childIds ?? [])
            : input.action === "ungroup-boolean"
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
          : input.action === "create-boolean" ||
              input.action === "set-boolean-operation"
            ? {
                booleanId: input.booleanId,
                operation: input.operation,
                childNodeIds,
              }
            : input.action === "ungroup-boolean"
              ? { booleanId: input.booleanId, childNodeIds }
              : { groupId: input.groupId, childNodeIds };
    const planWarnings: readonly string[] =
      "warnings" in plan && Array.isArray(plan.warnings) ? plan.warnings : [];
    const warnings = [...new Set([...planWarnings, ...result.warnings])];
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
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
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
          ...(plan.tidyUpDimension === undefined
            ? {}
            : { tidyUpDimension: plan.tidyUpDimension }),
          ...(plan.resolvedHorizontalSpacing === undefined
            ? {}
            : {
                resolvedHorizontalSpacing: plan.resolvedHorizontalSpacing,
              }),
          ...(plan.resolvedVerticalSpacing === undefined
            ? {}
            : { resolvedVerticalSpacing: plan.resolvedVerticalSpacing }),
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
    request.call.toolName === DESIGN_VECTOR_TOOL_NAME &&
    isDesignVectorToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Vector",
    );
    const safeToolCallId =
      request.call.toolCallId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 180) ||
      "tool";
    const plan =
      input.action === "cut-layers-with-line"
        ? planVectorLayersLineCut(
            document,
            input.pageId,
            input.nodeIds.map((nodeId, index) => ({
              nodeId,
              resultNodeId:
                `vector_cut_${safeToolCallId}_${index}_${document.revision}`.slice(
                  0,
                  256,
                ),
            })),
            input.start,
            input.end,
          )
        : planVectorSemanticEdit(
            document,
            input.pageId,
            input.nodeId,
            input.action === "set-closed"
              ? {
                  action: input.action,
                  closed: input.closed,
                  ...(input.pathId ? { pathId: input.pathId } : {}),
                }
              : input.action === "reverse-path"
                ? {
                    action: input.action,
                    ...(input.pathId ? { pathId: input.pathId } : {}),
                  }
                : input.action === "cut-path"
                  ? {
                      action: input.action,
                      at: input.at,
                      pathId: input.pathId,
                    }
                  : {
                      action: input.action,
                      end: input.end,
                      resultNodeId: `vector_cut_${safeToolCallId}_${document.revision}`,
                      start: input.start,
                    },
          );
    if (!plan.ok) {
      throw new Error(`vector-edit.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.operations,
      request.context.mutationTarget,
    );
    const transaction = {
      transactionId:
        `transaction_agent_vector_${request.call.toolCallId}_${Date.now()}`.slice(
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
      commands: [...plan.operations],
    } satisfies DesignTransaction;
    throwIfAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    const singleNodeId =
      input.action === "cut-layers-with-line" ? undefined : input.nodeId;
    const applied = singleNodeId
      ? runtime.getSnapshot().document.nodesById[singleNodeId]
      : undefined;
    const network =
      applied &&
      (applied.kind === "path" || applied.kind === "vector") &&
      "network" in applied.properties
        ? applied.properties.network
        : undefined;
    const pathId =
      input.action === "cut-with-line" ||
      input.action === "cut-layers-with-line"
        ? undefined
        : (input.pathId ?? network?.paths[0]?.id);
    const path = network?.paths.find((candidate) => candidate.id === pathId);
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        content: {
          ok: true,
          action: input.action,
          label: input.label,
          pageId: input.pageId,
          ...(input.action === "cut-layers-with-line"
            ? { nodeIds: input.nodeIds }
            : { nodeId: input.nodeId }),
          ...(pathId ? { pathId, closed: path?.closed } : {}),
          ...(plan.cutResult
            ? {
                cutVertexIds: plan.cutResult.cutVertexIds,
                pathIds: plan.cutResult.pathIds,
              }
            : {}),
          ...(plan.lineCutResult
            ? {
                extractedPathIds: plan.lineCutResult.extractedPathIds,
                intersectionCount: plan.lineCutResult.intersectionCount,
                resultNodeIds: plan.lineCutResult.resultNodeIds,
                retainedPathIds: plan.lineCutResult.retainedPathIds,
              }
            : {}),
          ...(plan.layerLineCutResult
            ? {
                resultNodeIds: plan.layerLineCutResult.resultNodeIds,
                targets: plan.layerLineCutResult.targets,
              }
            : {}),
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
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
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
  const commands = normalizeAgentInsertHierarchy(request.call.input.commands);
  assertCommandsWithinMutationTarget(
    document,
    commands,
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
    commands,
  } satisfies DesignTransaction;
  const preview = runtime.preview(transaction);
  if (!preview.ok)
    throw designTransactionToolError(preview.error, transaction.commands);
  return await applyProgressively(
    request,
    runtime,
    transaction,
    preview,
    options.signal,
    options.stageDelayMs ?? 100,
  );
}

function normalizeAgentInsertHierarchy(
  commands: readonly DesignOperation[],
): DesignOperation[] {
  const insertByNodeId = new Map<
    string,
    {
      command: Extract<DesignOperation, { type: "insert_element" }>;
      index: number;
    }
  >();
  commands.forEach((command, index) => {
    if (command.type !== "insert_element") return;
    insertByNodeId.set(command.node.id, { command, index });
  });
  return commands.map((command, index) => {
    if (
      command.type !== "insert_element" ||
      command.node.childIds.length === 0
    ) {
      return command;
    }
    for (const childId of command.node.childIds) {
      const child = insertByNodeId.get(childId);
      if (
        !child ||
        child.index <= index ||
        child.command.parentId !== command.node.id ||
        child.command.node.parentId !== command.node.id
      ) {
        throw insertHierarchyToolError(
          command,
          childId,
          `Agent insert ${command.commandId} declares child ${childId} in node.childIds without a later matching insert_element command. Keep insert_element node.childIds empty and express hierarchy only through each child command's parentId and index`,
        );
      }
    }
    return {
      ...command,
      node: {
        ...command.node,
        childIds: [],
      },
    };
  });
}

function insertHierarchyToolError(
  command: Extract<DesignOperation, { type: "insert_element" }>,
  childId: string,
  message: string,
): DesignTransactionToolError {
  const issue: AgentToolFailureIssue = {
    commandId: command.commandId,
    nodeId: command.node.id,
    path: `/nodesById/${escapeJsonPointerSegment(command.node.id)}/childIds`,
    message,
  };
  return new DesignTransactionToolError({
    code: "design.invalid",
    message,
    retryable: false,
    recoverable: true,
    details: {
      kind: "design-transaction",
      fingerprint: `design_${hashFailureText(
        `${command.commandId}\u0000${command.node.id}\u0000${childId}\u0000${message}`,
      )}`,
      issues: [issue],
      recovery: {
        action: "inspect-and-revise",
        toolName: "opendesign_inspect_document",
        required: true,
      },
    },
  });
}

function escapeJsonPointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function canRebasePlannedInsert(
  request: RendererDesignToolRequest,
  document: DesignDocument,
): boolean {
  if (
    request.call.toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME ||
    !isInternalDesignApplyToolInput(request.call.input)
  ) {
    return false;
  }
  const guard = request.call.input.rebaseGuard;
  if (
    !guard ||
    guard.fromRevision !== request.context.revision ||
    request.call.input.commands.some(
      (command) => command.type !== "insert_element",
    )
  ) {
    return false;
  }
  const insertedParents = new Map(
    request.call.input.commands.map((command) => {
      if (command.type !== "insert_element") {
        throw new Error("Planned rebase accepts insert commands only");
      }
      return [command.node.id, command.parentId] as const;
    }),
  );
  for (const target of guard.targets) {
    const page = document.pagesById[target.pageId];
    const frame = document.nodesById[target.frameId];
    if (
      !page?.rootNodeIds.includes(target.frameId) ||
      frame?.kind !== "frame" ||
      frame.parentId !== null ||
      !isTranslationOnly(frame.transform) ||
      frame.size.width !== target.width ||
      frame.size.height !== target.height
    ) {
      return false;
    }
  }
  return request.call.input.commands.every((command) => {
    if (command.type !== "insert_element") return false;
    return guard.targets.some((target) =>
      currentParentChainReaches(
        command.parentId,
        target.frameId,
        insertedParents,
        document,
      ),
    );
  });
}

function currentParentChainReaches(
  parentId: string | null,
  ancestorId: string,
  insertedParents: ReadonlyMap<string, string | null>,
  document: DesignDocument,
): boolean {
  let current = parentId;
  const visited = new Set<string>();
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = insertedParents.has(current)
      ? (insertedParents.get(current) ?? null)
      : (document.nodesById[current]?.parentId ?? null);
  }
  return false;
}

function isTranslationOnly(transform: readonly number[]): boolean {
  return (
    transform.length === 6 &&
    transform[0] === 1 &&
    transform[1] === 0 &&
    transform[2] === 0 &&
    transform[3] === 1 &&
    Number.isFinite(transform[4]) &&
    Number.isFinite(transform[5])
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
  const remainingCommands = [...transaction.commands];
  let appliedStages = 0;
  let lastResult: DesignTransactionSuccess | undefined;
  try {
    while (remainingCommands.length > 0) {
      throwIfAborted(signal);
      const currentRevision = runtime.getSnapshot().document.revision;
      const commands = nextValidProgressiveStage(
        runtime,
        transaction,
        remainingCommands,
        appliedStages === 0
          ? transaction.commands.length <= 3
            ? transaction.commands.length
            : 1
          : 3,
        appliedStages,
      );
      const finalStage = commands.length === remainingCommands.length;
      const onlyStage =
        appliedStages === 0 &&
        finalStage &&
        remainingCommands.length === transaction.commands.length;
      const result = runtime.apply(
        {
          ...transaction,
          transactionId: onlyStage
            ? transaction.transactionId
            : `${transaction.transactionId}_stage_${appliedStages + 1}`,
          baseRevision: currentRevision,
          commands,
        },
        {
          historyGroupId: transaction.transactionId,
          finalizeHistoryGroup: finalStage,
        },
      );
      if (!result.ok) {
        throw designTransactionToolError(result.error, commands);
      }
      appliedStages += 1;
      lastResult = result;
      remainingCommands.splice(0, commands.length);
      if (remainingCommands.length > 0) {
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
        stages: appliedStages,
        changes,
        warnings: lastResult.warnings,
      },
      designRevision: {
        previousRevision: transaction.baseRevision,
        ...(transaction.baseRevision === request.context.revision
          ? {}
          : { rebasedFromRevision: request.context.revision }),
        revision: lastResult.revision.revision,
        transactionId: transaction.transactionId,
      },
    },
  };
}

function nextValidProgressiveStage(
  runtime: EditorRuntime,
  transaction: DesignTransaction,
  remainingCommands: readonly DesignOperation[],
  preferredCommandCount: number,
  stageIndex: number,
): DesignOperation[] {
  const baseRevision = runtime.getSnapshot().document.revision;
  const firstCandidateSize = Math.min(
    Math.max(1, preferredCommandCount),
    remainingCommands.length,
  );
  let lastFailure: ReturnType<EditorRuntime["preview"]> | undefined;
  for (
    let commandCount = firstCandidateSize;
    commandCount <= remainingCommands.length;
    commandCount += 1
  ) {
    const commands = remainingCommands.slice(0, commandCount);
    const candidate = runtime.preview({
      ...transaction,
      transactionId: `${transaction.transactionId}_preview_stage_${stageIndex + 1}_${commandCount}`,
      baseRevision,
      commands,
    });
    if (candidate.ok) return commands;
    lastFailure = candidate;
  }
  if (lastFailure && !lastFailure.ok) {
    throw designTransactionToolError(lastFailure.error, remainingCommands);
  }
  throw new Error("Design transaction has no document-valid visible stage");
}

class DesignTransactionToolError extends Error {
  constructor(readonly failure: TrustedToolFailure) {
    super(failure.message);
    this.name = "DesignTransactionToolError";
  }
}

function designTransactionToolError(
  error: DesignError,
  commands: readonly DesignOperation[],
): DesignTransactionToolError {
  const issues = designFailureIssues(error, commands);
  const firstIssue = issues[0];
  const specificMessage = firstIssue
    ? `${error.message}: ${firstIssue.path || "document"}: ${firstIssue.message}`
    : error.message;
  const fingerprintSource = issues
    .map(
      (issue) =>
        `${issue.commandId ?? ""}\u0000${issue.nodeId ?? ""}\u0000${issue.path}\u0000${issue.message}`,
    )
    .join("\u0001");
  return new DesignTransactionToolError({
    code: `design.${error.code}`,
    message: specificMessage,
    retryable: error.retryable,
    recoverable:
      error.code === "invalid" ||
      error.code === "conflict" ||
      error.code === "not-found" ||
      error.code === "duplicate",
    details: {
      kind: "design-transaction",
      fingerprint: `design_${hashFailureText(fingerprintSource)}`,
      issues,
      recovery: {
        action: "inspect-and-revise",
        toolName: "opendesign_inspect_document",
        required: true,
      },
    },
  });
}

function designFailureIssues(
  error: DesignError,
  commands: readonly DesignOperation[],
): AgentToolFailureIssue[] {
  const rawIssues = Array.isArray(error.details)
    ? error.details.flatMap((value) => {
        const issue = recordValue(value);
        if (!issue) return [];
        return typeof issue.path === "string" &&
          typeof issue.message === "string"
          ? [{ path: issue.path, message: issue.message }]
          : [];
      })
    : [];
  const issues =
    rawIssues.length > 0
      ? rawIssues
      : [{ path: error.path ?? "", message: error.message }];
  return issues.slice(0, 128).map((issue) => {
    const nodeId = nodeIdFromInvariantPath(issue.path);
    const commandId =
      error.commandId ?? commandIdForNode(commands, nodeId) ?? undefined;
    return {
      ...(commandId ? { commandId } : {}),
      ...(nodeId ? { nodeId } : {}),
      path: issue.path.slice(0, 4_000),
      message: issue.message.slice(0, 20_000),
    };
  });
}

function nodeIdFromInvariantPath(path: string): string | undefined {
  const match = /^\/nodesById\/([^/]+)/.exec(path);
  if (!match?.[1]) return undefined;
  return match[1].replaceAll("~1", "/").replaceAll("~0", "~");
}

function commandIdForNode(
  commands: readonly DesignOperation[],
  nodeId: string | undefined,
): string | undefined {
  if (!nodeId) return undefined;
  return [...commands]
    .reverse()
    .find((command) => commandDirectlyTargetsNode(command, nodeId))?.commandId;
}

function commandDirectlyTargetsNode(
  command: DesignOperation,
  nodeId: string,
): boolean {
  switch (command.type) {
    case "insert_element":
      return command.node.id === nodeId;
    case "update_properties":
    case "move_element":
    case "delete_element":
      return command.nodeId === nodeId;
    case "replace_subtree":
      return command.nodes.some((node) => node.id === nodeId);
    default:
      return false;
  }
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hashFailureText(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
      node.kind === "line" ||
      node.kind === "polygon" ||
      node.kind === "star" ||
      node.kind === "text" ||
      node.kind === "path" ||
      node.kind === "vector" ||
      node.kind === "boolean"
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
    if (
      command.type === "insert_page" ||
      command.type === "update_page" ||
      command.type === "move_page" ||
      command.type === "delete_page"
    ) {
      throw new Error("Agent Page changes require the dedicated Page tool");
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

function assertPageToolMutationTarget(
  input: DesignPageToolInput,
  mutationTarget: DesignMutationTarget,
): void {
  if (input.action === "rename" && mutationTarget.kind === "page") {
    if (input.pageId !== mutationTarget.pageId) {
      throw new Error(
        `Page rename targets ${input.pageId} outside the registered Page scope`,
      );
    }
    return;
  }
  if (mutationTarget.kind !== "document") {
    throw new Error(
      `${input.action} requires the Design File mutation scope selected before this Run`,
    );
  }
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
