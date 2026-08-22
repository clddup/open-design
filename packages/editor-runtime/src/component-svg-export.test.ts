import {
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";
import { exportSvg } from "@opendesign/import-export-service";
import { describe, expect, it } from "vitest";
import { EditorRuntime } from "./runtime.js";
import { planSvgExportRequest } from "./svg-export-operations.js";
import { planSetVariantProperties } from "./variant-set-property-operations.js";

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

  it("exports the selected Variant artwork without the authoring Component Set", () => {
    const document = variantFixture();
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
    expect(exported.svg).toContain("#db2777");
    expect(exported.svg).toContain("Hover");
    expect(exported.svg).not.toContain("#2563eb");
    expect(exported.svg).not.toContain("button_set_root");
  });

  it("exports the same resolved member after a Variant matrix edit", () => {
    const runtime = new EditorRuntime(variantFixture());
    const edit = planSetVariantProperties(runtime.getSnapshot().document, {
      pageId: "main-page",
      variantSetId: "button_set",
      componentId: "button_hover",
      variantProperties: { State: "Hovered" },
      commandPrefix: "rename-hover",
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    const before = runtime.getSnapshot().document;
    expect(
      runtime.apply({
        transactionId: "rename-hover",
        documentId: before.documentId,
        baseRevision: before.revision,
        actor: { type: "user", id: "test" },
        label: "Rename hover variant",
        commands: edit.commands,
      }),
    ).toMatchObject({ ok: true });
    const document = runtime.getSnapshot().document;
    const plan = planSvgExportRequest(document, {
      pageId: "instances",
      rootNodeIds: ["instance"],
      baseRevision: document.revision,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const exported = exportSvg(plan.request);
    expect(exported).toMatchObject({ ok: true });
    if (!exported.ok) return;
    expect(exported.svg).toContain("#db2777");
    expect(exported.svg).toContain("Hover");
  });
});

function variantFixture(): DesignDocument {
  const document = fixture();
  const main = document.nodesById.main;
  const background = document.nodesById.bg;
  const label = document.nodesById.label;
  const instance = document.nodesById.instance;
  if (
    main?.kind !== "frame" ||
    background?.kind !== "rectangle" ||
    label?.kind !== "text" ||
    instance?.kind !== "instance"
  ) {
    throw new Error("Variant SVG fixture is unavailable");
  }
  document.nodesById.set_root = {
    ...structuredClone(main),
    id: "set_root",
    name: "Button",
    parentId: null,
    childIds: ["main", "hover_main"],
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 280, height: 84 },
    properties: {
      ...structuredClone(main.properties),
      fills: [],
      strokes: [],
      clipsContent: false,
    },
    extensions: { semanticRole: "component-set" },
  };
  main.parentId = "set_root";
  document.nodesById.hover_main = {
    ...structuredClone(main),
    id: "hover_main",
    name: "State=Hover",
    childIds: ["hover_bg", "hover_label"],
    transform: [1, 0, 0, 1, 140, 0],
  };
  document.nodesById.hover_bg = {
    ...structuredClone(background),
    id: "hover_bg",
    parentId: "hover_main",
    properties: {
      ...structuredClone(background.properties),
      fills: [{ type: "solid", color: "#db2777", opacity: 1 }],
    },
  };
  document.nodesById.hover_label = {
    ...structuredClone(label),
    id: "hover_label",
    parentId: "hover_main",
    properties: { ...structuredClone(label.properties), content: "Hover" },
  };
  document.pagesById["main-page"]!.rootNodeIds = ["set_root"];
  document.componentsById = {
    button_default: {
      ...structuredClone(document.componentsById.button!),
      id: "button_default",
      name: "State=Default",
      variantSetId: "button_set",
      variantProperties: { State: "Default" },
    },
    button_hover: {
      ...structuredClone(document.componentsById.button!),
      id: "button_hover",
      name: "State=Hover",
      rootNodeId: "hover_main",
      variantSetId: "button_set",
      variantProperties: { State: "Hover" },
    },
  };
  document.variantSetsById.button_set = {
    id: "button_set",
    name: "Button",
    rootNodeId: "set_root",
    defaultComponentId: "button_default",
    propertyOrder: ["State"],
    componentPropertyDefinitions: {
      State: {
        type: "VARIANT",
        defaultValue: "Default",
        variantOptions: ["Default", "Hover"],
      },
    },
    extensions: {},
  };
  instance.properties.componentId = "button_default";
  instance.properties.componentProperties = { State: "Hover" };
  return document;
}

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
    exportSettings: [],
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
    exportSettings: [],
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
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content: "Continue",
      fontFamily: "Inter",
      fontStyleName: null,
      fontSize: 14,
      fontWeight: 500,
      fontSlant: "normal",
      lineHeight: 20,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
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
    exportSettings: [],
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
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantProperties: {},
        extensions: {},
      },
    },
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  };
}
