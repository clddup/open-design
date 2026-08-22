import type {
  DesignAsset,
  DesignDocument,
  ImageNode,
  PathNode,
} from "@opendesign/design-contracts";
import { migrateDesignDocument } from "@opendesign/design-contracts";
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
  planImagePaintFilterUpdate,
  planPlaceImageAsset,
  planReplaceImageAsset,
  getImageAssetFamily,
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
    exportSettings: [],
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
  it("updates one exact image paint and fails closed after paint identity changes", () => {
    const document = documentWithImage();
    const path: PathNode = {
      id: "paint_target",
      kind: "path",
      name: "Paint target",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {
        path: "M0 0 H100 V100 H0 Z",
        fills: [
          { type: "solid", color: "#ffffff", opacity: 1 },
          { type: "image", assetId: oldAsset.id, fit: "cover", opacity: 1 },
        ],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById[path.id] = path;
    document.nodesById.frame_welcome!.childIds.push(path.id);
    const runtime = new EditorRuntime(document);
    const plan = planImagePaintFilterUpdate(runtime.getSnapshot().document, {
      pageId: "page_welcome",
      nodeId: path.id,
      paintField: "fills",
      paintIndex: 1,
      expectedPaint: {
        type: "image",
        assetId: oldAsset.id,
        fit: "cover",
        opacity: 1,
      },
      filters: { contrast: 0.25, highlights: -0.4 },
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "adjust_image_paint",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    const applied = runtime.getSnapshot().document.nodesById[path.id];
    expect(
      applied?.kind === "path" && applied.properties.fills[1],
    ).toMatchObject({
      type: "image",
      assetId: oldAsset.id,
      filters: { contrast: 0.25, highlights: -0.4 },
    });
    expect(runtime.undo().ok).toBe(true);
    const staleDocument = structuredClone(document);
    const staleNode = staleDocument.nodesById[path.id];
    if (!staleNode || staleNode.kind !== "path") {
      throw new Error("Missing stale paint target");
    }
    staleNode.properties.fills[1] = {
      type: "image",
      assetId: oldAsset.id,
      fit: "contain",
      opacity: 1,
    };
    expect(
      planImagePaintFilterUpdate(staleDocument, {
        pageId: "page_welcome",
        nodeId: path.id,
        paintField: "fills",
        paintIndex: 1,
        expectedPaint: {
          type: "image",
          assetId: oldAsset.id,
          fit: "cover",
          opacity: 1,
        },
        filters: { contrast: 0.25 },
      }),
    ).toMatchObject({ ok: false, code: "paint-stale" });
  });

  it("applies sparse non-destructive filters as one undoable image update", () => {
    const runtime = new EditorRuntime(documentWithImage());
    const plan = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "set-filters",
      pageId: "page_welcome",
      nodeId: "hero",
      filters: { exposure: 0.25, contrast: 0, shadows: -0.4 },
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "adjust_image",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { filters: { exposure: 0.25, shadows: -0.4 } },
    });
    const reopened = migrateDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened?.nodesById.hero).toMatchObject({
      properties: { filters: { exposure: 0.25, shadows: -0.4 } },
    });
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).not.toHaveProperty(
      "properties.filters",
    );
  });

  it("treats omitted, empty, and explicit neutral filters as the same state", () => {
    const document = documentWithImage();
    expect(
      planImageNodeUpdate(document, {
        action: "set-filters",
        pageId: "page_welcome",
        nodeId: "hero",
        filters: { exposure: 0, contrast: 0 },
      }),
    ).toMatchObject({ ok: false, code: "no-op" });
  });

  it("replaces a source while preserving recoverable image history in one transaction", () => {
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
      derivationId: "update_image_derivation",
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
    if (result.ok) {
      expect(result.changes.addedAssetIds).toEqual(["asset_new"]);
      expect(result.changes.addedImageAssetDerivationIds).toEqual([
        "update_image_derivation",
      ]);
    }
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: "asset_new", placement: { mode: "fit" } },
    });
    expect(runtime.getSnapshot().document.assetsById.asset_old).toBeDefined();
    expect(
      runtime.getSnapshot().document.imageAssetDerivationsById
        .update_image_derivation,
    ).toMatchObject({
      sourceAssetId: "asset_old",
      resultAssetId: "asset_new",
      operation: "replacement",
    });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(
      reopened.getSnapshot().document.imageAssetDerivationsById
        .update_image_derivation,
    ).toMatchObject({
      sourceAssetId: oldAsset.id,
      resultAssetId: newAsset.id,
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: "asset_old" },
    });
    expect(runtime.getSnapshot().document.assetsById.asset_new).toBeUndefined();
    expect(
      runtime.getSnapshot().document.imageAssetDerivationsById
        .update_image_derivation,
    ).toBeUndefined();
  });

  it("commits a trusted AI-derived source and lineage atomically and fails closed when stale", () => {
    const derivedAsset: DesignAsset = {
      ...newAsset,
      id: "asset_without_background",
      mimeType: "image/png",
      name: "Old — Background removed",
    };
    const runtime = new EditorRuntime(documentWithImage());
    const plan = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "derive-source",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: oldAsset.id,
      asset: derivedAsset,
      derivation: {
        id: "remove_background_derivation",
        sourceAssetId: oldAsset.id,
        resultAssetId: derivedAsset.id,
        operation: "remove-background",
        referenceAssetIds: [],
        extensions: {
          provider: "openai-images",
          modelId: "gpt-image-2",
        },
      },
    });
    expect(plan).toMatchObject({
      ok: true,
      previousAssetId: oldAsset.id,
      nextAssetId: derivedAsset.id,
      derivationId: "remove_background_derivation",
    });
    if (!plan.ok) return;
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "remove_background",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: derivedAsset.id, placement: { mode: "fit" } },
    });
    expect(
      runtime.getSnapshot().document.imageAssetDerivationsById
        .remove_background_derivation,
    ).toMatchObject({ operation: "remove-background" });
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.assetsById[derivedAsset.id],
    ).toBeUndefined();

    expect(
      planImageNodeUpdate(documentWithImage(), {
        action: "derive-source",
        pageId: "page_welcome",
        nodeId: "hero",
        expectedAssetId: "asset_stale",
        asset: derivedAsset,
        derivation: {
          id: "stale_derivation",
          sourceAssetId: "asset_stale",
          resultAssetId: derivedAsset.id,
          operation: "remove-background",
          referenceAssetIds: [],
          extensions: {},
        },
      }),
    ).toMatchObject({ ok: false, code: "asset-stale" });
  });

  it("commits a prompt edit and its reference asset atomically across undo and reopen", () => {
    const referenceAsset: DesignAsset = {
      ...newAsset,
      id: "asset_reference",
      name: "Reference",
    };
    const editedAsset: DesignAsset = {
      ...newAsset,
      id: "asset_prompt_edit",
      mimeType: "image/png",
      name: "Old — Edited",
    };
    const runtime = new EditorRuntime(documentWithImage());
    const plan = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "derive-source",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: oldAsset.id,
      asset: editedAsset,
      supportingAssets: [referenceAsset],
      derivation: {
        id: "prompt_edit_derivation",
        sourceAssetId: oldAsset.id,
        resultAssetId: editedAsset.id,
        operation: "prompt-edit",
        prompt: "Use the reference image's lighting and preserve the subject",
        referenceAssetIds: [referenceAsset.id],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    });
    expect(plan).toMatchObject({ ok: true });
    if (!plan.ok) return;
    expect(plan.commands.map((command) => command.type)).toEqual([
      "put_asset",
      "put_asset",
      "put_image_asset_derivation",
      "update_properties",
    ]);
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "prompt_edit",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: plan.commands,
      }).ok,
    ).toBe(true);
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.getSnapshot().document.assetsById).toMatchObject({
      [referenceAsset.id]: { name: "Reference" },
      [editedAsset.id]: { name: "Old — Edited" },
    });
    expect(
      reopened.getSnapshot().document.imageAssetDerivationsById
        .prompt_edit_derivation,
    ).toMatchObject({
      operation: "prompt-edit",
      referenceAssetIds: [referenceAsset.id],
    });
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.assetsById[referenceAsset.id],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.assetsById[editedAsset.id],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.imageAssetDerivationsById
        .prompt_edit_derivation,
    ).toBeUndefined();
  });

  it("rejects missing, unrelated, duplicate, and conflicting prompt-edit references", () => {
    const referenceAsset: DesignAsset = {
      ...newAsset,
      id: "asset_reference",
      name: "Reference",
    };
    const editedAsset: DesignAsset = {
      ...newAsset,
      id: "asset_prompt_edit",
    };
    const derivation = {
      id: "prompt_edit_derivation",
      sourceAssetId: oldAsset.id,
      resultAssetId: editedAsset.id,
      operation: "prompt-edit" as const,
      prompt: "Apply the reference style",
      referenceAssetIds: [referenceAsset.id],
      extensions: {},
    };
    const input = {
      action: "derive-source" as const,
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: oldAsset.id,
      asset: editedAsset,
      derivation,
    };
    expect(planImageNodeUpdate(documentWithImage(), input)).toMatchObject({
      ok: false,
      code: "invalid-asset",
    });
    expect(
      planImageNodeUpdate(documentWithImage(), {
        ...input,
        supportingAssets: [{ ...referenceAsset, id: "asset_unrelated" }],
      }),
    ).toMatchObject({ ok: false, code: "invalid-asset" });
    expect(
      planImageNodeUpdate(documentWithImage(), {
        ...input,
        supportingAssets: [referenceAsset, referenceAsset],
      }),
    ).toMatchObject({ ok: false, code: "invalid-asset" });
    const conflicting = documentWithImage();
    conflicting.assetsById[referenceAsset.id] = {
      ...referenceAsset,
      name: "Different reference",
    };
    expect(
      planImageNodeUpdate(conflicting, {
        ...input,
        supportingAssets: [referenceAsset],
      }),
    ).toMatchObject({ ok: false, code: "invalid-asset" });
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
      exportSettings: [],
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
    expect(plan.commands).not.toContainEqual(
      expect.objectContaining({ type: "delete_asset" }),
    );
  });

  it("rejects missing, self-referential, and cyclic image derivation graphs", () => {
    const danglingOrder = documentWithImage();
    danglingOrder.imageAssetDerivationOrder = ["dangling"];
    expect(() => new EditorRuntime(danglingOrder)).toThrow(/does not exist/);

    const unlisted = documentWithImage();
    unlisted.imageAssetDerivationsById.unlisted = {
      id: "unlisted",
      sourceAssetId: oldAsset.id,
      resultAssetId: "asset_result",
      operation: "replacement",
      referenceAssetIds: [],
      extensions: {},
    };
    unlisted.assetsById.asset_result = {
      ...newAsset,
      id: "asset_result",
    };
    expect(() => new EditorRuntime(unlisted)).toThrow(/present in/);

    const missing = documentWithImage();
    missing.imageAssetDerivationOrder = ["missing_edge"];
    missing.imageAssetDerivationsById.missing_edge = {
      id: "missing_edge",
      sourceAssetId: oldAsset.id,
      resultAssetId: "asset_missing",
      operation: "replacement",
      referenceAssetIds: [],
      extensions: {},
    };
    expect(() => new EditorRuntime(missing)).toThrow(/asset_missing/);

    const self = documentWithImage();
    self.imageAssetDerivationOrder = ["self"];
    self.imageAssetDerivationsById.self = {
      id: "self",
      sourceAssetId: oldAsset.id,
      resultAssetId: oldAsset.id,
      operation: "replacement",
      referenceAssetIds: [],
      extensions: {},
    };
    expect(() => new EditorRuntime(self)).toThrow(/itself/);

    const cyclic = documentWithImage();
    cyclic.assetsById[newAsset.id] = structuredClone(newAsset);
    cyclic.imageAssetDerivationOrder = ["forward", "back"];
    cyclic.imageAssetDerivationsById = {
      forward: {
        id: "forward",
        sourceAssetId: oldAsset.id,
        resultAssetId: newAsset.id,
        operation: "replacement",
        referenceAssetIds: [],
        extensions: {},
      },
      back: {
        id: "back",
        sourceAssetId: newAsset.id,
        resultAssetId: oldAsset.id,
        operation: "prompt-edit",
        referenceAssetIds: [],
        extensions: {},
      },
    };
    expect(() => new EditorRuntime(cyclic)).toThrow(/acyclic/);
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
      exportSettings: [],
      opacity: 1,
      properties: {
        path: "M0 0 H100 V100 H0 Z",
        fills: [
          {
            type: "image",
            assetId: oldAsset.id,
            fit: "cover",
            opacity: 1,
            filters: { exposure: 0.2, shadows: -0.3 },
          },
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
        fills: [
          expect.objectContaining({
            assetId: newAsset.id,
            filters: { exposure: 0.2, shadows: -0.3 },
          }),
        ],
        strokes: [expect.objectContaining({ assetId: newAsset.id })],
      },
    });
    expect(
      runtime.getSnapshot().document.assetsById[oldAsset.id],
    ).toBeDefined();
    expect(
      runtime.getSnapshot().document.assetsById[newAsset.id],
    ).toBeDefined();
    expect(
      getImageAssetFamily(runtime.getSnapshot().document, newAsset.id),
    ).toMatchObject({
      assetIds: [oldAsset.id, newAsset.id],
      rootAssetIds: [oldAsset.id],
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.assetsById[oldAsset.id],
    ).toBeDefined();
  });

  it("switches an Image node between existing family sources and rejects stale identity", () => {
    const runtime = new EditorRuntime(documentWithImage());
    const replacement = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "replace-source",
      pageId: "page_welcome",
      nodeId: "hero",
      asset: newAsset,
    });
    if (!replacement.ok) throw new Error(replacement.message);
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "replace_for_switch",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        commands: replacement.commands,
      }).ok,
    ).toBe(true);
    expect(
      planImageNodeUpdate(runtime.getSnapshot().document, {
        action: "switch-source",
        pageId: "page_welcome",
        nodeId: "hero",
        expectedAssetId: oldAsset.id,
        assetId: newAsset.id,
      }),
    ).toMatchObject({ ok: false, code: "asset-stale" });
    const restore = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "switch-source",
      pageId: "page_welcome",
      nodeId: "hero",
      expectedAssetId: newAsset.id,
      assetId: oldAsset.id,
    });
    expect(restore).toMatchObject({ ok: true });
    if (!restore.ok) return;
    const current = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "restore_source",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: restore.commands,
      }).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.hero).toMatchObject({
      properties: { assetId: oldAsset.id },
    });
  });

  it("deletes an unused image source family as one undoable transaction", () => {
    const runtime = new EditorRuntime(documentWithImage());
    const replacement = planImageNodeUpdate(runtime.getSnapshot().document, {
      action: "replace-source",
      pageId: "page_welcome",
      nodeId: "hero",
      asset: newAsset,
    });
    if (!replacement.ok) throw new Error(replacement.message);
    let current = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "replace_before_family_delete",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: replacement.commands,
      }).ok,
    ).toBe(true);
    current = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "remove_family_use",
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "test" },
        commands: [
          {
            commandId: "delete_hero",
            type: "delete_element",
            nodeId: "hero",
          },
        ],
      }).ok,
    ).toBe(true);
    const deletion = planDeleteImageAsset(
      runtime.getSnapshot().document,
      newAsset.id,
      "delete_family",
    );
    expect(deletion).toMatchObject({ ok: true });
    if (!deletion.ok) return;
    current = runtime.getSnapshot().document;
    const deleted = runtime.apply({
      transactionId: "delete_source_family",
      documentId: current.documentId,
      baseRevision: current.revision,
      actor: { type: "user", id: "test" },
      commands: deletion.commands,
    });
    expect(deleted.ok).toBe(true);
    if (deleted.ok) {
      expect(deleted.changes.removedImageAssetDerivationIds).toEqual([
        "update_image_derivation",
      ]);
      expect(deleted.changes.removedAssetIds).toEqual([
        oldAsset.id,
        newAsset.id,
      ]);
    }
    expect(runtime.getSnapshot().document.assetsById).not.toHaveProperty(
      oldAsset.id,
    );
    expect(runtime.getSnapshot().document.assetsById).not.toHaveProperty(
      newAsset.id,
    );
    expect(runtime.getSnapshot().document.imageAssetDerivationOrder).toEqual(
      [],
    );
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.assetsById).toHaveProperty(
      oldAsset.id,
    );
    expect(runtime.getSnapshot().document.assetsById).toHaveProperty(
      newAsset.id,
    );
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

  it("keeps assets referenced by local Image Paint Styles", () => {
    const document = documentWithImage();
    delete document.nodesById.hero;
    document.nodesById.frame_welcome!.childIds =
      document.nodesById.frame_welcome!.childIds.filter(
        (nodeId) => nodeId !== "hero",
      );
    document.stylesById.photo = {
      id: "photo",
      key: "photo-key",
      name: "Media/Photo",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [
        {
          type: "image",
          assetId: oldAsset.id,
          fit: "cover",
          opacity: 1,
          filters: { contrast: 0.2 },
        },
      ],
      extensions: {},
    };
    document.styleOrderByType.PAINT.push("photo");

    const deletion = planDeleteImageAsset(document, oldAsset.id);
    expect(deletion).toMatchObject({ ok: false, code: "out-of-scope" });
    if (deletion.ok) throw new Error("Expected Style reference guard");
    expect(deletion.message).toContain("Style photo");
    const replace = planReplaceImageAsset(document, oldAsset.id, newAsset);
    expect(replace).toMatchObject({ ok: false, code: "out-of-scope" });
    if (replace.ok) throw new Error("Expected Style replacement guard");
    expect(replace.message).toContain("Style workflow");
  });
});
