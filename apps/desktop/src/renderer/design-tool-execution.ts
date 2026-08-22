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
  TextFontDescriptor,
} from "@opendesign/design-contracts";
import type { TextLayoutQualityEvidence } from "@opendesign/text-service";
import {
  componentMainNodeId,
  diagnoseDesignTargetLayout,
  diagnoseDesignPages,
  planClearPage,
  planCreatePage,
  planCreateBooleanGroup,
  planDeletePage,
  planDuplicatePage,
  planGroupNodes,
  planImageNodeUpdate,
  planImagePaintFilterUpdate,
  planReparentNodes,
  planReorderNodes,
  planRenamePage,
  planReorderPage,
  planSvgImport,
  planSetBooleanOperation,
  planUngroupBooleanGroup,
  planUngroupNode,
  planVectorLayersLineCut,
  planVectorLayersVertexTransform,
  planVectorSemanticEdit,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  isDesignArrangeToolInput,
  isDesignApplyToolInput,
  isDesignComponentToolInput,
  isDesignFontToolInput,
  isDesignHierarchyToolInput,
  isDesignPageToolInput,
  isDesignTextRangeToolInput,
  isDesignVectorToolInput,
  isExportSvgToolInput,
  isExportRasterToolInput,
  isInternalDesignApplyToolInput,
  isInternalImportSvgToolInput,
  isInternalUpdateImageToolInput,
  type DesignComponentToolInput,
  type DesignFontToolInput,
  type DesignPageToolInput,
  type DesignTextRangeToolInput,
} from "../shared/design-agent-tools";
import { createAgentDesignIdAllocation } from "../shared/design-id-allocation";
import type {
  RendererDesignToolProgressPhase,
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "../shared/design-tool-bridge";
import { runSvgExportInWorker, runSvgImportInWorker } from "./svg-interchange";
import { exportDesignRaster } from "./raster-export";
import { normalizeAgentTextContent } from "./agent-text-normalization";
import { throwIfAgentGenerationAborted } from "./agent-generation-timing";
import { executeSemanticDesignTransaction } from "./design-transaction-steps";
import { planDesignArrangeTool } from "./design-arrange-tool-plan";
import { planDesignComponentTool } from "./design-component-tool-plan";
import { createScopedComponentInspection } from "./design-component-inspection";
import { createScopedVariableInspection } from "./design-variable-inspection";
import { createScopedStyleInspection } from "./design-style-inspection";
import { executeDesignSystemToolRequest } from "./design-system-tool-execution";

type ExecuteDesignToolOptions = {
  captureCanvas?: (document: DesignDocument) => Promise<{
    attachment: {
      attachmentId: string;
      byteSize: number;
      mimeType: "image/jpeg";
      name: string;
    };
    height: number;
    textLayoutQuality?: TextLayoutQualityEvidence;
    width: number;
  }>;
  exportSvg?: typeof runSvgExportInWorker;
  exportRaster?: typeof exportDesignRaster;
  importSvg?: typeof runSvgImportInWorker;
  signal?: AbortSignal;
  stageDelayMs?: number;
  onProgress?: (
    phase: RendererDesignToolProgressPhase,
    progress: number,
    message?: string,
  ) => void;
  onCanvasWait?: (durationMs: number, configuredDelayMs: number) => void;
};

const MAX_INSPECTED_FONT_REQUESTS = 256;
const MAX_INSPECTED_FONT_NODE_IDS = 1_000;
const MAX_INSPECTED_STAGED_IMAGE_ASSETS = 64;

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
  options.onProgress?.("accepted", 0.02);
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
          runtime,
          request.context.runId,
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
    options.onProgress?.("capturing", 0.15);
    const preview = await options.captureCanvas(document);
    options.onProgress?.("capturing", 0.9);
    const layoutQuality =
      request.captureTarget.kind === "frame"
        ? diagnoseDesignTargetLayout(
            document,
            request.captureTarget.pageId,
            request.captureTarget.nodeId,
            request.captureTarget.qualityProfile,
            preview.textLayoutQuality,
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

  if (
    request.call.toolName === DESIGN_COMPONENT_TOOL_NAME &&
    isDesignComponentToolInput(request.call.input)
  ) {
    const input = request.call.input;
    if (document.revision !== request.context.revision) {
      throw new Error(
        `Component operation revision conflict: expected ${request.context.revision}, current ${document.revision}`,
      );
    }
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Component operation",
    );
    assertComponentInputPage(document, input);
    const operationId =
      `agent_component_${request.call.toolCallId}_${document.revision}`.slice(
        0,
        220,
      );
    if (input.action === "go-to-main") {
      const mainNodeId = componentMainNodeId(document, input.instanceId);
      if (!mainNodeId)
        throw new Error(`Instance ${input.instanceId} does not exist`);
      const pageId = document.pageOrder.find((candidatePageId) =>
        pageNodeIds(document, candidatePageId).has(mainNodeId),
      );
      if (!pageId)
        throw new Error(`Component main ${mainNodeId} is not on a Page`);
      return {
        requestId: request.requestId,
        ok: true,
        result: {
          observedRevision: document.revision,
          content: {
            kind: "component-location-result",
            version: 1,
            instanceId: input.instanceId,
            mainNodeId,
            pageId,
            revision: document.revision,
          },
        },
      };
    }
    const plan = planDesignComponentTool(document, input, operationId);
    if (!plan.ok) {
      throw new Error(`component-operation.${plan.code}: ${plan.message}`);
    }
    assertCommandsWithinMutationTarget(
      document,
      plan.commands,
      request.context.mutationTarget,
      { allowComponentCommands: true },
    );
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
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        observedRevision: result.revision.revision,
        content: {
          kind: "component-operation-result",
          version: 1,
          action: input.action,
          componentId: plan.componentId,
          ...("instanceId" in plan && plan.instanceId
            ? { instanceId: plan.instanceId }
            : {}),
          mainNodeId: plan.mainNodeId,
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

  const designSystemResponse = executeDesignSystemToolRequest({
    document,
    request,
    runtime,
    throwTransactionFailure: (error, commands) => {
      throw designTransactionToolError(error, commands);
    },
  });
  if (designSystemResponse) return designSystemResponse;

  if (document.revision !== request.context.revision) {
    if (
      document.revision < request.context.revision ||
      (!canRebasePlannedInsert(request, document) &&
        !canRebaseNewDesignFileAssets(request, document))
    ) {
      throw new Error(
        `Design revision conflict: expected ${request.context.revision}, current ${document.revision}`,
      );
    }
  }

  if (
    request.call.toolName === DESIGN_FONT_TOOL_NAME &&
    isDesignFontToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Font",
    );
    assertFontInputPage(document, input);
    const safeToolCallId =
      request.call.toolCallId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96) ||
      "tool";
    const command: Extract<DesignOperation, { type: "reflow_text" }> = {
      commandId: `font_${input.action}_${safeToolCallId}`.slice(0, 256),
      type: "reflow_text",
      nodeIds: [...input.nodeIds],
      expectedFont: structuredClone(input.expectedFont),
      ...(input.action === "replace"
        ? { replacementFont: structuredClone(input.replacementFont) }
        : {}),
    };
    const transaction = {
      transactionId: `transaction_agent_font_${safeToolCallId}_${document.revision}`,
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: {
        type: "agent",
        id: `agent_${request.context.sessionId}`,
        displayName: "OpenDesign Agent",
      },
      label: input.label,
      commands: [command],
    } satisfies DesignTransaction;
    assertCommandsWithinMutationTarget(
      document,
      transaction.commands,
      request.context.mutationTarget,
    );
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    return await executeSemanticDesignTransaction({
      request,
      runtime,
      transaction,
      preview,
      execution: options,
      createFailure: designTransactionToolError,
    });
  }

  if (
    request.call.toolName === DESIGN_TEXT_RANGE_TOOL_NAME &&
    isDesignTextRangeToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageWithinMutationTarget(
      input.pageId,
      request.context.mutationTarget,
      "Text range",
    );
    assertTextRangeInputPage(document, input);
    const safeToolCallId =
      request.call.toolCallId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96) ||
      "tool";
    const command: Extract<
      DesignOperation,
      { type: "update_text_range_style" }
    > = {
      commandId: `text_range_${safeToolCallId}`.slice(0, 256),
      type: "update_text_range_style",
      nodeId: input.nodeId,
      start: input.start,
      end: input.end,
      style: structuredClone(input.style),
    };
    const transaction = {
      transactionId: `transaction_agent_text_range_${safeToolCallId}_${document.revision}`,
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: {
        type: "agent",
        id: `agent_${request.context.sessionId}`,
        displayName: "OpenDesign Agent",
      },
      label: input.label,
      commands: [command],
    } satisfies DesignTransaction;
    assertCommandsWithinMutationTarget(
      document,
      transaction.commands,
      request.context.mutationTarget,
    );
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    return await executeSemanticDesignTransaction({
      request,
      runtime,
      transaction,
      preview,
      execution: options,
      createFailure: designTransactionToolError,
    });
  }

  if (
    request.call.toolName === DESIGN_PAGE_TOOL_NAME &&
    isDesignPageToolInput(request.call.input)
  ) {
    const input = request.call.input;
    assertPageToolMutationTarget(input, request.context.mutationTarget);
    throwIfAgentGenerationAborted(options.signal);
    const safeToolCallId =
      request.call.toolCallId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96) ||
      "tool";
    const operationId =
      `agent_page_${safeToolCallId}_${document.revision}`.slice(0, 120);
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
              : input.action === "clear"
                ? planClearPage(document, {
                    pageId: input.pageId,
                    commandPrefix: operationId,
                  })
                : planDeletePage(document, {
                    pageId: input.pageId,
                    commandPrefix: operationId,
                  });
    if (!plan.ok && input.action === "clear" && plan.code === "no-op") {
      const page = document.pagesById[input.pageId];
      if (!page) {
        throw new Error(
          `page-operation.invalid: Page ${input.pageId} does not exist`,
        );
      }
      return {
        requestId: request.requestId,
        ok: true,
        result: {
          observedRevision: document.revision,
          content: {
            kind: "page-operation-result",
            version: 1,
            ok: true,
            action: "clear",
            pageId: page.id,
            name: page.name,
            pageOrder: [...document.pageOrder],
            revision: document.revision,
            atomic: true,
            unchanged: true,
          },
        },
      };
    }
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
    const imported = await (options.importSvg ?? runSvgImportInWorker)(
      {
        svg: input.svg,
        idPrefix: input.idPrefix,
        name: input.name,
      },
      options.signal,
    );
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
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
    throwIfAgentGenerationAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAgentGenerationAborted(options.signal);
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
    const commandPrefix =
      `arrange_${input.action}_${request.call.toolCallId}`.slice(0, 200);
    const plan = planDesignArrangeTool(document, input, commandPrefix);
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
    throwIfAgentGenerationAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAgentGenerationAborted(options.signal);
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
          nodeIds:
            "selectionNodeIds" in plan ? plan.selectionNodeIds : plan.nodeIds,
          ...(input.action === "resize-frame"
            ? {
                frameId: input.frameId,
                width: input.width,
                height: input.height,
              }
            : {}),
          ...(input.action === "set-constraints"
            ? { nodeId: input.nodeId, constraints: input.constraints }
            : {}),
          ...(input.action === "set-auto-layout"
            ? { frameId: input.frameId, autoLayout: input.autoLayout }
            : {}),
          ...(input.action === "set-layout-sizing"
            ? { nodeId: input.nodeId, sizing: input.sizing }
            : {}),
          ...(input.action === "set-layout-positioning"
            ? {
                nodeId: input.nodeId,
                positioning: input.positioning,
                ...(input.constraints
                  ? { constraints: input.constraints }
                  : {}),
              }
            : {}),
          ...(input.action === "set-layout-limits"
            ? { nodeId: input.nodeId, limits: input.limits }
            : {}),
          ...(input.action === "set-layout-guides"
            ? { frameId: input.frameId, layoutGuides: input.layoutGuides }
            : {}),
          ...(input.action === "set-grid-placement"
            ? { nodeId: input.nodeId, placement: input.placement }
            : {}),
          ...(input.action === "reorder-grid-tracks"
            ? {
                frameId: input.frameId,
                axis: input.axis,
                movements: "movements" in plan ? plan.movements : [],
              }
            : {}),
          ...(input.action !== "resize-frame" &&
          input.action !== "set-constraints" &&
          input.action !== "set-auto-layout" &&
          input.action !== "set-layout-sizing" &&
          input.action !== "set-layout-positioning" &&
          input.action !== "set-layout-limits" &&
          input.action !== "set-layout-guides" &&
          input.action !== "set-grid-placement" &&
          input.action !== "reorder-grid-tracks" &&
          "orderedNodeIds" in plan
            ? { orderedNodeIds: plan.orderedNodeIds }
            : {}),
          ...(!("resolvedSpacing" in plan) || plan.resolvedSpacing === undefined
            ? {}
            : { resolvedSpacing: plan.resolvedSpacing }),
          ...(!("tidyUpDimension" in plan) || plan.tidyUpDimension === undefined
            ? {}
            : { tidyUpDimension: plan.tidyUpDimension }),
          ...(!("resolvedHorizontalSpacing" in plan) ||
          plan.resolvedHorizontalSpacing === undefined
            ? {}
            : {
                resolvedHorizontalSpacing: plan.resolvedHorizontalSpacing,
              }),
          ...(!("resolvedVerticalSpacing" in plan) ||
          plan.resolvedVerticalSpacing === undefined
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
        : input.action === "transform-layers-vertices"
          ? planVectorLayersVertexTransform(
              document,
              input.pageId,
              input.targets,
              input.transform,
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
                  : input.action === "connect-endpoints"
                    ? {
                        action: input.action,
                        vertexIds: input.vertexIds,
                      }
                    : input.action === "disconnect-vertex"
                      ? {
                          action: input.action,
                          pathId: input.pathId,
                          vertexId: input.vertexId,
                        }
                      : input.action === "transform-vertices"
                        ? {
                            action: input.action,
                            transform: input.transform,
                            vertexIds: input.vertexIds,
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
    throwIfAgentGenerationAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAgentGenerationAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    const singleNodeId =
      input.action === "cut-layers-with-line" ||
      input.action === "transform-layers-vertices"
        ? undefined
        : input.nodeId;
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
      input.action === "cut-layers-with-line" ||
      input.action === "transform-layers-vertices"
        ? undefined
        : (("pathId" in input ? input.pathId : undefined) ??
          network?.paths[0]?.id);
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
          ...(input.action === "cut-layers-with-line" ||
          input.action === "transform-layers-vertices"
            ? {
                nodeIds:
                  input.action === "cut-layers-with-line"
                    ? input.nodeIds
                    : input.targets.map((target) => target.nodeId),
              }
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
    const plan =
      input.action === "set-paint-filters"
        ? planImagePaintFilterUpdate(
            document,
            {
              pageId: input.pageId,
              nodeId: input.nodeId,
              paintField: input.paintField,
              paintIndex: input.paintIndex,
              expectedPaint: input.expectedPaint,
              filters: input.filters,
            },
            commandPrefix,
          )
        : planImageNodeUpdate(
            document,
            input.action === "set-placement"
              ? {
                  action: input.action,
                  pageId: input.pageId,
                  nodeId: input.nodeId,
                  placement: input.placement,
                }
              : input.action === "set-filters"
                ? {
                    action: input.action,
                    pageId: input.pageId,
                    nodeId: input.nodeId,
                    filters: input.filters,
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
    throwIfAgentGenerationAborted(options.signal);
    const preview = runtime.preview(transaction);
    if (!preview.ok) {
      throw designTransactionToolError(preview.error, transaction.commands);
    }
    throwIfAgentGenerationAborted(options.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) {
      throw designTransactionToolError(result.error, transaction.commands);
    }
    const applied = runtime.getSnapshot().document.nodesById[input.nodeId];
    const appliedPaint =
      input.action === "set-paint-filters" &&
      applied &&
      applied.kind !== "group" &&
      applied.kind !== "image" &&
      applied.kind !== "instance" &&
      applied.kind !== "slice"
        ? applied.properties[input.paintField][input.paintIndex]
        : undefined;
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
          filters:
            input.action === "set-paint-filters" &&
            appliedPaint?.type === "image"
              ? (appliedPaint.filters ?? {})
              : applied?.kind === "image"
                ? (applied.properties.filters ?? {})
                : undefined,
          ...(input.action === "set-paint-filters"
            ? {
                paintField: input.paintField,
                paintIndex: input.paintIndex,
                assetId:
                  appliedPaint?.type === "image"
                    ? appliedPaint.assetId
                    : undefined,
              }
            : {}),
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
  const commands = normalizeAgentTextContent(
    normalizeAgentInsertHierarchy(request.call.input.commands),
  );
  assertAgentDoesNotBypassFrameConstraints(document, commands);
  assertAgentDoesNotBypassAutoLayout(document, commands);
  assertAgentDoesNotBypassImageWorkflow(document, commands);
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
  return await executeSemanticDesignTransaction({
    request,
    runtime,
    transaction,
    preview,
    execution: options,
    createFailure: designTransactionToolError,
  });
}

function canRebaseNewDesignFileAssets(
  request: RendererDesignToolRequest,
  document: DesignDocument,
): boolean {
  if (
    request.call.toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME ||
    !isInternalDesignApplyToolInput(request.call.input) ||
    request.call.input.commands.length === 0
  ) {
    return false;
  }
  return request.call.input.commands.every(
    (command) =>
      command.type === "put_asset" &&
      document.assetsById[command.asset.id] === undefined,
  );
}

function assertAgentDoesNotBypassAutoLayout(
  document: DesignDocument,
  commands: readonly DesignOperation[],
): void {
  for (const command of commands) {
    const commandNodes =
      command.type === "insert_element"
        ? [command.node]
        : command.type === "replace_subtree"
          ? command.nodes
          : [];
    if (commandNodes.some((node) => node.layoutPositioning !== undefined)) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure flow or absolute positioning with opendesign_arrange_layers action set-layout-positioning`,
      );
    }
    if (commandNodes.some((node) => node.gridPlacement !== undefined)) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure Grid cells and spans with opendesign_arrange_layers action set-grid-placement`,
      );
    }
    const writesLayoutGuides =
      commandNodes.some(
        (node) =>
          node.kind === "frame" && node.properties.layoutGuides !== undefined,
      ) ||
      (command.type === "update_properties" &&
        command.properties !== undefined &&
        Object.hasOwn(command.properties, "layoutGuides"));
    if (writesLayoutGuides) {
      throw new Error(
        `design_workflow.layout_guides_requires_layout_tool: Configure Frame layout guides with opendesign_arrange_layers action set-layout-guides`,
      );
    }
    if (
      command.type === "update_properties" &&
      command.layoutSizing !== undefined
    ) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure flow-child sizing with opendesign_arrange_layers action set-layout-sizing`,
      );
    }
    if (
      command.type === "update_properties" &&
      command.layoutPositioning !== undefined
    ) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure flow or absolute positioning with opendesign_arrange_layers action set-layout-positioning`,
      );
    }
    if (
      command.type === "update_properties" &&
      command.layoutLimits !== undefined
    ) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure Auto Layout min/max sizing with opendesign_arrange_layers action set-layout-limits`,
      );
    }
    if (
      command.type === "update_properties" &&
      command.gridPlacement !== undefined
    ) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure Grid cells and spans with opendesign_arrange_layers action set-grid-placement`,
      );
    }
    if (
      command.type === "update_properties" &&
      command.properties !== undefined &&
      Object.hasOwn(command.properties, "autoLayout")
    ) {
      throw new Error(
        `design_workflow.auto_layout_requires_layout_tool: Configure Frame Auto Layout with opendesign_arrange_layers action set-auto-layout`,
      );
    }
    if (
      command.type !== "update_properties" ||
      (command.transform === undefined && command.size === undefined)
    ) {
      continue;
    }
    const node = document.nodesById[command.nodeId];
    const parent = node?.parentId
      ? document.nodesById[node.parentId]
      : undefined;
    if (
      parent?.kind !== "frame" ||
      parent.properties.autoLayout === undefined ||
      parent.properties.autoLayout.mode === "none" ||
      node.layoutPositioning === "absolute"
    ) {
      continue;
    }
    throw new Error(
      `design_workflow.auto_layout_requires_layout_tool: Layer ${node.id} participates in Frame ${parent.id} Auto Layout; change the parent with opendesign_arrange_layers action set-auto-layout or reorder hierarchy instead of setting child geometry`,
    );
  }
}

