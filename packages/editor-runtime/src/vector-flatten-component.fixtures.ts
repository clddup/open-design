import type {
  ComponentDefinition,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import { createEmptyDesignDocument } from "./document.js";

export function nestedInstanceDocument(): DesignDocument {
  const document = componentInstanceDocument();
  const buttonSlot = document.nodesById.button_slot;
  if (buttonSlot?.kind !== "slot") throw new Error("Missing Slot");
  const nested = instance();
  nested.id = "icon_instance_source";
  nested.name = "Icon";
  nested.parentId = buttonSlot.id;
  nested.transform = [1, 0, 0, 1, 8, 8];
  nested.size = { width: 24, height: 24 };
  nested.properties.componentId = "component_icon";
  nested.properties.overrides = [];
  buttonSlot.childIds.push(nested.id);

  document.nodesById[nested.id] = nested;
  document.nodesById.icon_main = frame("icon_main", null, ["icon_shape"]);
  document.nodesById.icon_main.size = { width: 24, height: 24 };
  document.nodesById.icon_shape = rectangle(
    "icon_shape",
    "icon_main",
    "#f97316",
  );
  document.nodesById.icon_shape.size = { width: 24, height: 24 };
  document.pagesById.page_components!.rootNodeIds.push("icon_main");
  document.componentsById.component_icon = component(
    "component_icon",
    "icon_main",
  );
  return document;
}

export function variantInstanceDocument(): DesignDocument {
  const document = componentInstanceDocument();
  const main = document.nodesById.button_main;
  if (main?.kind !== "frame") throw new Error("Missing Component Main");
  const setRoot = frame("button_set_root", null, [main.id, "hover_main"]);
  setRoot.size = { width: 220, height: 40 };
  main.parentId = setRoot.id;
  document.nodesById[setRoot.id] = setRoot;
  document.nodesById.hover_main = frame("hover_main", setRoot.id, ["hover_bg"]);
  document.nodesById.hover_main.transform = [1, 0, 0, 1, 120, 0];
  document.nodesById.hover_bg = rectangle("hover_bg", "hover_main", "#db2777");
  document.pagesById.page_components!.rootNodeIds = [setRoot.id];

  const defaultComponent = document.componentsById.component_button!;
  defaultComponent.variantSetId = "button_set";
  defaultComponent.variantProperties = { State: "Default" };
  document.componentsById.component_button_hover = {
    ...component("component_button_hover", "hover_main"),
    variantSetId: "button_set",
    variantProperties: { State: "Hover" },
  };
  document.variantSetsById.button_set = {
    id: "button_set",
    name: "Button",
    rootNodeId: setRoot.id,
    defaultComponentId: defaultComponent.id,
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
  const instanceNode = document.nodesById.button_instance;
  if (instanceNode?.kind !== "instance") throw new Error("Missing Instance");
  instanceNode.properties.componentProperties = { State: "Hover" };
  instanceNode.properties.overrides = [];
  return document;
}

export function slotOverrideDocument(): DesignDocument {
  const document = componentInstanceDocument();
  const instanceNode = document.nodesById.button_instance;
  if (instanceNode?.kind !== "instance") throw new Error("Missing Instance");
  const override = slot("button_slot_override", instanceNode.id, [
    "custom_slot_content",
  ]);
  override.properties.sourceSlotId = "button_slot";
  const content = rectangle("custom_slot_content", override.id, "#a855f7");
  instanceNode.childIds = [override.id];
  instanceNode.properties.overrides = [];
  document.nodesById[override.id] = override;
  document.nodesById[content.id] = content;
  return document;
}

export function componentInstanceDocument(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("component_flatten", "page_components"),
  );
  document.pageOrder.push("page_instances");
  document.pagesById.page_components!.rootNodeIds = ["button_main"];
  document.pagesById.page_instances = {
    id: "page_instances",
    name: "Instances",
    rootNodeIds: ["button_instance"],
    extensions: {},
  };

  document.nodesById.button_main = frame("button_main", null, ["button_slot"]);
  document.nodesById.button_slot = slot("button_slot", "button_main", [
    "button_bg",
  ]);
  document.nodesById.button_bg = rectangle(
    "button_bg",
    "button_slot",
    "#2563eb",
  );
  document.nodesById.button_instance = instance();
  document.componentsById.component_button = {
    ...component("component_button", "button_main"),
    name: "Primary button",
    componentPropertyOrder: ["Content#button:content"],
    componentPropertyDefinitions: {
      "Content#button:content": {
        type: "SLOT",
        defaultValue: "button_slot",
      },
    },
  };
  return document;
}

export function frame(
  id: string,
  parentId: string | null,
  childIds: string[],
): Extract<DesignNode, { kind: "frame" }> {
  return {
    id,
    name: id,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    exportSettings: [],
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
}

export function instance(): Extract<DesignNode, { kind: "instance" }> {
  return {
    id: "button_instance",
    name: "Primary button",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 60],
    size: { width: 100, height: 40 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: {
      componentId: "component_button",
      componentProperties: {},
      overrides: [
        {
          sourcePath: ["button_bg"],
          patch: {
            properties: {
              fills: [{ type: "solid", color: "#22c55e", opacity: 1 }],
            },
          },
        },
      ],
    },
  };
}

function component(id: string, rootNodeId: string): ComponentDefinition {
  return {
    id,
    name: id,
    rootNodeId,
    componentPropertyOrder: [],
    componentPropertyDefinitions: {},
    variantProperties: {},
    extensions: {},
  };
}

function slot(
  id: string,
  parentId: string,
  childIds: string[],
): Extract<DesignNode, { kind: "slot" }> {
  return {
    ...frame(id, parentId, childIds),
    kind: "slot",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
      clipsContent: false,
      sourceSlotId: null,
    },
  };
}

function rectangle(
  id: string,
  parentId: string,
  color: string,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
  };
}
