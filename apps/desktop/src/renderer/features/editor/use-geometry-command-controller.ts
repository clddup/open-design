import type {
  DesignDocument,
  VectorVertexStrokeCap,
  VectorVertexStrokeJoin,
} from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type { LeaferTextRunStyle } from "@opendesign/leafer-engine";
import type { TextRunLayoutProvider } from "@opendesign/text-service";
import {
  canFlattenNodes,
  isEffectivelyLocked,
  planVectorOutlineStroke,
  planVectorSemanticEdit,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback, useMemo } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import {
  planFlattenWithRasterFallback,
  type FlattenRasterizer,
} from "@/renderer/services/flatten-rasterization";
import type { ApplyEditorCommands } from "./use-editor-command-controller";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useGeometryCommandController({
  activePageId,
  applyCommands,
  componentTargetActive,
  document,
  runtime,
  selectedNodeIds,
  setEditorError,
  t,
  transactionCounter,
  textRunLayoutProvider,
  vectorGeometryProvider = loadVectorGeometryProvider,
  flattenRasterizer,
}: {
  activePageId: string;
  applyCommands: ApplyEditorCommands;
  componentTargetActive: boolean;
  document: DesignDocument;
  runtime: EditorRuntime;
  selectedNodeIds: readonly string[];
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
  textRunLayoutProvider?: TextRunLayoutProvider<LeaferTextRunStyle>;
  vectorGeometryProvider?: () => Promise<VectorGeometryProvider>;
  flattenRasterizer?: FlattenRasterizer;
}) {
  const selectedNodeId =
    !componentTargetActive && selectedNodeIds.length === 1
      ? (selectedNodeIds[0] ?? null)
      : null;
  const canOutlineStroke = useMemo(() => {
    if (!selectedNodeId) return false;
    const node = document.nodesById[selectedNodeId];
    const parent = node?.parentId
      ? document.nodesById[node.parentId]
      : undefined;
    return Boolean(
      node &&
      (node.kind === "path" || node.kind === "vector") &&
      parent?.kind !== "boolean" &&
      !isEffectivelyLocked(document, node.id) &&
      node.properties.strokeWidth > 0 &&
      node.properties.strokes.some((paint) => paint.visible !== false),
    );
  }, [document, selectedNodeId]);
  const canFlattenSelection = useMemo(() => {
    return (
      !componentTargetActive &&
      canFlattenNodes(document, activePageId, selectedNodeIds)
    );
  }, [activePageId, componentTargetActive, document, selectedNodeIds]);

  const outlineSelectedStroke = useCallback(async () => {
    if (!selectedNodeId) return false;
    try {
      const provider = await vectorGeometryProvider();
      const current = runtime.getSnapshot();
      const operationId = `outline_stroke_${Date.now()}_${++transactionCounter.current}`;
      const plan = planVectorOutlineStroke(
        current.document,
        activePageId,
        selectedNodeId,
        `${operationId}_result`,
        `${operationId}_geometry`,
        provider,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      const applied = applyCommands(t("history.outlineStroke"), [
        ...plan.operations,
      ]);
      if (applied && plan.outlineResult) {
        runtime.setSelection(
          [plan.outlineResult.resultNodeId],
          plan.outlineResult.resultNodeId,
        );
      }
      return applied;
    } catch (error) {
      setEditorError(
        error instanceof Error
          ? error.message
          : t("editor.vectorGeometryUnavailable"),
      );
      return false;
    }
  }, [
    activePageId,
    applyCommands,
    runtime,
    selectedNodeId,
    setEditorError,
    t,
    transactionCounter,
    vectorGeometryProvider,
  ]);

  const flattenSelection = useCallback(async () => {
    if (!canFlattenSelection) return false;
    try {
      const provider = await vectorGeometryProvider();
      const current = runtime.getSnapshot();
      const operationId = `flatten_${Date.now()}_${++transactionCounter.current}`;
      const plan = await planFlattenWithRasterFallback({
        document: current.document,
        pageId: activePageId,
        nodeIds: current.state.selection.nodeIds,
        resultNodeId: `${operationId}_result`,
        geometryIdPrefix: `${operationId}_geometry`,
        provider,
        ...(flattenRasterizer ? { rasterize: flattenRasterizer } : {}),
        ...(textRunLayoutProvider ? { textRunLayoutProvider } : {}),
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      const result = runtime.apply({
        transactionId: `transaction_renderer_${operationId}`,
        documentId: current.document.documentId,
        baseRevision: current.document.revision,
        actor: { type: "user", id: "local-user" },
        label: t("history.flattenSelection"),
        commands: [...plan.operations],
      });
      setEditorError(result.ok ? null : result.error.message);
      const applied = result.ok;
      if (applied && plan.flattenResult) {
        runtime.setSelection(
          [plan.flattenResult.resultNodeId],
          plan.flattenResult.resultNodeId,
        );
      }
      return applied;
    } catch (error) {
      setEditorError(
        error instanceof Error
          ? error.message
          : t("editor.vectorGeometryUnavailable"),
      );
      return false;
    }
  }, [
    activePageId,
    canFlattenSelection,
    flattenRasterizer,
    runtime,
    setEditorError,
    t,
    textRunLayoutProvider,
    transactionCounter,
    vectorGeometryProvider,
  ]);

  const setVectorVertexAppearance = useCallback(
    (
      nodeId: string,
      vertexIds: readonly string[],
      patch: {
        cornerRadius?: number | null;
        strokeCap?: VectorVertexStrokeCap | null;
        strokeJoin?: VectorVertexStrokeJoin | null;
      },
    ) => {
      const current = runtime.getSnapshot();
      const cornerRadiusPatch = Object.hasOwn(patch, "cornerRadius");
      const plan = planVectorSemanticEdit(
        current.document,
        activePageId,
        nodeId,
        cornerRadiusPatch
          ? {
              action: "set-vertex-corner-radius",
              cornerRadius: patch.cornerRadius ?? null,
              vertexIds,
            }
          : {
              action: "set-vertex-stroke-appearance",
              vertexIds,
              ...(patch.strokeCap === undefined
                ? {}
                : { strokeCap: patch.strokeCap }),
              ...(patch.strokeJoin === undefined
                ? {}
                : { strokeJoin: patch.strokeJoin }),
            },
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return false;
      }
      return applyCommands(
        t(
          cornerRadiusPatch
            ? "history.updateVectorVertexCornerRadius"
            : "history.updateVectorVertexStrokeAppearance",
        ),
        [...plan.operations],
      );
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  return {
    canFlattenSelection,
    canOutlineStroke,
    flattenSelection,
    outlineSelectedStroke,
    setVectorVertexAppearance,
  };
}

async function loadVectorGeometryProvider(): Promise<VectorGeometryProvider> {
  const { loadBrowserVectorGeometryProvider } =
    await import("@opendesign/geometry-service/browser-vector-path");
  return loadBrowserVectorGeometryProvider();
}
