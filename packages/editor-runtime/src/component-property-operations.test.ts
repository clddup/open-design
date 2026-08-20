import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  planDetachComponentInstance,
  planSetComponentOverride,
} from "./component-operations.js";
import {
  planAddComponentProperty,
  planRemoveComponentProperty,
  planRenameComponentProperty,
  planResetComponentPropertyValue,
  planSetComponentPropertyValue,
} from "./component-property-operations.js";
import { planReorderComponentProperties } from "./component-property-order-operations.js";
import {
  createEmptyDesignDocument,
  validateDocumentInvariants,
} from "./document.js";
import { EditorRuntime } from "./runtime.js";

describe("Figma-compatible component property operations", () => {
  it("authors Boolean, Text, and Instance swap properties and applies instance values before advanced overrides", () => {
    const runtime = new EditorRuntime(componentPropertyFixture());
    addProperty(runtime, {
      propertyId: "button:visible",
      name: "Show label",
      sourceNodeId: "button_label",
      type: "BOOLEAN",
    });
    addProperty(runtime, {
      propertyId: "button:text",
      name: "Label",
      sourceNodeId: "button_label",
      type: "TEXT",
    });
    addProperty(runtime, {
      propertyId: "button:icon",
      name: "Icon",
      sourceNodeId: "button_icon",
      type: "INSTANCE_SWAP",
      preferredValues: [{ type: "COMPONENT", key: "component_icon_alt" }],
    });

    const authored = runtime.getSnapshot().document;
    expect(
      authored.componentsById.component_button?.componentPropertyDefinitions,
    ).toEqual({
      "Show label#button:visible": {
        type: "BOOLEAN",
        defaultValue: true,
      },
      "Label#button:text": { type: "TEXT", defaultValue: "Continue" },
      "Icon#button:icon": {
        type: "INSTANCE_SWAP",
        defaultValue: "component_icon",
        preferredValues: [{ type: "COMPONENT", key: "component_icon_alt" }],
      },
    });
    expect(
      authored.componentsById.component_button?.componentPropertyOrder,
    ).toEqual([
      "Show label#button:visible",
      "Label#button:text",
      "Icon#button:icon",
    ]);
    expect(
      authored.nodesById.button_label?.componentPropertyReferences,
    ).toEqual({
      visible: "Show label#button:visible",
      characters: "Label#button:text",
    });
    expect(authored.nodesById.button_icon?.componentPropertyReferences).toEqual(
      { mainComponent: "Icon#button:icon" },
    );

    setProperty(runtime, "Show label#button:visible", false);
    setProperty(runtime, "Label#button:text", "Checkout");
    setProperty(runtime, "Icon#button:icon", "component_icon_alt");
    const propertyResolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(propertyResolution.ok).toBe(true);
    if (!propertyResolution.ok) return;
    const propertyLabel = propertyResolution.overrideTargets.find(
      (target) => target.sourceNodeId === "button_label",
    )?.node;
    expect(propertyLabel?.visible).toBe(false);
    expect(
      propertyLabel?.kind === "text" ? propertyLabel.properties.content : null,
    ).toBe("Checkout");
    expect(
      propertyResolution.nodes.some(
        (node) => node.sourceNodeId === "icon_alt_mark",
      ),
    ).toBe(true);
    expect(propertyResolution.componentProperties).toMatchObject({
      "Label#button:text": { type: "TEXT", value: "Checkout" },
      "Icon#button:icon": {
        type: "INSTANCE_SWAP",
        value: "component_icon_alt",
      },
    });

    const override = planSetComponentOverride(runtime.getSnapshot().document, {
      instanceId: "button_instance",
      sourcePath: ["button_label"],
      patch: { visible: true, properties: { content: "Advanced override" } },
      commandPrefix: "advanced",
    });
    expect(override.ok).toBe(true);
    apply(runtime, override.ok ? override.commands : [], "advanced");
    const overridden = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(overridden.ok).toBe(true);
    if (!overridden.ok) return;
    const overriddenLabel = overridden.overrideTargets.find(
      (target) => target.sourceNodeId === "button_label",
    )?.node;
    expect(overriddenLabel?.visible).toBe(true);
    expect(
      overriddenLabel?.kind === "text"
        ? overriddenLabel.properties.content
        : null,
    ).toBe("Advanced override");
  });

  it("synchronizes Main defaults and survives reset, undo, redo, reopen, and detach", () => {
    const runtime = new EditorRuntime(componentPropertyFixture());
    addProperty(runtime, {
      propertyId: "button:text",
      name: "Label",
      sourceNodeId: "button_label",
      type: "TEXT",
    });
    apply(
      runtime,
      [
        {
          commandId: "edit_main_label",
          type: "update_properties",
          nodeId: "button_label",
          properties: { content: "Updated default" },
        },
      ],
      "edit-main",
    );
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyDefinitions["Label#button:text"],
    ).toEqual({ type: "TEXT", defaultValue: "Updated default" });

    setProperty(runtime, "Label#button:text", "Instance label");
    const reset = planResetComponentPropertyValue(
      runtime.getSnapshot().document,
      {
        instanceId: "button_instance",
        propertyName: "Label#button:text",
        commandPrefix: "reset",
      },
    );
    expect(reset.ok).toBe(true);
    apply(runtime, reset.ok ? reset.commands : [], "reset");
    expect(instanceAssignments(runtime)).toEqual({});
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(instanceAssignments(runtime)).toEqual({
      "Label#button:text": "Instance label",
    });
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(instanceAssignments(runtime)).toEqual({});

    setProperty(runtime, "Label#button:text", "Saved label");
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(
      reopened.getSnapshot().document.componentsById.component_button
        ?.componentPropertyOrder,
    ).toEqual(["Label#button:text"]);
    expect(instanceAssignments(reopened)).toEqual({
      "Label#button:text": "Saved label",
    });
    const detached = planDetachComponentInstance(
      reopened.getSnapshot().document,
      { instanceId: "button_instance", commandPrefix: "detach" },
    );
    expect(detached.ok).toBe(true);
    apply(reopened, detached.ok ? detached.commands : [], "detach");
    const detachedLabel = Object.values(
      reopened.getSnapshot().document.nodesById,
    ).find(
      (node) =>
        node.kind === "text" && node.properties.content === "Saved label",
    );
    expect(
      detachedLabel?.kind === "text" ? detachedLabel.properties.content : null,
    ).toBe("Saved label");
  });

  it("renames and removes definitions, references, and direct instance assignments atomically", () => {
    const runtime = new EditorRuntime(componentPropertyFixture());
    addProperty(runtime, {
      propertyId: "button:text",
      name: "Label",
      sourceNodeId: "button_label",
      type: "TEXT",
    });
    setProperty(runtime, "Label#button:text", "Checkout");
    const renamed = planRenameComponentProperty(
      runtime.getSnapshot().document,
      {
        componentId: "component_button",
        propertyName: "Label#button:text",
        name: "Button label",
        commandPrefix: "rename",
      },
    );
    expect(renamed.ok).toBe(true);
    apply(runtime, renamed.ok ? renamed.commands : [], "rename");
    expect(instanceAssignments(runtime)).toEqual({
      "Button label#button:text": "Checkout",
    });
    expect(
      runtime.getSnapshot().document.nodesById.button_label
        ?.componentPropertyReferences,
    ).toEqual({ characters: "Button label#button:text" });
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyOrder,
    ).toEqual(["Button label#button:text"]);

    const removed = planRemoveComponentProperty(
      runtime.getSnapshot().document,
      {
        componentId: "component_button",
        propertyName: "Button label#button:text",
        commandPrefix: "remove",
      },
    );
    expect(removed.ok).toBe(true);
    apply(runtime, removed.ok ? removed.commands : [], "remove");
    expect(instanceAssignments(runtime)).toEqual({});
    expect(
      runtime.getSnapshot().document.nodesById.button_label
        ?.componentPropertyReferences,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyDefinitions,
    ).toEqual({});
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyOrder,
    ).toEqual([]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(instanceAssignments(runtime)).toEqual({
      "Button label#button:text": "Checkout",
    });
  });

  it("reorders ordinary properties as one revision and restores the order through undo", () => {
    const runtime = new EditorRuntime(componentPropertyFixture());
    addProperty(runtime, {
      propertyId: "button:visible",
      name: "Show label",
      sourceNodeId: "button_label",
      type: "BOOLEAN",
    });
    addProperty(runtime, {
      propertyId: "button:text",
      name: "Label",
      sourceNodeId: "button_label",
      type: "TEXT",
    });
    const beforeRevision = runtime.getSnapshot().document.revision;
    const reordered = planReorderComponentProperties(
      runtime.getSnapshot().document,
      {
        componentId: "component_button",
        componentPropertyOrder: [
          "Label#button:text",
          "Show label#button:visible",
        ],
        commandPrefix: "reorder",
      },
    );
    expect(reordered.ok).toBe(true);
    apply(runtime, reordered.ok ? reordered.commands : [], "reorder");
    expect(runtime.getSnapshot().document.revision).toBe(beforeRevision + 1);
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyOrder,
    ).toEqual(["Label#button:text", "Show label#button:visible"]);
    const resolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(
      resolution.ok && Object.keys(resolution.componentProperties),
    ).toEqual(["Label#button:text", "Show label#button:visible"]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.componentsById.component_button
        ?.componentPropertyOrder,
    ).toEqual(["Show label#button:visible", "Label#button:text"]);
  });

  it("rejects Component property orders that do not exactly cover definitions", () => {
    const document = componentPropertyFixture();
    document.componentsById.component_button!.componentPropertyDefinitions = {
      "Label#button:text": { type: "TEXT", defaultValue: "Continue" },
    };
    expect(validateDocumentInvariants(document)).toContainEqual({
      path: "/componentsById/component_button/componentPropertyOrder",
      message:
        "component property order must contain every ordinary component property exactly once",
    });
  });

  it("rejects Slot-in-Slot authoring from either nesting direction", () => {
    const descendantRuntime = new EditorRuntime(nestedSlotCandidateFixture());
    addSlotProperty(descendantRuntime, "slot_inner", "Inner", "slot:inner");
    expect(
      planAddComponentProperty(descendantRuntime.getSnapshot().document, {
        componentId: "component_button",
        propertyId: "slot:outer",
        name: "Outer",
        type: "SLOT",
        sourceNodeId: "slot_outer",
        commandPrefix: "reject_outer_slot",
      }),
    ).toEqual({
      ok: false,
      code: "invalid",
      message:
        "A Slot cannot contain another Slot; compose nested flexible content through a component Instance instead",
    });

    const ancestorRuntime = new EditorRuntime(nestedSlotCandidateFixture());
    addSlotProperty(ancestorRuntime, "slot_outer", "Outer", "slot:outer");
    expect(
      planAddComponentProperty(ancestorRuntime.getSnapshot().document, {
        componentId: "component_button",
        propertyId: "slot:inner",
        name: "Inner",
        type: "SLOT",
        sourceNodeId: "slot_inner",
        commandPrefix: "reject_inner_slot",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });

  it("rejects a malformed persisted source Slot nested inside another Slot", () => {
    const runtime = new EditorRuntime(nestedSlotCandidateFixture());
    addSlotProperty(runtime, "slot_outer", "Outer", "slot:outer");
    const malformed = structuredClone(runtime.getSnapshot().document);
    const inner = malformed.nodesById.slot_inner;
    if (inner?.kind !== "frame")
      throw new Error("Missing inner Slot candidate");
    malformed.nodesById.slot_inner = {
      ...inner,
      kind: "slot",
      properties: {
        ...inner.properties,
        sourceSlotId: null,
      },
    };
    const component = malformed.componentsById.component_button;
    if (!component) throw new Error("Missing component fixture");
    component.componentPropertyDefinitions["Inner#slot:inner"] = {
      type: "SLOT",
      defaultValue: "slot_inner",
    };
    component.componentPropertyOrder.push("Inner#slot:inner");

    expect(validateDocumentInvariants(malformed)).toContainEqual({
      path: "/nodesById/slot_inner/parentId",
      message:
        "A source Slot cannot be nested inside another Slot; use a nested component Instance for composable Slot content",
    });
  });

  it("rejects an Instance swap property value that creates a component cycle", () => {
    const runtime = new EditorRuntime(componentPropertyFixture(true));
    addProperty(runtime, {
      propertyId: "button:icon",
      name: "Icon",
      sourceNodeId: "button_icon",
      type: "INSTANCE_SWAP",
    });
    expect(
      planSetComponentPropertyValue(runtime.getSnapshot().document, {
        instanceId: "button_instance",
        propertyName: "Icon#button:icon",
        value: "component_cycle",
        commandPrefix: "cycle",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
  });
});

function addProperty(
  runtime: EditorRuntime,
  input: Omit<
    Parameters<typeof planAddComponentProperty>[1],
    "componentId" | "commandPrefix"
  >,
): void {
  const plan = planAddComponentProperty(runtime.getSnapshot().document, {
    ...input,
    componentId: "component_button",
    commandPrefix: `add_${input.propertyId}`,
  });
  expect(plan.ok).toBe(true);
  apply(runtime, plan.ok ? plan.commands : [], `add-${input.propertyId}`);
}

function addSlotProperty(
  runtime: EditorRuntime,
  sourceNodeId: string,
  name: string,
  propertyId: string,
): void {
  const plan = planAddComponentProperty(runtime.getSnapshot().document, {
    componentId: "component_button",
    propertyId,
    name,
    type: "SLOT",
    sourceNodeId,
    commandPrefix: `add_${propertyId}`,
  });
  expect(plan.ok, JSON.stringify(plan)).toBe(true);
  apply(runtime, plan.ok ? plan.commands : [], `add-${propertyId}`);
}

function setProperty(
  runtime: EditorRuntime,
  propertyName: string,
  value: string | boolean,
): void {
  const revision = runtime.getSnapshot().document.revision;
  const plan = planSetComponentPropertyValue(runtime.getSnapshot().document, {
    instanceId: "button_instance",
    propertyName,
    value,
    commandPrefix: `set_${revision}_${propertyName}`,
  });
  expect(plan.ok).toBe(true);
  apply(
    runtime,
    plan.ok ? plan.commands : [],
    `set-${revision}-${propertyName}`,
  );
}

function instanceAssignments(runtime: EditorRuntime) {
  const instance = runtime.getSnapshot().document.nodesById.button_instance;
  return instance?.kind === "instance"
    ? instance.properties.componentProperties
    : undefined;
}

function apply(
  runtime: EditorRuntime,
  commands: DesignOperation[],
  id: string,
): void {
  const snapshot = runtime.getSnapshot();
  const result = runtime.apply({
    transactionId: id,
    documentId: snapshot.document.documentId,
    baseRevision: snapshot.document.revision,
    actor: { type: "user", id: "component-property-test" },
    label: id,
    commands,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

function componentPropertyFixture(withCycleCandidate = false): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("component_property_doc", "page_main"),
  );
  document.pageOrder.push("page_instances");
  document.pagesById.page_instances = {
    id: "page_instances",
    name: "Instances",
    rootNodeIds: ["button_instance"],
    extensions: {},
  };
  document.pagesById.page_main!.rootNodeIds = [
    "button_main",
    "icon_main",
    "icon_alt_main",
  ];
  document.nodesById.button_main = frame("button_main", null, [
    "button_label",
    "button_icon",
  ]);
  document.nodesById.button_label = text(
    "button_label",
    "button_main",
    "Continue",
  );
  document.nodesById.button_icon = instance(
    "button_icon",
    "button_main",
    "component_icon",
  );
  document.nodesById.icon_main = frame("icon_main", null, ["icon_mark"]);
  document.nodesById.icon_mark = rectangle("icon_mark", "icon_main");
  document.nodesById.icon_alt_main = frame("icon_alt_main", null, [
    "icon_alt_mark",
  ]);
  document.nodesById.icon_alt_mark = rectangle(
    "icon_alt_mark",
    "icon_alt_main",
  );
  document.nodesById.button_instance = instance(
    "button_instance",
    null,
    "component_button",
  );
  document.componentsById.component_button = component(
    "component_button",
    "button_main",
  );
  document.componentsById.component_icon = component(
    "component_icon",
    "icon_main",
  );
  document.componentsById.component_icon_alt = component(
    "component_icon_alt",
    "icon_alt_main",
  );
  if (withCycleCandidate) {
    document.pagesById.page_main!.rootNodeIds.push("cycle_main");
    document.nodesById.cycle_main = frame("cycle_main", null, ["cycle_button"]);
    document.nodesById.cycle_button = instance(
      "cycle_button",
      "cycle_main",
      "component_button",
    );
    document.componentsById.component_cycle = component(
      "component_cycle",
      "cycle_main",
    );
  }
  return document;
}

function nestedSlotCandidateFixture(): DesignDocument {
  const document = componentPropertyFixture();
  const root = document.nodesById.button_main;
  if (root?.kind !== "frame") throw new Error("Missing component root");
  root.childIds.push("slot_outer");
  document.nodesById.slot_outer = frame("slot_outer", "button_main", [
    "slot_inner",
  ]);
  document.nodesById.slot_inner = frame("slot_inner", "slot_outer", []);
  return document;
}

function component(id: string, rootNodeId: string) {
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

function frame(
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

function text(
  id: string,
  parentId: string,
  content: string,
): Extract<DesignNode, { kind: "text" }> {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 12, 10],
    size: { width: 76, height: 20 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content,
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
}

function rectangle(
  id: string,
  parentId: string,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 16, height: 16 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color: "#111111", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 4,
    },
  };
}

function instance(
  id: string,
  parentId: string | null,
  componentId: string,
): Extract<DesignNode, { kind: "instance" }> {
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
    kind: "instance",
    properties: { componentId, componentProperties: {}, overrides: [] },
  };
}
