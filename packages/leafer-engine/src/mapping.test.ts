import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { projectDesignPage } from "./mapping.js";

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
        fit: "cover",
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
});
