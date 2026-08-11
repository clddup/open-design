import type {
  DesignAsset,
  DesignDocument,
  ImageNode,
  PathNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createWelcomeDocument,
  getWorldTransform,
  transformPoint,
} from "./index.js";
import {
  planDeleteImageAsset,
  planImageNodeUpdate,
  planPlaceImageAsset,
  planReplaceImageAsset,
} from "./image-operations.js";

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

describe("file image asset planners", () => {
  it("places an existing asset into the deepest Frame using document-to-local coordinates", () => {
    const document = documentWithImage();
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing Frame");
    const frameTransform = getWorldTransform(document, frame.id);
    if (!frameTransform) throw new Error("Missing Frame transform");
    const documentPoint = transformPoint({ x: 200, y: 140 }, frameTransform);
    const plan = planPlaceImageAsset(document, {
      pageId: "page_welcome",
      assetId: oldAsset.id,
      nodeId: "placed_asset",
      documentPoint,
    });
    expect(plan).toMatchObject({
      ok: true,
      assetId: oldAsset.id,
      nodeId: "placed_asset",
    });
    if (!plan.ok) return;
    expect(plan.commands).toMatchObject([
      {
        type: "insert_element",
        pageId: "page_welcome",
        parentId: frame.id,
        node: {
          id: "placed_asset",
          parentId: frame.id,
          properties: {
            assetId: oldAsset.id,
            placement: { mode: "fit" },
            altText: oldAsset.name,
            cornerRadius: 0,
          },
        },
      },
    ]);
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "place_existing_asset",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(before.revision + 1);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.placed_asset,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.assetsById[oldAsset.id],
    ).toBeDefined();
  });

  it("rejects a drop into a locked Frame rather than scattering it at Page root", () => {
    const document = documentWithImage();
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing Frame");
    frame.locked = true;
    const transform = getWorldTransform(document, frame.id);
    if (!transform) throw new Error("Missing Frame transform");
    expect(
      planPlaceImageAsset(document, {
        pageId: "page_welcome",
        assetId: oldAsset.id,
        nodeId: "locked_drop",
        documentPoint: transformPoint({ x: 100, y: 100 }, transform),
      }),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("relinks every Image and image paint in one transaction while preserving placement", () => {
    const document = documentWithImage();
    const image = document.nodesById.hero;
    if (!image || image.kind !== "image") throw new Error("Missing Image");
    image.properties.placement = {
      mode: "crop",
      focalPoint: { x: 0.25, y: 0.75 },
      zoom: 2,
      rotation: 15,
      flipHorizontal: true,
      flipVertical: false,
    };
    const path: PathNode = {
      id: "paint_reference",
      kind: "path",
      name: "Paint reference",
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
          { type: "image", assetId: oldAsset.id, fit: "cover", opacity: 1 },
        ],
        strokes: [
          { type: "image", assetId: oldAsset.id, fit: "tile", opacity: 0.5 },
        ],
        strokeWidth: 2,
      },
      extensions: {},
    };
    document.nodesById.paint_reference = path;
    document.nodesById.frame_welcome!.childIds.push(path.id);
    const plan = planReplaceImageAsset(document, oldAsset.id, newAsset);
    expect(plan).toMatchObject({ ok: true, assetId: newAsset.id });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "replace_file_asset",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    const nextImage = runtime.getSnapshot().document.nodesById.hero;
    const nextPath = runtime.getSnapshot().document.nodesById.paint_reference;
    expect(nextImage).toMatchObject({
      properties: {
        assetId: newAsset.id,
        placement: image.properties.placement,
      },
    });
    expect(nextPath).toMatchObject({
      properties: {
        fills: [expect.objectContaining({ assetId: newAsset.id })],
        strokes: [expect.objectContaining({ assetId: newAsset.id })],
      },
    });
    expect(
      runtime.getSnapshot().document.assetsById[oldAsset.id],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.assetsById[newAsset.id],
    ).toBeDefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.assetsById[oldAsset.id],
    ).toBeDefined();
  });

  it("deletes only unreferenced image assets and leaves Runtime as final race guard", () => {
    const document = documentWithImage();
    expect(planDeleteImageAsset(document, oldAsset.id)).toMatchObject({
      ok: false,
      code: "out-of-scope",
    });
    document.assetsById.unused = { ...newAsset, id: "unused", name: "Unused" };
    const plan = planDeleteImageAsset(document, "unused");
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "delete_unused_asset",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.assetsById.unused).toBeUndefined();
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.assetsById.unused).toBeDefined();

    const racedDocument = documentWithImage();
    racedDocument.assetsById.unused = {
      ...newAsset,
      id: "unused",
      name: "Unused",
    };
    const racedPlan = planDeleteImageAsset(racedDocument, "unused");
    if (!racedPlan.ok) throw new Error(racedPlan.message);
    const racedRuntime = new EditorRuntime(racedDocument);
    const racedBefore = racedRuntime.getSnapshot().document;
    expect(
      racedRuntime.apply({
        transactionId: "add_racing_reference",
        documentId: racedBefore.documentId,
        baseRevision: racedBefore.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "insert_racing_reference",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: racedBefore.nodesById.frame_welcome?.childIds.length ?? 0,
            node: imageNode("racing_reference", "unused"),
          },
        ],
      }).ok,
    ).toBe(true);
    const racedCurrent = racedRuntime.getSnapshot().document;
    const racedDelete = racedRuntime.apply({
      transactionId: "delete_after_race",
      documentId: racedCurrent.documentId,
      baseRevision: racedCurrent.revision,
      actor: { type: "user", id: "test" },
      commands: racedPlan.commands,
    });
    expect(racedDelete).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(racedRuntime.getSnapshot().document.assetsById.unused).toBeDefined();
  });
});
