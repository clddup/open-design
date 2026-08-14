import {
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";
import { exportSvg } from "@opendesign/import-export-service";
import { describe, expect, it } from "vitest";
import { planSvgExportRequest } from "./svg-export-operations.js";

describe("component SVG export", () => {
  it("exports resolved instance artwork instead of an empty structural group", () => {
    const document = fixture();
    const plan = planSvgExportRequest(document, {
      pageId: "instances",
      rootNodeIds: ["instance"],
      baseRevision: 1,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const exported = exportSvg(plan.request);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    expect(exported.svg).toContain("#2563eb");
    expect(exported.svg).toContain("Continue");
    expect(exported.exportedNodeIds).toContain("instance");
  });
});

function fixture(): DesignDocument {
  const main: Extract<DesignNode, { kind: "frame" }> = {
    id: "main",
    name: "Button",
    parentId: null,
    childIds: ["bg", "label"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    opacity: 1,
    extensions: {},
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 10,
      clipsContent: false,
    },
  };
  const bg: Extract<DesignNode, { kind: "rectangle" }> = {
    id: "bg",
    name: "Background",
    parentId: "main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 10,
    },
  };
  const label: Extract<DesignNode, { kind: "text" }> = {
    id: "label",
    name: "Label",
    parentId: "main",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 10],
    size: { width: 80, height: 24 },
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
    id: "instance",
    name: "Button instance",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 80, 60],
    size: { width: 120, height: 44 },
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: {
      componentId: "button",
      componentProperties: {},
      overrides: [],
    },
  };
  return {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "component-export",
    revision: 1,
    pageOrder: ["main-page", "instances"],
    pagesById: {
      "main-page": {
        id: "main-page",
        name: "Components",
        rootNodeIds: ["main"],
        extensions: {},
      },
      instances: {
        id: "instances",
        name: "Screen",
        rootNodeIds: ["instance"],
        extensions: {},
      },
    },
    nodesById: { main, bg, label, instance },
    componentsById: {
      button: {
        id: "button",
        name: "Button",
        rootNodeId: "main",
        componentPropertyDefinitions: {},
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
