import type {
  DesignAsset,
  ImageFilters,
  ImageLightingPreset,
  ImagePaint,
  ImagePlacement,
} from "@opendesign/design-contracts";
import {
  planImageNodeUpdate,
  planImagePaintFilterUpdate,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  ImageAreaSelection,
  ImageExpansionInsets,
} from "@opendesign/image-service";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DesignImageEditAction,
  DesignImageEditRequest,
} from "@/shared/desktop-api";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { ApplyEditorCommands } from "@/renderer/features/editor";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export type ImageEditIntent =
  | { action: "remove-background" }
  | { action: "replace-background"; prompt: string }
  | { action: "relight"; lightingPreset: ImageLightingPreset }
  | {
      action: "prompt-edit";
      prompt: string;
      reference?: DesignAsset;
    }
  | {
      action: "erase-object" | "isolate-object";
      selection: ImageAreaSelection;
    }
  | {
      action: "expand";
      expansion: ImageExpansionInsets;
    }
  | { action: "upscale" };

export type SelectedImageEditIntent = Exclude<
  ImageEditIntent,
  { action: "erase-object" | "isolate-object" } | { action: "expand" }
>;

export type ImageEditActivity = {
  requestId: string;
  nodeId: string;
  action: DesignImageEditAction;
  status: "running" | "cancelling";
};