function assertAgentDoesNotBypassFrameConstraints(
  document: DesignDocument,
  commands: readonly DesignOperation[],
): void {
  for (const command of commands) {
    if (command.type !== "update_properties" || command.size === undefined) {
      continue;
    }
    const node = document.nodesById[command.nodeId];
    if (node?.kind !== "frame" || node.childIds.length === 0) continue;
    throw new Error(
      `design_workflow.frame_resize_requires_layout_tool: Frame ${node.id} has children; resize it with opendesign_arrange_layers action resize-frame so constraints are resolved in one atomic transaction`,
    );
  }
}

function assertAgentDoesNotBypassImageWorkflow(
  document: DesignDocument,
  commands: readonly DesignOperation[],
): void {
  for (const command of commands) {
    if (command.type !== "update_properties" || !command.properties) continue;
    const node = document.nodesById[command.nodeId];
    if (node?.kind !== "image") continue;
    if (
      command.properties.assetId !== undefined ||
      command.properties.placement !== undefined ||
      command.properties.filters !== undefined
    ) {
      throw new Error(
        `design_workflow.image_update_requires_image_tool: Update Image node ${node.id} with opendesign_update_image so source, placement, and filters remain non-destructive and atomic`,
      );
    }
  }
  for (const command of commands) {
    if (command.type !== "update_properties" || !command.properties) continue;
    const node = document.nodesById[command.nodeId];
    if (
      !node ||
      node.kind === "group" ||
      node.kind === "image" ||
      node.kind === "instance" ||
      node.kind === "slice"
    ) {
      continue;
    }
    for (const field of ["fills", "strokes"] as const) {
      const next = command.properties[field];
      if (!Array.isArray(next)) continue;
      const currentFilters = node.properties[field].map((paint) =>
        paint.type === "image" ? (paint.filters ?? {}) : null,
      );
      const nextFilters = next.map((paint) => {
        if (
          typeof paint !== "object" ||
          paint === null ||
          Array.isArray(paint) ||
          paint.type !== "image"
        ) {
          return null;
        }
        return typeof paint.filters === "object" && paint.filters !== null
          ? paint.filters
          : {};
      });
      if (JSON.stringify(currentFilters) !== JSON.stringify(nextFilters)) {
        throw new Error(
          `design_workflow.image_paint_update_requires_image_tool: Update an existing image ${field} on node ${node.id} with opendesign_update_image action set-paint-filters so the exact paint identity remains non-destructive and stale-safe`,
        );
      }
    }
  }
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
    case "update_text_range_style":
    case "move_element":
    case "delete_element":
      return command.nodeId === nodeId;
    case "reflow_text":
      return command.nodeIds.includes(nodeId);
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

function createScopedInspection(
  document: DesignDocument,
  mutationTarget: DesignMutationTarget,
  selectionContext: SelectionScope,
  runtime: EditorRuntime,
  runId: string,
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
          explicitVariableModes: structuredClone(
            page.explicitVariableModes ?? {},
          ),
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
  const fontRequests = new Map<
    string,
    TextFontDescriptor & { nodeIds: string[] }
  >();
  for (const node of Object.values(nodesById)) {
    if (node.kind !== "text") continue;
    for (const font of [
      {
        fontFamily: node.properties.fontFamily,
        fontStyleName: node.properties.fontStyleName,
        fontWeight: node.properties.fontWeight,
        fontSlant: node.properties.fontSlant,
      },
      ...(node.properties.runs ?? []).map((run) => ({
        fontFamily: run.style.fontFamily,
        fontStyleName: run.style.fontStyleName,
        fontWeight: run.style.fontWeight,
        fontSlant: run.style.fontSlant,
      })),
    ]) {
      const key = JSON.stringify([
        font.fontFamily,
        font.fontStyleName,
        font.fontWeight,
        font.fontSlant,
      ]);
      const existing = fontRequests.get(key);
      if (existing) {
        if (!existing.nodeIds.includes(node.id)) existing.nodeIds.push(node.id);
      } else {
        fontRequests.set(key, { ...font, nodeIds: [node.id] });
      }
    }
  }
  const sortedFontRequests = [...fontRequests.values()].sort(
    (left, right) =>
      left.fontFamily.localeCompare(right.fontFamily) ||
      (left.fontStyleName ?? "").localeCompare(right.fontStyleName ?? "") ||
      left.fontWeight - right.fontWeight ||
      left.fontSlant.localeCompare(right.fontSlant),
  );
  const fontAvailability = sortedFontRequests
    .slice(0, MAX_INSPECTED_FONT_REQUESTS)
    .map((font) => {
      const nodeIds = font.nodeIds.sort((left, right) =>
        left.localeCompare(right),
      );
      return {
        fontFamily: font.fontFamily,
        fontStyleName: font.fontStyleName,
        fontWeight: font.fontWeight,
        fontSlant: font.fontSlant,
        nodeCount: nodeIds.length,
        nodeIds: nodeIds.slice(0, MAX_INSPECTED_FONT_NODE_IDS),
        nodeIdsTruncated: nodeIds.length > MAX_INSPECTED_FONT_NODE_IDS,
        ...runtime.inspectTextFont(font),
      };
    });
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
        ...(node.kind === "text"
          ? (node.properties.runs ?? []).flatMap((run) => run.style.fills)
          : []),
      ]) {
        if (paint.type === "image") assetIds.add(paint.assetId);
      }
    }
  }
  const stagedAssetIds = Object.values(document.assetsById)
    .filter(
      (asset) =>
        asset.kind === "image" &&
        asset.extensions.generatedBy === "opendesign-agent",
    )
    .slice(-MAX_INSPECTED_STAGED_IMAGE_ASSETS)
    .map((asset) => asset.id);
  stagedAssetIds.forEach((assetId) => assetIds.add(assetId));
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
            ...(asset.extensions.generatedBy === "opendesign-agent"
              ? {
                  availability: "design-file",
                  generated: true,
                  ...(typeof asset.extensions.designRole === "string"
                    ? { designRole: asset.extensions.designRole }
                    : {}),
                }
              : {}),
          },
        ],
      ];
    }),
  );
  const diagnostics = diagnoseDesignPages(document, pageIds);
  const { componentCatalog, componentsById, instancesById, variantSetsById } =
    createScopedComponentInspection(document, nodeIds, nodesById);
  const { designSystemIds: variableDesignSystemIds, ...variableInspection } =
    createScopedVariableInspection(document, pageIds, nodesById);
  const { designSystemIds: styleDesignSystemIds, ...styleInspection } =
    createScopedStyleInspection(document, nodeIds);

  return {
    idAllocation: createAgentDesignIdAllocation(runId),
    document: {
      documentId: document.documentId,
      revision: document.revision,
      pageOrder: pageIds,
      pagesById,
      nodesById,
      assetsById,
      componentsById,
      componentCatalog,
      variantSetsById,
      instancesById,
      ...variableInspection,
      ...styleInspection,
      fontAvailability,
      fontAvailabilitySummary: {
        requestCount: sortedFontRequests.length,
        returnedRequestCount: fontAvailability.length,
        truncated: sortedFontRequests.length > fontAvailability.length,
      },
      designSystemIds: {
        components: Object.keys(document.componentsById),
        variantSets: Object.keys(document.variantSetsById),
        ...variableDesignSystemIds,
        ...styleDesignSystemIds,
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

function assertComponentInputPage(
  document: DesignDocument,
  input: DesignComponentToolInput,
): void {
  if (!document.pagesById[input.pageId]) {
    throw new Error(`Component operation Page not found: ${input.pageId}`);
  }
  const ids = pageNodeIds(document, input.pageId);
  if (input.action === "create-component") {
    if (!ids.has(input.rootNodeId)) {
      throw new Error(
        `Component source ${input.rootNodeId} is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (input.action === "combine-as-variants") {
    const outsideRoot = input.componentRootNodeIds.find(
      (rootNodeId) => !ids.has(rootNodeId),
    );
    if (outsideRoot) {
      throw new Error(
        `Component source ${outsideRoot} is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (input.action === "add-component-to-variant-set") {
    if (!ids.has(input.rootNodeId) || !ids.has(input.componentRootNodeId))
      throw new Error(
        `Component Set membership target is outside Page ${input.pageId}`,
      );
    return;
  }
  if (input.action === "duplicate-variant") {
    if (!ids.has(input.rootNodeId) || !ids.has(input.sourceRootNodeId))
      throw new Error(
        `Variant duplication source is outside Page ${input.pageId}`,
      );
    return;
  }
  if (input.action === "remove-variant") {
    if (!ids.has(input.rootNodeId) || !ids.has(input.componentRootNodeId))
      throw new Error(`Variant removal target is outside Page ${input.pageId}`);
    return;
  }
  if (input.action === "dissolve-variant-set") {
    if (!ids.has(input.rootNodeId))
      throw new Error(
        `Component Set ${input.variantSetId} is outside Page ${input.pageId}`,
      );
    return;
  }
  if (
    input.action === "add-variant-property" ||
    input.action === "rename-variant-property" ||
    input.action === "reorder-variant-properties" ||
    input.action === "remove-variant-property" ||
    input.action === "rename-variant-value" ||
    input.action === "reorder-variant-values"
  ) {
    if (!ids.has(input.rootNodeId))
      throw new Error(
        `Component Set ${input.variantSetId} is outside Page ${input.pageId}`,
      );
    return;
  }
  if (input.action === "set-variant-properties") {
    if (!ids.has(input.rootNodeId) || !ids.has(input.componentRootNodeId))
      throw new Error(`Variant matrix target is outside Page ${input.pageId}`);
    return;
  }
  if (input.action === "reorder-properties") {
    const mainNodeId = document.componentsById[input.componentId]?.rootNodeId;
    if (
      mainNodeId !== input.componentRootNodeId ||
      !ids.has(input.componentRootNodeId)
    ) {
      throw new Error(
        `Component ${input.componentId} main is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (
    input.action === "remove-component" ||
    input.action === "rename-property" ||
    input.action === "remove-property" ||
    input.action === "set-slot-settings"
  ) {
    const mainNodeId = document.componentsById[input.componentId]?.rootNodeId;
    if (!mainNodeId || !ids.has(mainNodeId)) {
      throw new Error(
        `Component ${input.componentId} main is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (input.action === "add-property") {
    const mainNodeId = document.componentsById[input.componentId]?.rootNodeId;
    if (!mainNodeId || !ids.has(mainNodeId) || !ids.has(input.sourceNodeId)) {
      throw new Error(
        `Component property source ${input.sourceNodeId} is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (input.action === "create-instance") {
    if (input.parentId !== null && !ids.has(input.parentId)) {
      throw new Error(
        `Component instance parent ${input.parentId} is outside Page ${input.pageId}`,
      );
    }
    return;
  }
  if (!ids.has(input.instanceId)) {
    throw new Error(
      `Component instance ${input.instanceId} is outside Page ${input.pageId}`,
    );
  }
}

function assertFontInputPage(
  document: DesignDocument,
  input: DesignFontToolInput,
): void {
  const ids = pageNodeIds(document, input.pageId);
  const outsideNodeId = input.nodeIds.find((nodeId) => !ids.has(nodeId));
  if (outsideNodeId) {
    throw new Error(
      `Font operation target ${outsideNodeId} is outside Page ${input.pageId}`,
    );
  }
}

function assertTextRangeInputPage(
  document: DesignDocument,
  input: DesignTextRangeToolInput,
): void {
  if (!pageNodeIds(document, input.pageId).has(input.nodeId)) {
    throw new Error(
      `Text range operation target ${input.nodeId} is outside Page ${input.pageId}`,
    );
  }
}

function assertCommandsWithinMutationTarget(
  document: DesignDocument,
  commands: readonly DesignOperation[],
  mutationTarget: DesignMutationTarget,
  options: {
    allowedAssetDeletionId?: string;
    allowComponentCommands?: boolean;
  } = {},
): void {
  for (const command of commands) {
    if (
      (command.type === "put_component" ||
        command.type === "delete_component") &&
      !options.allowComponentCommands
    ) {
      throw new Error(
        "Agent component changes require the dedicated component tool",
      );
    }
  }
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
      command.type === "put_component" ||
      command.type === "delete_component" ||
      command.type === "put_variant_set" ||
      command.type === "delete_variant_set"
    ) {
      continue;
    }
    if (
      command.type === "put_library_component_source" ||
      command.type === "delete_library_component_source" ||
      command.type === "put_library_variant_set_source" ||
      command.type === "delete_library_variant_set_source" ||
      command.type === "put_library_style_source" ||
      command.type === "delete_library_style_source" ||
      command.type === "put_library_variable_collection_source" ||
      command.type === "delete_library_variable_collection_source" ||
      command.type === "put_library_variable_source" ||
      command.type === "delete_library_variable_source"
    ) {
      throw new Error(
        "Library source changes require the dedicated Library service",
      );
    }
    if (
      command.type === "put_variable_collection" ||
      command.type === "delete_variable_collection" ||
      command.type === "move_variable_collection" ||
      command.type === "put_variable" ||
      command.type === "delete_variable" ||
      command.type === "set_explicit_variable_modes" ||
      command.type === "set_variable_binding"
    ) {
      throw new Error(
        "Agent Variable changes require the dedicated Variables tool",
      );
    }
    if (
      command.type === "put_style" ||
      command.type === "delete_style" ||
      command.type === "move_style" ||
      command.type === "set_style_reference"
    ) {
      throw new Error(
        "Agent Shared Style changes require the dedicated Styles tool",
      );
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
    if (command.type === "reflow_text") {
      command.nodeIds.forEach((nodeId) =>
        assertNode(nodeId, command.commandId),
      );
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
  if (
    (input.action === "rename" || input.action === "clear") &&
    mutationTarget.kind === "page"
  ) {
    if (input.pageId !== mutationTarget.pageId) {
      throw new Error(
        `Page ${input.action} targets ${input.pageId} outside the registered Page scope`,
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
