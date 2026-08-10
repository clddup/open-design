import type {
  DesignAsset,
  DesignDocument,
  ImageNode,
  PathNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { EditorRuntime, createWelcomeDocument } from "./index.js";
import { planImageNodeUpdate } from "./image-operations.js";

const oldAsset: DesignAsset = {
  id: "asset_old",
  kind: "image",
  name: "Old",
  mimeType: "image/png",
  source: { type: "data", value: "b2xk" },
  size: { width: 800, height: 600 },
  extensions: {},
};

const newAsset: DesignAsset = {
  id: "asset_new",
  kind: "image",
  name: "New",
  mimeType: "image/webp",
  source: { type: "data", value: "bmV3" },
  size: { width: 1600, height: 900 },
  extensions: {},
};

function imageNode(id: string, assetId = oldAsset.id): ImageNode {
  return {
    id,
    kind: "image",
    name: id,
    parentId: "frame_welcome",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 32, 32],
    size: { width: 320, height: 240 },
    opacity: 1,
    properties: {
      assetId,
      placement: { mode: "fit" },
      altText: "",
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function documentWithImage(): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  document.assetsById[oldAsset.id] = structuredClone(oldAsset);
  document.nodesById.hero = imageNode("hero");
  document.nodesById.frame_welcome!.childIds.push("hero");
  return document;
}

describe("image update planner", () => {
  it("replaces a source and removes the detached asset in one undoable transaction", () => {
    const runtime = new EditorRuntime(documentWithImage());
    const plan = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "replace-source",
      pageId: "page_welcome",
      nodeId: "hero",
      asset: newAsset,
    });
    expect(plan).toMatchObject({
      ok: true,
      previousAssetId: "asset_old",
      nextAssetId: "asset_new",
      deletedAssetId: "asset_old",
    });
    if (!plan.ok) return;
    const before = runtime.getSnapshot().document;
    const result = runtime.apply({
      transactionId: "replace_image",
      documentId: before.documentId,
      baseRevision: before.revision,
      actor: { type: "user", id: "test" },
      commands: plan.commands,
    });
    expect(result.ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: "asset_new", placement: { mode: "fit" } },
    });
    expect(runtime.getSnapshot().document.assetsById.asset_old).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: "asset_old" },
    });
    expect(runtime.getSnapshot().document.assetsById.asset_new).toBeUndefined();
  });

  it("preserves an old asset referenced by another Image or Path paint", () => {
    const document = documentWithImage();
    document.nodesById.secondary = imageNode("secondary");
    document.nodesById.frame_welcome!.childIds.push("secondary");
    const path: PathNode = {
      id: "image_fill_path",
      kind: "path",
      name: "Image fill path",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 1,
      properties: {
        path: "M0 0 H100 V100 H0 Z",
        fills: [
          {
            type: "image",
            assetId: oldAsset.id,
            fit: "cover",
            opacity: 1,
          },
        ],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById.image_fill_path = path;
    document.nodesById.frame_welcome!.childIds.push(path.id);

    const plan = planImageNodeUpdate(document, {
      action: "replace-source",
      pageId: "page_welcome",
      nodeId: "hero",
      asset: newAsset,
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.deletedAssetId).toBeUndefined();
    expect(plan.commands).not.toContainEqual(
      expect.objectContaining({ type: "delete_asset" }),
    );
  });

  it("rejects selection-independent out-of-page, wrong-kind, and no-op requests", () => {
    const document = documentWithImage();
    expect(
      planImageNodeUpdate(document, {
        action: "set-placement",
        pageId: "page_welcome",
        nodeId: "title_welcome",
        placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
      }),
    ).toMatchObject({ ok: false, code: "invalid-kind" });
    expect(
      planImageNodeUpdate(document, {
        action: "set-placement",
        pageId: "missing_page",
        nodeId: "hero",
        placement: { mode: "fit" },
      }),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planImageNodeUpdate(document, {
        action: "set-placement",
        pageId: "page_welcome",
        nodeId: "hero",
        placement: { mode: "fit" },
      }),
    ).toMatchObject({ ok: false, code: "no-op" });
  });
});