export function useImageEditWorkflow({
  activePageId,
  applyCommands,
  runtime,
  setEditorError,
  t,
}: {
  activePageId: string;
  applyCommands: ApplyEditorCommands;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
}) {
  const [imageEdit, setImageEdit] = useState<ImageEditActivity | null>(null);
  const activeImageEditRequestId = useRef<string | null>(null);
  const cancelledImageEditRequestIds = useRef(new Set<string>());

  useEffect(
    () => () => {
      const requestId = activeImageEditRequestId.current;
      if (!requestId) return;
      cancelledImageEditRequestIds.current.add(requestId);
      void window.desktop
        ?.cancelDesignImageEdit({ requestId })
        .catch(() => undefined);
    },
    [activePageId, runtime],
  );

  const replaceSelectedImage = useCallback(async () => {
    const beforeSnapshot = runtime.getSnapshot();
    const selected = beforeSnapshot.state.selection.nodeIds;
    const nodeId = selected.length === 1 ? selected[0] : undefined;
    const before = nodeId
      ? beforeSnapshot.document.nodesById[nodeId]
      : undefined;
    if (!nodeId || !before || before.kind !== "image") return;
    try {
      const selection = await window.desktop?.selectDesignImage();
      if (!selection) return;
      const current = runtime.getSnapshot().document;
      const image = current.nodesById[nodeId];
      if (!image || image.kind !== "image") {
        setEditorError(t("error.replaceImage"));
        return;
      }
      const plan = planImageNodeUpdate(
        current,
        {
          action: "replace-source",
          pageId: activePageId,
          nodeId,
          asset: selection.asset,
        },
        `replace_image_${crypto.randomUUID().replaceAll("-", "")}_${nodeId}`,
      );
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(t("error.replaceImage"));
        return;
      }
      applyCommands(t("history.replaceImage"), plan.commands);
    } catch {
      setEditorError(t("error.replaceImage"));
    }
  }, [activePageId, applyCommands, runtime, setEditorError, t]);

  const runImageEdit = useCallback(
    async (nodeId: string, edit: ImageEditIntent) => {
      if (activeImageEditRequestId.current !== null) return;
      const snapshot = runtime.getSnapshot();
      const node = snapshot.document.nodesById[nodeId];
      if (!node || node.kind !== "image") return;
      const source = snapshot.document.assetsById[node.properties.assetId];
      if (
        !source ||
        source.kind !== "image" ||
        source.source.type !== "data" ||
        (source.mimeType !== "image/png" &&
          source.mimeType !== "image/jpeg" &&
          source.mimeType !== "image/webp")
      ) {
        setEditorError(t("error.imageEditUnsupported"));
        return;
      }
      const requestId = `image_edit_${crypto.randomUUID()}`;
      const resultNodeId =
        edit.action === "isolate-object"
          ? `isolated_image_${crypto.randomUUID().replaceAll("-", "")}`
          : undefined;
      const expectedAssetId = node.properties.assetId;
      const expectedPlacement = structuredClone(node.properties.placement);
      const expectedTargetSize = structuredClone(node.size);
      const expectedSourceSize = source.size
        ? structuredClone(source.size)
        : undefined;
      if (edit.action === "upscale" && !expectedSourceSize) {
        setEditorError(t("error.imageEditUnsupported"));
        return;
      }
      activeImageEditRequestId.current = requestId;
      setImageEdit({
        requestId,
        nodeId,
        action: edit.action,
        status: "running",
      });
      setEditorError(null);
      try {
        const requestBase = {
          requestId,
          pageId: activePageId,
          nodeId,
          expectedAssetId,
          source,
        };
        const editRequest: DesignImageEditRequest =
          edit.action === "erase-object" || edit.action === "isolate-object"
            ? {
                ...requestBase,
                action: edit.action,
                selection: {
                  points: edit.selection.points.map((point) => ({ ...point })),
                },
              }
            : edit.action === "prompt-edit" ||
                edit.action === "replace-background" ||
                edit.action === "relight"
              ? { ...requestBase, ...edit }
              : edit.action === "expand"
                ? {
                    ...requestBase,
                    action: edit.action,
                    expansion: { ...edit.expansion },
                    placement: expectedPlacement,
                    targetSize: expectedTargetSize,
                  }
                : { ...requestBase, action: edit.action };
        const edited = await window.desktop?.editDesignImage(editRequest);
        if (!edited) throw new Error("Image editing is unavailable");
        if (cancelledImageEditRequestIds.current.has(requestId)) {
          throw new DOMException("Image editing cancelled", "AbortError");
        }
        const promptMismatch =
          (edit.action === "prompt-edit" ||
            edit.action === "replace-background") &&
          edited.derivation.prompt !== edit.prompt.trim();
        const referenceMismatch =
          edit.action === "prompt-edit" &&
          (edited.derivation.referenceAssetIds[0] !== edit.reference?.id ||
            edited.derivation.referenceAssetIds.length !==
              (edit.reference === undefined ? 0 : 1));
        const backgroundInputsMismatch =
          edit.action === "replace-background" &&
          (edited.derivation.referenceAssetIds.length !== 0 ||
            edited.derivation.maskAssetId !== undefined);
        const lightingMismatch =
          edit.action === "relight" &&
          (edited.derivation.lightingPreset !== edit.lightingPreset ||
            edited.derivation.prompt !== undefined ||
            edited.derivation.referenceAssetIds.length !== 0 ||
            edited.derivation.maskAssetId !== undefined);
        if (
          edited.requestId !== requestId ||
          edited.action !== edit.action ||
          edited.sourceAssetId !== expectedAssetId ||
          promptMismatch ||
          referenceMismatch ||
          backgroundInputsMismatch ||
          lightingMismatch
        ) {
          throw new Error(
            "Image edit response did not match the current request",
          );
        }
        const current = runtime.getSnapshot().document;
        const plan = planImageNodeUpdate(
          current,
          edit.action === "isolate-object" && resultNodeId
            ? {
                action: "derive-layer",
                pageId: activePageId,
                nodeId,
                expectedAssetId,
                resultNodeId,
                resultNodeName: t("canvas.imageAreaIsolatedLayer"),
                asset: edited.asset,
                derivation: edited.derivation,
                ...(edited.supportingAssets === undefined
                  ? {}
                  : { supportingAssets: edited.supportingAssets }),
              }
            : edit.action === "expand"
              ? {
                  action: "expand-source",
                  pageId: activePageId,
                  nodeId,
                  expectedAssetId,
                  expectedPlacement,
                  expectedTargetSize,
                  expansion: edit.expansion,
                  asset: edited.asset,
                  derivation: edited.derivation,
                  supportingAssets: edited.supportingAssets ?? [],
                }
              : edit.action === "upscale" &&
                  expectedSourceSize &&
                  edited.asset.size
                ? {
                    action: "upscale-source",
                    pageId: activePageId,
                    nodeId,
                    expectedAssetId,
                    expectedSourceSize,
                    targetSize: edited.asset.size,
                    asset: edited.asset,
                    derivation: edited.derivation,
                  }
                : {
                    action: "derive-source",
                    pageId: activePageId,
                    nodeId,
                    expectedAssetId,
                    asset: edited.asset,
                    derivation: edited.derivation,
                    ...(edited.supportingAssets === undefined
                      ? {}
                      : { supportingAssets: edited.supportingAssets }),
                  },
          `image_edit_${requestId}`,
        );
        if (!plan.ok) throw new Error(plan.message);
        if (
          !applyCommands(t(historyKeyForImageEdit(edit.action)), plan.commands)
        ) {
          throw new Error("Image edit transaction was rejected");
        }
        const latestSelection = runtime.getSnapshot().state.selection.nodeIds;
        if (
          resultNodeId &&
          latestSelection.length === 1 &&
          latestSelection[0] === nodeId
        ) {
          runtime.setSelection([resultNodeId], resultNodeId);
        }
      } catch (error) {
        if (
          !cancelledImageEditRequestIds.current.has(requestId) &&
          !(error instanceof DOMException && error.name === "AbortError")
        ) {
          setEditorError(
            error instanceof Error ? error.message : t("error.editImage"),
          );
        }
      } finally {
        cancelledImageEditRequestIds.current.delete(requestId);
        if (activeImageEditRequestId.current === requestId) {
          activeImageEditRequestId.current = null;
        }
        setImageEdit((current) =>
          current?.requestId === requestId ? null : current,
        );
      }
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const runSelectedImageEdit = useCallback(
    (edit: SelectedImageEditIntent) => {
      const selected = runtime.getSnapshot().state.selection.nodeIds;
      if (selected.length === 1) void runImageEdit(selected[0], edit);
    },
    [runImageEdit, runtime],
  );

  const selectImageEditReference = useCallback(async () => {
    try {
      const selection = await window.desktop?.selectDesignImage();
      return selection?.asset ?? null;
    } catch {
      setEditorError(t("error.selectImageEditReference"));
      return null;
    }
  }, [setEditorError, t]);

  const cancelSelectedImageEdit = useCallback(() => {
    if (!imageEdit || imageEdit.status === "cancelling") return;
    cancelledImageEditRequestIds.current.add(imageEdit.requestId);
    setImageEdit({ ...imageEdit, status: "cancelling" });
    void window.desktop
      ?.cancelDesignImageEdit({ requestId: imageEdit.requestId })
      .catch(() => undefined);
  }, [imageEdit]);

  const switchSelectedImageSource = useCallback(
    (nodeId: string, assetId: string, expectedAssetId: string) => {
      const current = runtime.getSnapshot();
      const plan = planImageNodeUpdate(current.document, {
        action: "switch-source",
        pageId: activePageId,
        nodeId,
        expectedAssetId,
        assetId,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.switchImageSource"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateSelectedImageFilters = useCallback(
    (filters: ImageFilters) => {
      const current = runtime.getSnapshot();
      const selected = current.state.selection.nodeIds;
      const nodeId = selected.length === 1 ? selected[0] : undefined;
      if (!nodeId) return;
      const plan = planImageNodeUpdate(current.document, {
        action: "set-filters",
        pageId: activePageId,
        nodeId,
        filters,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.adjustImage"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateSelectedImagePlacement = useCallback(
    (placement: ImagePlacement) => {
      const current = runtime.getSnapshot();
      const selected = current.state.selection.nodeIds;
      const nodeId = selected.length === 1 ? selected[0] : undefined;
      if (!nodeId) return;
      const plan = planImageNodeUpdate(current.document, {
        action: "set-placement",
        pageId: activePageId,
        nodeId,
        placement,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.updateImagePlacement"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  const updateImagePaintFilters = useCallback(
    (
      nodeId: string,
      paintField: "fills" | "strokes",
      paintIndex: number,
      expectedPaint: ImagePaint,
      filters: ImageFilters,
    ) => {
      const current = runtime.getSnapshot();
      const plan = planImagePaintFilterUpdate(current.document, {
        pageId: activePageId,
        nodeId,
        paintField,
        paintIndex,
        expectedPaint,
        filters,
      });
      if (!plan.ok) {
        if (plan.code !== "no-op") setEditorError(plan.message);
        return;
      }
      applyCommands(t("history.adjustImage"), plan.commands);
    },
    [activePageId, applyCommands, runtime, setEditorError, t],
  );

  return {
    cancelSelectedImageEdit,
    imageEdit,
    replaceSelectedImage,
    runImageEdit,
    runSelectedImageEdit,
    selectImageEditReference,
    switchSelectedImageSource,
    updateImagePaintFilters,
    updateSelectedImageFilters,
    updateSelectedImagePlacement,
  };
}

function historyKeyForImageEdit(action: DesignImageEditAction): MessageKey {
  switch (action) {
    case "remove-background":
      return "history.removeImageBackground";
    case "replace-background":
      return "history.replaceImageBackground";
    case "relight":
      return "history.relightImage";
    case "prompt-edit":
      return "history.editImageWithPrompt";
    case "erase-object":
      return "history.eraseImageObject";
    case "isolate-object":
      return "history.isolateImageObject";
    case "expand":
      return "history.expandImage";
    case "upscale":
      return "history.boostImageResolution";
  }
}
