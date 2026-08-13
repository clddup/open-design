import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { componentProjectionId } from "@opendesign/component-service";
import {
  projectDesignPage,
  projectDesignPageIncrementally,
} from "./mapping.js";

describe("component projection", () => {
  it("projects instance children with stable ids and selects through the instance shell", () => {
    const document = fixture();
    const projection = projectDesignPage(document, "instances");
    const backgroundId = componentProjectionId("button_instance", [
      "button_bg",
    ]);
    expect(projection.rootIds).toEqual(["button_instance"]);
    expect(projection.elementsById.get("button_instance")?.kind).toBe(
      "instance",
    );
    expect(
      projection.elementsById.get("button_instance")?.data.editConfig,
    ).toMatchObject({ preventEditInner: true, resizeable: false });
    expect(projection.elementsById.get("button_instance")?.childIds).toContain(
      backgroundId,
    );
    expect(projection.elementsById.get(backgroundId)?.data.data).toMatchObject({
      opendesignNodeId: "button_instance",
      opendesignSourceNodeId: "button_bg",
    });
    expect(projection.warnings).toEqual([]);
  });

  it("marks only changed resolved instance specs when main appearance changes", () => {
    const before = fixture();
    const previous = projectDesignPage(before, "instances");
    const after = structuredClone(before);
    after.revision = 2;
    const background = after.nodesById.button_bg;
    if (background?.kind === "rectangle") {
      background.properties.fills = [
        { type: "solid", color: "#db2777", opacity: 1 },
      ];
    }
    const projection = projectDesignPageIncrementally(
      previous,
      after,
      "instances",
      {
        documentId: after.documentId,
        fromRevision: 1,
        toRevision: 2,
        addedNodeIds: [],
        changedNodeIds: ["button_bg"],
        removedNodeIds: [],
        changes: [],
      },
    );
    expect(projection.affectedNodeIds).toContain(
      componentProjectionId("button_instance", ["button_bg"]),
    );
    expect(projection.affectedNodeIds).not.toContain(
      componentProjectionId("button_instance", ["button_label"]),
    );
  });
});

function fixture(): DesignDocument {
  const frame: Extract<DesignNode, { kind: "frame" }> = {
    id: "button_main",
    name: "Button",
    parentId: null,
    childIds: ["button_bg", "button_label"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 20],
    size: { width: 100, height: 40 },
    opacity: 1,
    extensions: {},
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
      clipsContent: false,
    },
  };
  const background: Extract<DesignNode, { kind: "rectangle" }> = {
    id: "button_bg",
    name: "Background",
    parentId: "button_main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
  };
  const label: Extract<DesignNode, { kind: "text" }> = {
    id: "button_label",
    name: "Label",
    parentId: "button_main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 12, 10],
    size: { width: 76, height: 20 },
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content: "Continue",
      fontFamily: "Inter",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      letterSpacing: 0,
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "visible",
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
  const instance: Extract<DesignNode, { kind: "instance" }> = {
    id: "button_instance",
    name: "Button instance",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 200, 80],
    size: { width: 100, height: 40 },
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: { componentId: "button", overrides: [] },
  };
  return {
    format: "dev.opendesign.document",
    schemaVersion: "1.14.0",
    documentId: "doc",
    revision: 1,
    pageOrder: ["main", "instances"],
    pagesById: {
      main: {
        id: "main",
        name: "Main",
        rootNodeIds: ["button_main"],
        extensions: {},
      },
      instances: {
        id: "instances",
        name: "Instances",
        rootNodeIds: ["button_instance"],
        extensions: {},
      },
    },
    nodesById: {
      button_main: frame,
      button_bg: background,
      button_label: label,
      button_instance: instance,
    },
    componentsById: {
      button: {
        id: "button",
        name: "Button",
        rootNodeId: "button_main",
        extensions: {},
      },
    },
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}
