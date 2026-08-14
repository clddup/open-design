import {
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
  type DesignNode,
} from "@opendesign/design-contracts";
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

  it("projects the selected Variant subtree without projecting the Component Set container", () => {
    const document = variantFixture();
    const projection = projectDesignPage(document, "instances");
    const hoverBackgroundId = componentProjectionId("button_instance", [
      "button_hover_bg",
    ]);

    expect(projection.rootIds).toEqual(["button_instance"]);
    expect(projection.elementsById.has("button_set_root")).toBe(false);
    expect(
      projection.elementsById.get(hoverBackgroundId)?.data.data,
    ).toMatchObject({
      opendesignNodeId: "button_instance",
      opendesignSourceNodeId: "button_hover_bg",
    });
    expect(
      projection.elementsById.has(
        componentProjectionId("button_instance", ["button_bg"]),
      ),
    ).toBe(false);
    expect(projection.warnings).toEqual([]);
  });

  it("projects Slot override contents as editable persistent layers", () => {
    const document = fixture();
    const main = document.nodesById.button_main;
    const instance = document.nodesById.button_instance;
    if (main?.kind !== "frame" || instance?.kind !== "instance") {
      throw new Error("Slot projection fixture is unavailable");
    }
    main.childIds = ["button_slot"];
    document.nodesById.button_slot = {
      ...structuredClone(main),
      id: "button_slot",
      name: "Content",
      parentId: main.id,
      childIds: ["button_label"],
      transform: [1, 0, 0, 1, 0, 0],
      kind: "slot",
      properties: {
        ...structuredClone(main.properties),
        sourceSlotId: null,
      },
    };
    document.nodesById.button_label!.parentId = "button_slot";
    document.componentsById.button!.componentPropertyDefinitions = {
      "Content#button:content": {
        type: "SLOT",
        defaultValue: "button_slot",
      },
    };
    document.nodesById.button_slot_override = {
      ...structuredClone(document.nodesById.button_slot),
      id: "button_slot_override",
      parentId: instance.id,
      childIds: ["button_slot_custom"],
      properties: {
        ...structuredClone(document.nodesById.button_slot.properties),
        sourceSlotId: "button_slot",
      },
    };
    document.nodesById.button_slot_custom = {
      ...structuredClone(document.nodesById.button_bg!),
      id: "button_slot_custom",
      parentId: "button_slot_override",
    };
    instance.childIds = ["button_slot_override"];

    const projection = projectDesignPage(document, "instances");

    expect(projection.elementsById.get("button_slot_override")?.kind).toBe(
      "slot",
    );
    expect(
      projection.elementsById.get("button_slot_custom")?.data.data,
    ).toMatchObject({
      opendesignNodeId: "button_slot_custom",
      opendesignSourceNodeId: "button_slot_custom",
    });
    expect(
      projection.elementsById.get("button_slot_override")?.childIds,
    ).toEqual(["button_slot_custom"]);
  });
});

function variantFixture(): DesignDocument {
  const document = fixture();
  const defaultRoot = document.nodesById.button_main;
  const defaultBackground = document.nodesById.button_bg;
  const defaultLabel = document.nodesById.button_label;
  const instance = document.nodesById.button_instance;
  if (
    defaultRoot?.kind !== "frame" ||
    defaultBackground?.kind !== "rectangle" ||
    defaultLabel?.kind !== "text" ||
    instance?.kind !== "instance"
  ) {
    throw new Error("Variant projection fixture is unavailable");
  }
  document.nodesById.button_set_root = {
    ...structuredClone(defaultRoot),
    id: "button_set_root",
    name: "Button",
    parentId: null,
    childIds: ["button_main", "button_hover_main"],
    transform: [1, 0, 0, 1, 20, 20],
    size: { width: 260, height: 80 },
    properties: {
      ...structuredClone(defaultRoot.properties),
      fills: [],
      strokes: [],
      clipsContent: false,
    },
    extensions: { semanticRole: "component-set" },
  };
  defaultRoot.parentId = "button_set_root";
  defaultRoot.transform = [1, 0, 0, 1, 0, 0];
  document.nodesById.button_hover_main = {
    ...structuredClone(defaultRoot),
    id: "button_hover_main",
    name: "State=Hover",
    childIds: ["button_hover_bg", "button_hover_label"],
    transform: [1, 0, 0, 1, 140, 0],
  };
  document.nodesById.button_hover_bg = {
    ...structuredClone(defaultBackground),
    id: "button_hover_bg",
    parentId: "button_hover_main",
    properties: {
      ...structuredClone(defaultBackground.properties),
      fills: [{ type: "solid", color: "#db2777", opacity: 1 }],
    },
  };
  document.nodesById.button_hover_label = {
    ...structuredClone(defaultLabel),
    id: "button_hover_label",
    parentId: "button_hover_main",
    properties: {
      ...structuredClone(defaultLabel.properties),
      content: "Hover",
    },
  };
  document.pagesById.main!.rootNodeIds = ["button_set_root"];
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
      rootNodeId: "button_hover_main",
      variantSetId: "button_set",
      variantProperties: { State: "Hover" },
    },
  };
  document.variantSetsById.button_set = {
    id: "button_set",
    name: "Button",
    rootNodeId: "button_set_root",
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
    properties: {
      componentId: "button",
      componentProperties: {},
      overrides: [],
    },
  };
  return {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
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
        componentPropertyOrder: [],
        componentPropertyDefinitions: {},
        variantProperties: {},
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
