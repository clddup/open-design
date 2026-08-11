import type { DesignOperation, Point } from "@opendesign/design-contracts";
import {
  getNodeBounds,
  planDeleteImageAsset,
  planPlaceImageAsset,
  planReplaceImageAsset,
  screenToDocument,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { AssetActionResult, DesignAssetReference } from "./design-assets";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useDesignAssetActions({
  activePageId,
  activatePage,
  applyCommands,
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  activePageId: string;
  activatePage: (pageId: string) => void;
  applyCommands: (label: string, commands: DesignOperation[]) => boolean;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const importImageAsset = useCallback(async (): Promise<AssetActionResult> => {
    try {
      const selection = await window.desktop?.selectDesignImage();
      if (!selection) return { ok: true };
      const current = runtime.getSnapshot().document;
      if (current.assetsById[selection.asset.id]) {
        return {
          ok: true,
          message: t("sidebar.assetAlreadyAvailable", {
            name: selection.asset.name,
          }),
        };
      }
      if (
        !applyCommands(t("history.importImageAsset"), [
          {
            commandId: `import_asset_${selection.asset.id}`,
            type: "put_asset",
            asset: selection.asset,
          },
        ])
      ) {
        return { ok: false, error: t("sidebar.assetActionFailed") };
      }
      return {
        ok: true,
        message: t("sidebar.assetImported", { name: selection.asset.name }),
      };
    } catch {
      setEditorError(t("sidebar.assetActionFailed"));
      return { ok: false, error: t("sidebar.assetActionFailed") };
    }
  }, [applyCommands, runtime, setEditorError, t]);

  const placeImageAssetAtPoint = useCallback(
    (assetId: string, documentPoint: Point): AssetActionResult => {
      const current = runtime.getSnapshot().document;
      const asset = current.assetsById[assetId];
      const operationId = `place_asset_${Date.now()}_${++transactionCounter.current}`;
      const plan = planPlaceImageAsset(
        current,
        {
          pageId: activePageId,
          assetId,
          nodeId: `${operationId}_image`,
          documentPoint,
        },
        operationId,
      );
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.placeImageAsset"), plan.commands)) {
        return { ok: false, error: t("sidebar.assetActionFailed") };
      }
      if (plan.nodeId) runtime.setSelection([plan.nodeId], plan.nodeId);
      return {
        ok: true,
        message: t("sidebar.assetPlaced", {
          name: asset?.name ?? assetId,
        }),
      };
    },
    [
      activePageId,
      applyCommands,
      runtime,
      setEditorError,
      t,
      transactionCounter,
    ],
  );

  const placeImageAsset = useCallback(
    (assetId: string): AssetActionResult => {
      const viewport = runtime.getSnapshot().state.viewport;
      return placeImageAssetAtPoint(
        assetId,
        screenToDocument(
          { x: viewport.width / 2, y: viewport.height / 2 },
          viewport,
        ),
      );
    },
    [placeImageAssetAtPoint, runtime],
  );

  const locateImageAsset = useCallback(
    (reference: DesignAssetReference) => {
      if (!reference.pageId) return;
      const current = runtime.getSnapshot();
      const bounds = getNodeBounds(current.document, reference.nodeId);
      if (!bounds) {
        setEditorError(t("sidebar.assetActionFailed"));
        return;
      }
      activatePage(reference.pageId);
      runtime.setSelection([reference.nodeId], reference.nodeId);
      setEditorError(null);
      const { width, height } = current.state.viewport;
      if (width <= 0 || height <= 0) return;
      const padding = 64;
      const zoom = Math.min(
        2,
        Math.max(
          0.1,
          Math.min(
            (width - padding * 2) / Math.max(bounds.width, 1),
            (height - padding * 2) / Math.max(bounds.height, 1),
          ),
        ),
      );
      runtime.setViewport({
        zoom,
        panX: width / 2 - (bounds.x + bounds.width / 2) * zoom,
        panY: height / 2 - (bounds.y + bounds.height / 2) * zoom,
      });
    },
    [activatePage, runtime, setEditorError, t],
  );

  const replaceImageAsset = useCallback(
    async (assetId: string): Promise<AssetActionResult> => {
      try {
        const selection = await window.desktop?.selectDesignImage();
        if (!selection) return { ok: true };
        const current = runtime.getSnapshot().document;
        const previousName = current.assetsById[assetId]?.name ?? assetId;
        const operationId = `replace_asset_${Date.now()}_${++transactionCounter.current}`;
        const plan = planReplaceImageAsset(
          current,
          assetId,
          selection.asset,
          operationId,
        );
        if (!plan.ok) {
          if (plan.code === "no-op") {
            return {
              ok: true,
              message: t("sidebar.assetAlreadyAvailable", {
                name: selection.asset.name,
              }),
            };
          }
          setEditorError(plan.message);
          return { ok: false, error: plan.message };
        }
        if (!applyCommands(t("history.replaceImageAsset"), plan.commands)) {
          return { ok: false, error: t("sidebar.assetActionFailed") };
        }
        return {
          ok: true,
          message: t("sidebar.assetReplaced", { name: previousName }),
        };
      } catch {
        setEditorError(t("sidebar.assetActionFailed"));
        return { ok: false, error: t("sidebar.assetActionFailed") };
      }
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const deleteImageAsset = useCallback(
    (assetId: string): AssetActionResult => {
      const current = runtime.getSnapshot().document;
      const name = current.assetsById[assetId]?.name ?? assetId;
      const operationId = `delete_asset_${Date.now()}_${++transactionCounter.current}`;
      const plan = planDeleteImageAsset(current, assetId, operationId);
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.deleteImageAsset"), plan.commands)) {
        return { ok: false, error: t("sidebar.assetActionFailed") };
      }
      return {
        ok: true,
        message: t("sidebar.assetDeleted", { name }),
      };
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  return {
    deleteImageAsset,
    importImageAsset,
    locateImageAsset,
    placeImageAsset,
    placeImageAssetAtPoint,
    replaceImageAsset,
  };
}
