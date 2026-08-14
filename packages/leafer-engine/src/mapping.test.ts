import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import {
  cutVectorNetworkByLine,
  cutVectorPath,
  setVectorPathClosed,
} from "@opendesign/geometry-service/vector-edit";
import {
  booleanResultElementId,
  projectBooleanEditScope,
  projectDesignPage,
  projectDesignPageIncrementally,
  projectResolvedBooleanGeometry,
} from "./mapping.js";

describe("Leafer scene projection", () => {
  it("projects Slice as an invisible hittable export region", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.slice_1 = {
      id: "slice_1",
      kind: "slice",
      name: "Slice",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 10, 20],
      size: { width: 320, height: 180 },
      exportSettings: [],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    document.pagesById.page_welcome!.rootNodeIds.push("slice_1");
    expect(
      projectDesignPage(document, "page_welcome").elementsById.get("slice_1"),
    ).toMatchObject({
      tag: "Rect",
      data: {
        fill: "rgba(0, 0, 0, 0)",
        hitFill: "all",
        width: 320,
        height: 180,
      },
    });
  });

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
        textWrap: "normal",
        textOverflow: "hide",
      },
    });
  });

  it.each([
    ["none", "visible", "disabled", null, "none", "show"],
    ["word", "clip", "disabled", null, "normal", "hide"],
    ["character", "clip", "ending", 3, "break", "ellipsis"],
  ] as const)(
    "projects %s wrapping and %s overflow to Leafer Text",
    (
      textWrap,
      textOverflow,
      textTruncation,
      maxLines,
      expectedWrap,
      expectedOverflow,
    ) => {
      const document = structuredClone(createWelcomeDocument());
      const text = document.nodesById.title_welcome;
      if (!text || text.kind !== "text") throw new Error("Missing text");
      Object.assign(text.properties, {
        textWrap,
        textOverflow,
        textTruncation,
        maxLines,
      });

      expect(
        projectDesignPage(document, "page_welcome").elementsById.get(text.id),
      ).toMatchObject({
        tag: "Text",
        data: {
          textWrap: expectedWrap,
          textOverflow: expectedOverflow,
        },
      });
    },
  );

  it("keeps fixed text bounds authoritative when max-lines is projected", () => {
    const document = structuredClone(createWelcomeDocument());
    const text = document.nodesById.title_welcome;
    if (!text || text.kind !== "text") throw new Error("Missing text");
    text.size = { width: 160, height: 80 };
    Object.assign(text.properties, {
      maxLines: 2,
      textOverflow: "clip",
      textResize: "fixed",
      textTruncation: "ending",
      textWrap: "word",
    });

    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(text.id),
    ).toMatchObject({
      data: {
        height: 80,
        textOverflow: "ellipsis",
        width: 160,
      },
      textMaxLines: 2,
    });
    expect(text.size).toEqual({ width: 160, height: 80 });
  });

  it("projects Auto Width and Auto Height through Leafer native auto bounds", () => {
    const autoWidthDocument = structuredClone(createWelcomeDocument());
    const autoWidth = autoWidthDocument.nodesById.title_welcome;
    if (!autoWidth || autoWidth.kind !== "text")
      throw new Error("Missing text");
    Object.assign(autoWidth.properties, {
      textResize: "auto-width",
      textWrap: "none",
      textOverflow: "visible",
    });
    const autoWidthData = projectDesignPage(
      autoWidthDocument,
      "page_welcome",
    ).elementsById.get(autoWidth.id)?.data;
    expect(autoWidthData).toMatchObject({
      textWrap: "none",
      textOverflow: "show",
    });
    expect(Object.hasOwn(autoWidthData ?? {}, "width")).toBe(false);
    expect(Object.hasOwn(autoWidthData ?? {}, "height")).toBe(false);

    const autoHeightDocument = structuredClone(createWelcomeDocument());
    const autoHeight = autoHeightDocument.nodesById.title_welcome;
    if (!autoHeight || autoHeight.kind !== "text")
      throw new Error("Missing text");
    Object.assign(autoHeight.properties, {
      textResize: "auto-height",
      textWrap: "word",
      textOverflow: "visible",
    });
    const autoHeightData = projectDesignPage(
      autoHeightDocument,
      "page_welcome",
    ).elementsById.get(autoHeight.id)?.data;
    expect(autoHeightData).toMatchObject({ width: autoHeight.size.width });
    expect(Object.hasOwn(autoHeightData ?? {}, "height")).toBe(false);
  });

  it("projects semantic Polygon and Star nodes through native Leafer shapes", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    document.nodesById.badge_polygon = {
      id: "badge_polygon",
      kind: "polygon",
      name: "Hexagonal badge",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 80, 80],
      size: { width: 160, height: 120 },
      exportSettings: [],
      opacity: 1,
      properties: {
        pointCount: 6,
        cornerRadius: 10,
        fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    document.nodesById.signal_star = {
      id: "signal_star",
      kind: "star",
      name: "Signal star",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 280, 80],
      size: { width: 140, height: 140 },
      exportSettings: [],
      opacity: 1,
      properties: {
        pointCount: 7,
        innerRadius: 0.42,
        cornerRadius: 4,
        fills: [{ type: "solid", color: "#8b5cf6", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    frame.childIds.push("badge_polygon", "signal_star");

    const projection = projectDesignPage(document, "page_welcome");
    expect(projection.elementsById.get("badge_polygon")).toMatchObject({
      tag: "Polygon",
      data: {
        width: 160,
        height: 120,
        sides: 6,
        cornerRadius: 10,
      },
    });
    expect(projection.elementsById.get("signal_star")).toMatchObject({
      tag: "Star",
      data: {
        width: 140,
        height: 140,
        corners: 7,
        innerRadius: 0.42,
        cornerRadius: 4,
      },
    });
    expect(projection.warnings).toEqual([]);
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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

    const editing = projectBooleanEditScope(resolved, document, {
      booleanId: "boolean_mark",
      readOnly: false,
      selectedOperandIds: ["boolean_cutout"],
    });
    expect(editing.elementsById.get(resultId)).toBe(
      resolved.elementsById.get(resultId),
    );
    expect(editing.elementsById.get("boolean_base")?.data).toMatchObject({
      fill: null,
      hittable: true,
      opacity: 1,
      stroke: "#4f7fff",
      visible: true,
      data: {
        opendesignBooleanEditScopeId: "boolean_mark",
        opendesignBooleanOperandId: "boolean_base",
        opendesignBooleanReadOnly: false,
      },
    });
    expect(editing.elementsById.get("boolean_cutout")?.data).toMatchObject({
      fill: null,
      hittable: true,
      stroke: "#4f7fff",
      visible: true,
    });

    const entering = projectBooleanEditScope(
      resolved,
      document,
      {
        booleanId: "boolean_mark",
        readOnly: false,
        selectedOperandIds: ["boolean_cutout"],
      },
      {
        affectedBooleanNodeIds: new Set(["boolean_mark"]),
        forceAffected: true,
      },
    );
    expect(entering.affectedNodeIds).toEqual(
      new Set(["boolean_base", "boolean_cutout"]),
    );
    const exited = projectBooleanEditScope(resolved, document, undefined, {
      affectedBooleanNodeIds: new Set(["boolean_mark"]),
      forceAffected: true,
    });
    expect(exited.elementsById.get("boolean_base")?.data.visible).toBe(false);
    expect(exited.elementsById.get("boolean_cutout")?.data.visible).toBe(false);
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
      exportSettings: [],
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
      exportSettings: [],
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
      exportSettings: [],
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

    const penguinPath = document.nodesById.penguin_path;
    if (penguinPath.kind !== "path" || !("path" in penguinPath.properties)) {
      throw new Error("Expected an exact path-data fixture");
    }
    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "penguin_path",
      ),
    ).toMatchObject({
      tag: "Path",
      data: {
        path: penguinPath.properties.path,
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

  it("projects editable vector networks through the same Leafer Path backend", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    document.nodesById.editable_vector = {
      id: "editable_vector",
      name: "Editable vector",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 60],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "vector",
      properties: {
        network: {
          vertices: [
            { id: "vertex_a", x: 0, y: 0 },
            { id: "vertex_b", x: 100, y: 0 },
            { id: "vertex_c", x: 50, y: 100 },
          ],
          segments: [
            {
              id: "segment_ab",
              startVertexId: "vertex_a",
              endVertexId: "vertex_b",
              tangentStart: { x: 25, y: 0 },
              tangentEnd: { x: -25, y: 0 },
            },
            {
              id: "segment_bc",
              startVertexId: "vertex_b",
              endVertexId: "vertex_c",
            },
            {
              id: "segment_ca",
              startVertexId: "vertex_c",
              endVertexId: "vertex_a",
            },
          ],
          paths: [
            {
              id: "path_1",
              closed: true,
              segments: [
                { segmentId: "segment_ab", reversed: false },
                { segmentId: "segment_bc", reversed: false },
                { segmentId: "segment_ca", reversed: false },
              ],
            },
          ],
          regions: [
            {
              id: "region_1",
              windingRule: "nonzero",
              loops: [{ pathId: "path_1", reversed: false }],
            },
          ],
        },
        fills: [{ type: "solid", color: "#4f7fff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
    };
    frame.childIds.push("editable_vector");

    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "editable_vector",
      ),
    ).toMatchObject({
      tag: "Path",
      data: {
        path: "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z",
        windingRule: "nonzero",
      },
    });

    const editable = document.nodesById.editable_vector;
    if (editable.kind !== "vector" || !("network" in editable.properties)) {
      throw new Error("Missing editable network");
    }
    const originalNetwork = structuredClone(editable.properties.network);
    const divided = cutVectorNetworkByLine(
      originalNetwork,
      { x: -10, y: 50 },
      { x: 110, y: 50 },
    );
    if (!divided.ok) throw new Error(divided.message);
    editable.properties.network = divided.retainedNetwork;
    const extracted = structuredClone(editable);
    extracted.id = "editable_vector_cut";
    extracted.name = "Editable vector Cut";
    if (!("network" in extracted.properties)) {
      throw new Error("Missing extracted editable network");
    }
    extracted.properties.network = divided.extractedNetwork;
    document.nodesById[extracted.id] = extracted;
    frame.childIds.push(extracted.id);
    const dividedProjection = projectDesignPage(document, "page_welcome");
    for (const nodeId of [editable.id, extracted.id]) {
      const path = dividedProjection.elementsById.get(nodeId)?.data.path;
      expect(typeof path === "string" && path.endsWith(" Z")).toBe(true);
      expect(dividedProjection.elementsById.get(nodeId)?.data.fill).toEqual([
        { type: "solid", color: "#4f7fff", opacity: 1, visible: true },
      ]);
    }
    frame.childIds.pop();
    delete document.nodesById[extracted.id];
    editable.properties.network = originalNetwork;

    const compoundNetwork = structuredClone(originalNetwork);
    compoundNetwork.vertices.push(
      { id: "hole_a", x: 35, y: 30 },
      { id: "hole_b", x: 65, y: 30 },
      { id: "hole_c", x: 50, y: 60 },
    );
    compoundNetwork.segments.push(
      { id: "hole_ab", startVertexId: "hole_a", endVertexId: "hole_b" },
      { id: "hole_bc", startVertexId: "hole_b", endVertexId: "hole_c" },
      { id: "hole_ca", startVertexId: "hole_c", endVertexId: "hole_a" },
    );
    compoundNetwork.paths.push({
      id: "path_hole",
      closed: true,
      segments: [
        { segmentId: "hole_ab", reversed: false },
        { segmentId: "hole_bc", reversed: false },
        { segmentId: "hole_ca", reversed: false },
      ],
    });
    compoundNetwork.regions[0]!.loops.push({
      pathId: "path_hole",
      reversed: true,
    });
    editable.properties.network = compoundNetwork;
    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "editable_vector",
      )?.data,
    ).toMatchObject({
      path: "M 0 0 C 25 0 75 0 100 0 L 50 100 L 0 0 Z M 35 30 L 50 60 L 65 30 L 35 30 Z",
      fill: [{ type: "solid", color: "#4f7fff", opacity: 1, visible: true }],
      windingRule: "nonzero",
    });
    editable.properties.network = originalNetwork;

    const opened = setVectorPathClosed(
      editable.properties.network,
      false,
      "path_1",
    );
    if (!opened.ok) throw new Error(opened.message);
    const cut = cutVectorPath(opened.network, "path_1", {
      kind: "segment",
      segmentId: "segment_ab",
      t: 0.5,
    });
    if (!cut.ok) throw new Error(cut.message);
    editable.properties.network = cut.network;
    editable.properties.strokes = [
      { type: "solid", color: "#151515", opacity: 1 },
    ];
    editable.properties.strokeWidth = 2;
    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "editable_vector",
      )?.data,
    ).toMatchObject({
      path: "M 0 0 C 12.5 0 31.25 0 50 0 M 50 0 C 68.75 0 87.5 0 100 0 L 50 100",
      fill: null,
      stroke: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokeWidth: 2,
    });
  });

  it("projects directed Line semantics through Leafer Arrow without flattening endpoints", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    document.nodesById.flow_arrow = {
      id: "flow_arrow",
      name: "Flow arrow",
      parentId: frame.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 70, 90],
      size: { width: 240, height: 120 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "line",
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#2563eb", opacity: 1 }],
        strokeWidth: 4,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [10, 6],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
    };
    frame.childIds.push("flow_arrow");

    expect(
      projectDesignPage(document, "page_welcome").elementsById.get(
        "flow_arrow",
      ),
    ).toMatchObject({
      tag: "Arrow",
      transform: [1, 0, 0, 1, 70, 90],
      data: {
        fill: null,
        points: [240, 0, 0, 120],
        startArrow: "circle",
        endArrow: "triangle",
        strokeWidth: 4,
        strokeCap: "round",
        dashPattern: [10, 6],
      },
    });
  });
});
