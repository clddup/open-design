import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import {
  booleanResultElementId,
  projectDesignPage,
  projectDesignPageIncrementally,
  projectResolvedBooleanGeometry,
} from "./mapping.js";

describe("Leafer scene projection", () => {
  it("projects the authoritative page tree with stable ids and local transforms", () => {
    const document = createWelcomeDocument();
    const projection = projectDesignPage(document, "page_welcome");

    expect(projection.rootIds).toEqual(["frame_welcome"]);
    expect(projection.elementsById.get("frame_welcome")).toMatchObject({
      id: "frame_welcome",
      tag: "Frame",
      parentId: null,
      transform: [1, 0, 0, 1, 80, 64],
      data: {
        editable: true,
        overflow: "hide",
        width: 1120,
        height: 720,
      },
    });
    expect(projection.elementsById.get("title_welcome")).toMatchObject({
      tag: "Text",
      parentId: "frame_welcome",
      data: {
        text: "Design without losing the thread.",
        verticalAlign: "top",
      },
    });
  });

  it("keeps Boolean operands hidden and projects a stable synthetic result", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    document.nodesById.boolean_mark = {
      id: "boolean_mark",
      kind: "boolean",
      name: "Boolean mark",
      parentId: frame.id,
      childIds: ["boolean_base", "boolean_cutout"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 840, 72],
      size: { width: 120, height: 120 },
      opacity: 1,
      properties: {
        operation: "subtract",
        fills: [{ type: "solid", color: "#111827", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById.boolean_base = {
      id: "boolean_base",
      kind: "path",
      name: "Base",
      parentId: "boolean_mark",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 120, height: 120 },
      opacity: 1,
      properties: {
        path: "M0 0H120V120H0Z",
        fills: [{ type: "solid", color: "#ef4444", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById.boolean_cutout = {
      id: "boolean_cutout",
      kind: "path",
      name: "Cutout",
      parentId: "boolean_mark",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 30, 30],
      size: { width: 60, height: 60 },
      opacity: 1,
      properties: {
        path: "M0 0H60V60H0Z",
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    frame.childIds.push("boolean_mark");

    const projection = projectDesignPage(document, "page_welcome");
    expect(projection.elementsById.get("boolean_mark")).toMatchObject({
      tag: "Group",
      childIds: ["boolean_base", "boolean_cutout"],
    });
    expect(projection.elementsById.get("boolean_base")?.data.visible).toBe(
      false,
    );
    expect(projection.elementsById.get("boolean_cutout")?.data.visible).toBe(
      false,
    );
    expect(projection.warnings).toContainEqual({
      code: "boolean-geometry-pending",
      message:
        "Boolean node boolean_mark is waiting for its derived PathKit projection",
      nodeId: "boolean_mark",
    });

    const resultId = booleanResultElementId("boolean_mark");
    const resolved = projectResolvedBooleanGeometry(projection, document, {
      computedNodeIds: ["boolean_mark"],
      issues: [],
      pageId: "page_welcome",
      resolverVersion: 1,
      resultsByNodeId: new Map([
        [
          "boolean_mark",
          {
            bounds: { x: 0, y: 0, width: 120, height: 120 },
            empty: false,
            fillRule: "evenodd",
            nodeId: "boolean_mark",
            path: "M0 0H120V120H0ZM30 30H90V90H30Z",
            provider: "skia-pathkit",
            providerVersion: "1.0.0",
          },
        ],
      ]),
      reusedNodeIds: [],
    });
    expect(resolved.elementsById.get("boolean_mark")?.childIds).toEqual([
      resultId,
      "boolean_base",
      "boolean_cutout",
    ]);
    expect(resolved.elementsById.get(resultId)).toMatchObject({
      id: resultId,
      kind: "path",
      parentId: "boolean_mark",
      tag: "Path",
      transform: [1, 0, 0, 1, 0, 0],
      data: {
        id: resultId,
        editable: false,
        fill: [{ type: "solid", color: "#111827", opacity: 1 }],
        path: "M0 0H120V120H0ZM30 30H90V90H30Z",
        windingRule: "evenodd",
        data: {
          opendesignNodeId: "boolean_mark",
          opendesignSynthetic: true,
        },
      },
    });
    expect(resolved.warnings).not.toContainEqual(
      expect.objectContaining({ code: "boolean-geometry-pending" }),
    );
  });

  it("reprojects only nodes named by a contiguous transaction change set", () => {
    const document = createWelcomeDocument();
    const previous = projectDesignPage(document, "page_welcome");
    const next = structuredClone(document);
    next.revision += 1;
    const node = next.nodesById.feature_two;
    const previousNode = document.nodesById.feature_two;
    if (!node || !previousNode) throw new Error("Missing fixture node");
    node.opacity = 0.45;

    const projection = projectDesignPageIncrementally(
      previous,
      next,
      "page_welcome",
      {
        documentId: next.documentId,
        fromRevision: document.revision,
        toRevision: next.revision,
        addedNodeIds: [],
        changedNodeIds: [node.id],
        removedNodeIds: [],
        changes: [
          {
            type: "updated",
            nodeId: node.id,
            before: previousNode,
            after: node,
            changedFields: ["opacity"],
          },
        ],
      },
    );

    expect(projection.elementsById.get("feature_one")).toBe(
      previous.elementsById.get("feature_one"),
    );
    expect(projection.elementsById.get("feature_two")).not.toBe(
      previous.elementsById.get("feature_two"),
    );
    expect(projection.elementsById.get("feature_two")?.data.opacity).toBe(0.45);
    expect(projection.affectedNodeIds).toEqual(new Set(["feature_two"]));
  });

  it("projects ancestor locks onto the whole subtree and updates that subtree incrementally", () => {
    const document = createWelcomeDocument();
    const previous = projectDesignPage(document, "page_welcome");
    const lockedDocument = structuredClone(document);
    lockedDocument.revision += 1;
    const previousFrame = document.nodesById.frame_welcome;
    const lockedFrame = lockedDocument.nodesById.frame_welcome;
    if (!previousFrame || !lockedFrame) throw new Error("Missing root frame");
    lockedFrame.locked = true;

    const lockedProjection = projectDesignPageIncrementally(
      previous,
      lockedDocument,
      "page_welcome",
      {
        documentId: lockedDocument.documentId,
        fromRevision: document.revision,
        toRevision: lockedDocument.revision,
        addedNodeIds: [],
        changedNodeIds: [lockedFrame.id],
        removedNodeIds: [],
        changes: [
          {
            type: "updated",
            nodeId: lockedFrame.id,
            before: previousFrame,
            after: lockedFrame,
            changedFields: ["locked"],
          },
        ],
      },
    );

    expect(
      (
        lockedProjection.elementsById.get("frame_welcome")?.data.data as
          Record<string, unknown> | undefined
      )?.opendesignLocked,
    ).toBe(true);
    expect(
      (
        lockedProjection.elementsById.get("feature_one")?.data.data as
          Record<string, unknown> | undefined
      )?.opendesignLocked,
    ).toBe(true);
    expect(lockedProjection.elementsById.get("feature_one")?.data.locked).toBe(
      false,
    );
    expect(lockedProjection.affectedNodeIds).toContain("feature_one");

    const unlockedDocument = structuredClone(lockedDocument);
    unlockedDocument.revision += 1;
    const beforeUnlock = lockedDocument.nodesById.frame_welcome;
    const unlockedFrame = unlockedDocument.nodesById.frame_welcome;
    if (!beforeUnlock || !unlockedFrame) throw new Error("Missing root frame");
    unlockedFrame.locked = false;
    const unlockedProjection = projectDesignPageIncrementally(
      lockedProjection,
      unlockedDocument,
      "page_welcome",
      {
        documentId: unlockedDocument.documentId,
        fromRevision: lockedDocument.revision,
        toRevision: unlockedDocument.revision,
        addedNodeIds: [],
        changedNodeIds: [unlockedFrame.id],
        removedNodeIds: [],
        changes: [
          {
            type: "updated",
            nodeId: unlockedFrame.id,
            before: beforeUnlock,
            after: unlockedFrame,
            changedFields: ["locked"],
          },
        ],
      },
    );

    expect(
      (
        unlockedProjection.elementsById.get("feature_one")?.data.data as
          Record<string, unknown> | undefined
      )?.opendesignLocked,
    ).toBe(false);
    expect(unlockedProjection.affectedNodeIds).toContain("feature_one");
  });

  it("does not expose a URI image source directly to the renderer", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.hero = {
      id: "hero",
      kind: "image",
      name: "Hero",
      mimeType: "image/png",
      source: { type: "external", value: "file:///private/hero.png" },
      extensions: {},
    };
    document.nodesById.image = {
      id: "image",
      name: "Image",
      kind: "image",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 80 },
      opacity: 1,
      extensions: {},
      properties: {
        assetId: "hero",
        placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
        altText: "Hero",
        cornerRadius: 8,
      },
    };
    document.nodesById.frame_welcome?.childIds.push("image");

    const projection = projectDesignPage(document, "page_welcome");

    expect(projection.elementsById.get("image")?.tag).toBe("Image");
    expect(projection.elementsById.get("image")?.data).toMatchObject({
      url: null,
      fill: "#d9dce2",
    });
    expect(projection.warnings).toContainEqual(
      expect.objectContaining({ code: "missing-image", nodeId: "image" }),
    );

    const next = structuredClone(document);
    next.revision += 1;
    const nextAsset = next.assetsById.hero;
    if (!nextAsset || nextAsset.kind !== "image") {
      throw new Error("Missing image asset fixture");
    }
    nextAsset.source = { type: "data", value: "aW1hZ2U=" };
    const incremental = projectDesignPageIncrementally(
      projection,
      next,
      "page_welcome",
      {
        documentId: next.documentId,
        fromRevision: document.revision,
        toRevision: next.revision,
        addedNodeIds: [],
        changedNodeIds: [],
        removedNodeIds: [],
        changedAssetIds: ["hero"],
        changes: [],
      },
    );
    expect(incremental.elementsById.get("feature_one")).toBe(
      projection.elementsById.get("feature_one"),
    );
    expect(incremental.elementsById.get("image")?.data.fill).toMatchObject({
      type: "image",
      url: "data:image/png;base64,aW1hZ2U=",
    });
    expect(incremental.warnings).not.toContainEqual(
      expect.objectContaining({ code: "missing-image", nodeId: "image" }),
    );
  });

  it("projects non-destructive crop geometry through Leafer image fills", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.hero = {
      id: "hero",
      kind: "image",
      name: "Hero",
      mimeType: "image/png",
      source: { type: "data", value: "aW1hZ2U=" },
      size: { width: 400, height: 200 },
      extensions: {},
    };
    document.nodesById.image = {
      id: "image",
      name: "Image",
      kind: "image",
      parentId: "frame_welcome",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 1,
      extensions: {},
      properties: {
        assetId: "hero",
        placement: {
          mode: "crop",
          focalPoint: { x: 0.5, y: 0.5 },
          zoom: 1,
          rotation: 0,
          flipHorizontal: false,
          flipVertical: false,
        },
        altText: "Hero",
        cornerRadius: 8,
      },
    };
    document.nodesById.frame_welcome?.childIds.push("image");

    const projection = projectDesignPage(document, "page_welcome");

    expect(projection.elementsById.get("image")?.data.fill).toMatchObject({
      type: "image",
      mode: "clip",
      scale: { x: 0.5, y: 0.5 },
      offset: { x: -50, y: 0 },
      rotation: 0,
    });
  });

  it("projects gradients, glow, blur, blend and mask semantics to Leafer", () => {
    const document = structuredClone(createWelcomeDocument());
    const node = document.nodesById.feature_one;
    if (!node || node.kind !== "rectangle") throw new Error("Missing fixture");
    node.blendMode = "screen";
    node.maskMode = "alpha";
    node.effects = [
      {
        type: "outer-glow",
        color: "#3366ff",
        opacity: 0.5,
        radius: 32,
        spread: 4,
      },
      { type: "layer-blur", radius: 3 },
    ];
    node.properties.fills = [
      {
        type: "linear-gradient",
        opacity: 0.9,
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        stops: [
          { offset: 0, color: "#3366ff", opacity: 1 },
          { offset: 1, color: "#9b5cff", opacity: 0.4 },
        ],
      },
    ];

    const data = projectDesignPage(document, "page_welcome").elementsById.get(
      "feature_one",
    )?.data;
    expect(data).toMatchObject({
      blendMode: "screen",
      mask: "pixel",
      blur: 3,
      shadow: [
        {
          x: 0,
          y: 0,
          blur: 32,
          spread: 4,
          color: { r: 51, g: 102, b: 255, a: 0.5 },
        },
      ],
      fill: [
        {
          type: "linear",
          opacity: 0.9,
          stops: [
            { offset: 0, color: "#3366ff" },
            {
              offset: 1,
              color: { r: 155, g: 92, b: 255, a: 0.4 },
            },
          ],
        },
      ],
    });
  });

  it("projects portable path geometry with fills, strokes and winding rule", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing fixture");
    document.nodesById.penguin_path = {
      id: "penguin_path",
      name: "Penguin silhouette",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 40],
      size: { width: 160, height: 220 },
      opacity: 1,
      effects: [
        {
          type: "outer-glow",
          color: "#22d3ee",
          opacity: 0.65,
          radius: 18,
          spread: 2,
        },
      ],
      extensions: {},
      kind: "path",
      properties: {
        path: "M 80 4 C 126 4 154 46 148 108 C 143 171 118 214 80 216 C 42 214 17 171 12 108 C 6 46 34 4 80 4 Z",
        fillRule: "evenodd",
        fills: [
          {
            type: "linear-gradient",
            opacity: 1,
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            stops: [
              { offset: 0, color: "#111827", opacity: 1 },
              { offset: 1, color: "#312e81", opacity: 1 },
            ],
          },
        ],
        strokes: [{ type: "solid", color: "#f9fafb", opacity: 0.75 }],
        strokeWidth: 4,
        strokeAlign: "inside",
        strokeCap: "round",
        strokeJoin: "round",
      },
    };
    frame.childIds.push("penguin_path");

    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "penguin_path",
      ),
    ).toMatchObject({
      tag: "Path",
      data: {
        path: document.nodesById.penguin_path.properties.path,
        fill: [
          {
            type: "linear",
            opacity: 1,
            stops: [
              { offset: 0, color: "#111827" },
              { offset: 1, color: "#312e81" },
            ],
          },
        ],
        stroke: [
          {
            type: "solid",
            color: "#f9fafb",
            opacity: 0.75,
          },
        ],
        strokeWidth: 4,
        strokeAlign: "inside",
        strokeCap: "round",
        strokeJoin: "round",
        windingRule: "evenodd",
        shadow: [
          {
            x: 0,
            y: 0,
            blur: 18,
            spread: 2,
            color: { r: 34, g: 211, b: 238, a: 0.65 },
          },
        ],
      },
    });
  });
});
