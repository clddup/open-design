import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { createEmptyDesignDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { createComponentInspectorContext } from "./component-inspector-context";

describe("component Inspector derived selection context", () => {
  it("activates only a validated sourcePath owned by the selected Instance", () => {
    const document = fixture();
    const instance = document.nodesById.card_instance;
    const active = createComponentInspectorContext(document, instance, {
      instanceId: "card_instance",
      sourcePath: ["card_title"],
    });
    expect(active?.activeSourcePath).toEqual(["card_title"]);
    expect(
      active?.sourceNodes.find(
        (source) => source.sourcePath.join("/") === "card_title",
      )?.node,
    ).toMatchObject({ id: "card_title", kind: "text" });

    expect(
      createComponentInspectorContext(document, instance, {
        instanceId: "other_instance",
        sourcePath: ["card_title"],
      })?.activeSourcePath,
    ).toBeUndefined();
    expect(
      createComponentInspectorContext(document, instance, {
        instanceId: "card_instance",
        sourcePath: ["missing_source"],
      })?.activeSourcePath,
    ).toBeUndefined();
  });
});

function fixture(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("component_inspector_target", "main"),
  );
  const page = document.pagesById.main;
  if (!page) throw new Error("Missing component Inspector fixture Page");
  page.rootNodeIds = ["card_main", "card_instance"];
  document.nodesById.card_main = frame("card_main", null, ["card_title"]);
  document.nodesById.card_title = text("card_title", "card_main");
  document.nodesById.card_instance = instance("card_instance");
  document.componentsById.card_component = {
    id: "card_component",
    name: "Card",
    rootNodeId: "card_main",
    componentPropertyOrder: [],
    componentPropertyDefinitions: {},
    variantProperties: {},
    extensions: {},
  };
  return document;
}

function baseNode(id: string, parentId: string | null) {
  return {
    id,
    name: id,
    parentId,
    childIds: [] as string[],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    size: { width: 240, height: 160 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
  };
}

function frame(
  id: string,
  parentId: string | null,
  childIds: string[],
): Extract<DesignNode, { kind: "frame" }> {
  return {
    ...baseNode(id, parentId),
    childIds,
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: false,
    },
  };
}

function text(
  id: string,
  parentId: string,
): Extract<DesignNode, { kind: "text" }> {
  return {
    ...baseNode(id, parentId),
    kind: "text",
    properties: {
      content: "Camp adventure",
      fontFamily: "Inter",
      fontStyleName: null,
      fontSize: 24,
      fontWeight: 600,
      fontSlant: "normal",
      lineHeight: 30,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "auto-width",
      textWrap: "none",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
      fills: [{ type: "solid", color: "#111111", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function instance(id: string): Extract<DesignNode, { kind: "instance" }> {
  return {
    ...baseNode(id, null),
    kind: "instance",
    properties: {
      componentId: "card_component",
      componentProperties: {},
      overrides: [],
    },
  };
}
