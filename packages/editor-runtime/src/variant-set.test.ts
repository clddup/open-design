import { resolveComponentInstance } from "@opendesign/component-service";
import {
  DESIGN_SCHEMA_VERSION,
  type DesignDocument,
  type DesignOperation,
  type FrameNode,
  type TextNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  normalizeDesignDocument,
  validateDocumentInvariants,
} from "./document.js";
import { getWorldTransform } from "./geometry.js";
import { EditorRuntime } from "./runtime.js";
import {
  planResetComponentPropertyValue,
  planSetComponentPropertyValue,
} from "./component-property-operations.js";
import { planRemoveComponent } from "./component-operations.js";
import { planCombineComponentsAsVariants } from "./variant-set-operations.js";
import {
  planAddComponentToVariantSet,
  planDissolveVariantSet,
  planDuplicateVariant,
  planRemoveVariantFromSet,
} from "./variant-set-membership-operations.js";
import {
  planAddVariantProperty,
  planRemoveVariantProperty,
  planRenameVariantProperty,
  planRenameVariantValue,
  planReorderVariantProperties,
  planReorderVariantValues,
  planSetVariantProperties,
} from "./variant-set-property-operations.js";

describe("Figma-compatible Component Set variants", () => {
  it("migrates 1.22 Variant Sets to explicit property order", () => {
    const legacy = structuredClone(variantFixture()) as unknown as {
      schemaVersion: string;
      variantSetsById: Record<string, { propertyOrder?: string[] }>;
    };
    legacy.schemaVersion = "1.22.0";
    delete legacy.variantSetsById.button_set?.propertyOrder;

    const migrated = normalizeDesignDocument(legacy);

    expect(migrated.schemaVersion).toBe(DESIGN_SCHEMA_VERSION);
    expect(migrated.variantSetsById.button_set?.propertyOrder).toEqual([
      "State",
    ]);
  });

  it("combines sibling Components in one undoable transaction without moving their world geometry", () => {
    const runtime = new EditorRuntime(combinableVariantFixture());
    const before = runtime.getSnapshot().document;
    const defaultWorld = getWorldTransform(before, "button_default_root");
    const hoverWorld = getWorldTransform(before, "button_hover_root");
    const plan = planCombineComponentsAsVariants(before, {
      pageId: "page",
      componentIds: ["button_hover", "button_default"],
      variantSetId: "button_set",
      rootNodeId: "button_set_root",
      name: "Button",
      variantPropertiesByComponentId: {
        button_default: { State: "Default" },
        button_hover: { State: "Hover" },
      },
      commandPrefix: "combine",
    });

    expect(plan).toMatchObject({
      ok: true,
      defaultComponentId: "button_default",
      selectionNodeIds: ["button_set_root"],
    });
    if (!plan.ok) return;
    const result = runtime.apply(transaction(runtime, plan.commands));
    expect(result).toMatchObject({
      ok: true,
      revision: { revision: 2 },
      changes: {
        addedVariantSetIds: ["button_set"],
        changedComponentIds: ["button_default", "button_hover"],
      },
    });
    const combined = runtime.getSnapshot().document;
    expect(combined.variantSetsById.button_set).toMatchObject({
      rootNodeId: "button_set_root",
      defaultComponentId: "button_default",
      componentPropertyDefinitions: {
        State: {
          type: "VARIANT",
          defaultValue: "Default",
          variantOptions: ["Default", "Hover"],
        },
      },
    });
    expect(combined.nodesById.button_set_root?.childIds).toEqual([
      "button_default_root",
      "button_hover_root",
    ]);
    expect(getWorldTransform(combined, "button_default_root")).toEqual(
      defaultWorld,
    );
    expect(getWorldTransform(combined, "button_hover_root")).toEqual(
      hoverWorld,
    );
    expect(resolveComponentInstance(combined, "button_instance")).toMatchObject(
      { ok: true, componentId: "button_default" },
    );

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.componentsById.button_default
        ?.variantSetId,
    ).toBeUndefined();

    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(
        JSON.stringify(runtime.getSnapshot().document),
      ) as DesignDocument,
    );
    expect(
      reopened.getSnapshot().document.variantSetsById.button_set,
    ).toMatchObject({
      defaultComponentId: "button_default",
      rootNodeId: "button_set_root",
      propertyOrder: ["State"],
    });
    expect(
      resolveComponentInstance(
        reopened.getSnapshot().document,
        "button_instance",
      ),
    ).toMatchObject({ ok: true, componentId: "button_default" });
  });

  it("selects a unique variant from consolidated instance properties", () => {
    const document = normalizeDesignDocument(variantFixture());

    const resolution = resolveComponentInstance(document, "button_instance");

    expect(resolution).toMatchObject({
      ok: true,
      componentId: "button_hover",
      componentProperties: {
        State: { type: "VARIANT", value: "Hover" },
      },
    });
    if (!resolution.ok) return;
    expect(Object.keys(resolution.componentProperties)).toEqual([
      "State",
      "Show label#button:visible",
    ]);
    expect(resolution.nodes.find((node) => node.root)?.sourceNodeId).toBe(
      "button_hover_root",
    );
    expect(
      resolution.nodes.find((node) => node.sourceNodeId === "hover_label")
        ?.node,
    ).toMatchObject({
      kind: "text",
      properties: { content: "Hover" },
    });
  });

  it("sets and resets VARIANT properties through the shared Instance transaction path", () => {
    const runtime = new EditorRuntime(variantFixture());
    const reset = planResetComponentPropertyValue(
      runtime.getSnapshot().document,
      {
        instanceId: "button_instance",
        propertyName: "State",
        commandPrefix: "reset-state",
      },
    );
    expect(reset.ok).toBe(true);
    if (!reset.ok) return;
    expect(
      runtime.apply(transaction(runtime, reset.commands, "reset-state")),
    ).toMatchObject({ ok: true });
    expect(
      resolveComponentInstance(
        runtime.getSnapshot().document,
        "button_instance",
      ),
    ).toMatchObject({ ok: true, componentId: "button_default" });

    const set = planSetComponentPropertyValue(runtime.getSnapshot().document, {
      instanceId: "button_instance",
      propertyName: "State",
      value: "Hover",
      commandPrefix: "set-state",
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    expect(
      runtime.apply(transaction(runtime, set.commands, "set-state")),
    ).toMatchObject({ ok: true });
    expect(
      resolveComponentInstance(
        runtime.getSnapshot().document,
        "button_instance",
      ),
    ).toMatchObject({ ok: true, componentId: "button_hover" });
    const invalid = planSetComponentPropertyValue(
      runtime.getSnapshot().document,
      {
        instanceId: "button_instance",
        propertyName: "State",
        value: "Pressed",
        commandPrefix: "invalid-state",
      },
    );
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid).toMatchObject({
      code: "invalid",
    });
    expect(invalid.message).toContain("Default, Hover");
  });

  it("rejects incomplete, duplicate, and non-default-top-left variant facts", () => {
    const incomplete = variantFixture();
    incomplete.componentsById.button_hover!.variantProperties = {};
    expect(
      validateDocumentInvariants(incomplete).some(
        (issue) =>
          issue.path === "/componentsById/button_hover/variantProperties" &&
          issue.message.includes("complete property collection"),
      ),
    ).toBe(true);

    const duplicate = variantFixture();
    duplicate.componentsById.button_hover!.variantProperties.State = "Default";
    expect(validateDocumentInvariants(duplicate)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "variant property combinations must be unique",
        }),
      ]),
    );

    const wrongDefault = variantFixture();
    wrongDefault.variantSetsById.button_set!.defaultComponentId =
      "button_hover";
    wrongDefault.variantSetsById.button_set!.componentPropertyDefinitions.State!.defaultValue =
      "Hover";
    expect(validateDocumentInvariants(wrongDefault)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "the top-left Component must be the default variant",
        }),
      ]),
    );

    const invalidOrder = variantFixture();
    invalidOrder.variantSetsById.button_set!.propertyOrder = ["Missing"];
    expect(validateDocumentInvariants(invalidOrder)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/variantSetsById/button_set/propertyOrder",
        }),
      ]),
    );
  });

  it("rejects an instance value that has no declared variant option", () => {
    const document = variantFixture();
    const instance = document.nodesById.button_instance;
    if (instance?.kind !== "instance") throw new Error("Missing instance");
    instance.properties.componentProperties.State = "Pressed";

    const resolution = resolveComponentInstance(document, instance.id);

    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.issues[0]?.code).toBe("invalid-component-property");
    expect(resolution.issues[0]?.message).toContain("Default, Hover");
  });

  it("fails closed when a member is removed without a Component Set operation", () => {
    const plan = planRemoveComponent(variantFixture(), {
      componentId: "button_hover",
      commandPrefix: "remove-hover",
    });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.code).toBe("invalid");
    expect(plan.message).toContain("remove or dissolve the Component Set");
  });

  it("adds and duplicates variants while keeping one valid Set transaction", () => {
    const document = variantFixture();
    const pressedRoot = frame(
      "button_pressed_root",
      null,
      ["pressed_label"],
      -200,
    );
    document.nodesById[pressedRoot.id] = pressedRoot;
    document.nodesById.pressed_label = text(
      "pressed_label",
      pressedRoot.id,
      "Pressed",
    );
    document.pagesById.page!.rootNodeIds.push(pressedRoot.id);
    document.componentsById.button_pressed = {
      id: "button_pressed",
      name: "Button / Pressed",
      rootNodeId: pressedRoot.id,
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    const beforeWorld = getWorldTransform(document, pressedRoot.id);
    const runtime = new EditorRuntime(document);
    const add = planAddComponentToVariantSet(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      componentId: "button_pressed",
      variantProperties: { State: "Pressed" },
      commandPrefix: "add-pressed",
    });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(
      runtime.apply(transaction(runtime, add.commands, "add-pressed")),
    ).toMatchObject({ ok: true });
    expect(
      getWorldTransform(runtime.getSnapshot().document, pressedRoot.id),
    ).toEqual(beforeWorld);
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set
        ?.componentPropertyDefinitions.State?.variantOptions,
    ).toEqual(["Pressed", "Default", "Hover"]);

    const duplicate = planDuplicateVariant(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      sourceComponentId: "button_default",
      componentId: "button_focus",
      rootNodeId: "button_focus_root",
      variantProperties: { State: "Focus" },
      commandPrefix: "duplicate-focus",
    });
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(
      runtime.apply(
        transaction(runtime, duplicate.commands, "duplicate-focus"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.componentsById.button_focus,
    ).toMatchObject({
      variantSetId: "button_set",
      rootNodeId: "button_focus_root",
    });
    expect(runtime.undo()).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.componentsById.button_focus,
    ).toBeUndefined();
  });

  it("removes a selected Variant without breaking instances and dissolves the Set", () => {
    const document = variantFixture();
    const runtime = new EditorRuntime(document);
    const remove = planRemoveVariantFromSet(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      componentId: "button_hover",
      commandPrefix: "remove-hover",
    });
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(
      runtime.apply(transaction(runtime, remove.commands, "remove-hover")),
    ).toMatchObject({ ok: true });
    const removedDocument = runtime.getSnapshot().document;
    expect(
      removedDocument.componentsById.button_hover?.variantSetId,
    ).toBeUndefined();
    expect(removedDocument.nodesById.button_instance).toMatchObject({
      properties: { componentId: "button_hover", componentProperties: {} },
    });
    expect(
      resolveComponentInstance(removedDocument, "button_instance"),
    ).toMatchObject({ ok: true, componentId: "button_hover" });

    const dissolve = planDissolveVariantSet(removedDocument, {
      pageId: "page",
      variantSetId: "button_set",
      commandPrefix: "dissolve-set",
    });
    expect(dissolve.ok).toBe(true);
    if (!dissolve.ok) return;
    expect(
      runtime.apply(transaction(runtime, dissolve.commands, "dissolve-set")),
    ).toMatchObject({ ok: true });
    const dissolved = runtime.getSnapshot().document;
    expect(dissolved.variantSetsById.button_set).toBeUndefined();
    expect(dissolved.nodesById.button_set_root).toBeUndefined();
    expect(
      dissolved.componentsById.button_default?.variantSetId,
    ).toBeUndefined();
    expect(
      resolveComponentInstance(dissolved, "button_instance"),
    ).toMatchObject({ ok: true, componentId: "button_hover" });
    expect(runtime.undo()).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set,
    ).toBeDefined();
  });

  it("authors and reorders a two-dimensional Variant property matrix", () => {
    const runtime = new EditorRuntime(variantFixture());
    const add = planAddVariantProperty(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "Size",
      valuesByComponentId: {
        button_default: "Small",
        button_hover: "Large",
      },
      index: 0,
      commandPrefix: "add-size",
    });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    expect(
      runtime.apply(transaction(runtime, add.commands, "add-size")),
    ).toMatchObject({ ok: true });
    let document = runtime.getSnapshot().document;
    expect(document.variantSetsById.button_set?.propertyOrder).toEqual([
      "Size",
      "State",
    ]);
    expect(document.nodesById.button_instance).toMatchObject({
      properties: {
        componentProperties: { State: "Hover", Size: "Large" },
      },
    });
    expect(resolveComponentInstance(document, "button_instance")).toMatchObject(
      { ok: true, componentId: "button_hover" },
    );

    const rename = planRenameVariantProperty(document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "Size",
      name: "Scale",
      commandPrefix: "rename-size",
    });
    expect(rename.ok).toBe(true);
    if (!rename.ok) return;
    expect(
      runtime.apply(transaction(runtime, rename.commands, "rename-size")),
    ).toMatchObject({ ok: true });
    document = runtime.getSnapshot().document;
    expect(document.variantSetsById.button_set?.propertyOrder).toEqual([
      "Scale",
      "State",
    ]);
    expect(document.nodesById.button_instance).toMatchObject({
      properties: { componentProperties: { State: "Hover", Scale: "Large" } },
    });

    const reorder = planReorderVariantProperties(document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyOrder: ["State", "Scale"],
      commandPrefix: "reorder-properties",
    });
    expect(reorder.ok).toBe(true);
    if (!reorder.ok) return;
    expect(
      runtime.apply(
        transaction(runtime, reorder.commands, "reorder-properties"),
      ),
    ).toMatchObject({
      ok: true,
      changes: {
        variantSetChanges: [
          expect.objectContaining({ changedFields: ["propertyOrder"] }),
        ],
      },
    });
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set?.propertyOrder,
    ).toEqual(["State", "Scale"]);
    expect(
      runtime.getSnapshot().document.componentsById.button_hover?.name,
    ).toBe("State=Hover, Scale=Large");
    expect(
      runtime.getSnapshot().document.nodesById.button_hover_root?.name,
    ).toBe("State=Hover, Scale=Large");
    expect(runtime.undo()).toMatchObject({ ok: true });
  });

  it("renames, reorders, and edits Variant values without changing the resolved member", () => {
    const runtime = new EditorRuntime(variantFixture());
    const rename = planRenameVariantValue(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "State",
      value: "Hover",
      name: "Hovered",
      commandPrefix: "rename-hover",
    });
    expect(rename.ok).toBe(true);
    if (!rename.ok) return;
    expect(
      runtime.apply(transaction(runtime, rename.commands, "rename-hover")),
    ).toMatchObject({ ok: true });
    let document = runtime.getSnapshot().document;
    expect(
      document.variantSetsById.button_set?.componentPropertyDefinitions.State
        ?.variantOptions,
    ).toEqual(["Default", "Hovered"]);
    expect(resolveComponentInstance(document, "button_instance")).toMatchObject(
      { ok: true, componentId: "button_hover" },
    );

    const reorder = planReorderVariantValues(document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "State",
      values: ["Hovered", "Default"],
      commandPrefix: "reorder-state",
    });
    expect(reorder.ok).toBe(true);
    if (!reorder.ok) return;
    expect(
      runtime.apply(transaction(runtime, reorder.commands, "reorder-state")),
    ).toMatchObject({ ok: true });
    document = runtime.getSnapshot().document;
    expect(
      document.variantSetsById.button_set?.componentPropertyDefinitions.State
        ?.variantOptions,
    ).toEqual(["Hovered", "Default"]);

    const edit = planSetVariantProperties(document, {
      pageId: "page",
      variantSetId: "button_set",
      componentId: "button_hover",
      variantProperties: { State: "Pressed" },
      commandPrefix: "edit-hover",
    });
    expect(edit.ok).toBe(true);
    if (!edit.ok) return;
    expect(
      runtime.apply(transaction(runtime, edit.commands, "edit-hover")),
    ).toMatchObject({ ok: true });
    document = runtime.getSnapshot().document;
    expect(document.componentsById.button_hover?.variantProperties).toEqual({
      State: "Pressed",
    });
    expect(document.nodesById.button_instance).toMatchObject({
      properties: { componentProperties: { State: "Pressed" } },
    });
    expect(resolveComponentInstance(document, "button_instance")).toMatchObject(
      { ok: true, componentId: "button_hover" },
    );
  });

  it("removes a Variant property and dissolves the Set when the last property is removed", () => {
    const runtime = new EditorRuntime(variantFixture());
    const add = planAddVariantProperty(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "Tone",
      valuesByComponentId: {
        button_default: "Neutral",
        button_hover: "Neutral",
      },
      commandPrefix: "add-tone",
    });
    expect(add.ok).toBe(true);
    if (!add.ok) return;
    runtime.apply(transaction(runtime, add.commands, "add-tone"));
    const conflicting = planRemoveVariantProperty(
      runtime.getSnapshot().document,
      {
        pageId: "page",
        variantSetId: "button_set",
        propertyName: "State",
        commandPrefix: "remove-state",
      },
    );
    expect(conflicting).toMatchObject({ ok: false, code: "duplicate" });
    const remove = planRemoveVariantProperty(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "Tone",
      commandPrefix: "remove-tone",
    });
    expect(remove.ok).toBe(true);
    if (!remove.ok) return;
    expect(
      runtime.apply(transaction(runtime, remove.commands, "remove-tone")),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set?.propertyOrder,
    ).toEqual(["State"]);

    const dissolve = planRemoveVariantProperty(runtime.getSnapshot().document, {
      pageId: "page",
      variantSetId: "button_set",
      propertyName: "State",
      commandPrefix: "remove-last-property",
    });
    expect(dissolve.ok).toBe(true);
    if (!dissolve.ok) return;
    expect(
      runtime.apply(
        transaction(runtime, dissolve.commands, "remove-last-property"),
      ),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.variantSetsById.button_set,
    ).toBeUndefined();
    expect(
      resolveComponentInstance(
        runtime.getSnapshot().document,
        "button_instance",
      ),
    ).toMatchObject({ ok: true, componentId: "button_hover" });
  });
});

function combinableVariantFixture(): DesignDocument {
  const document = variantFixture();
  delete document.nodesById.button_set_root;
  document.pagesById.page!.rootNodeIds = [
    "button_default_root",
    "button_hover_root",
    "button_instance",
  ];
  document.nodesById.button_default_root!.parentId = null;
  document.nodesById.button_default_root!.transform = [1, 0, 0, 1, 100, 60];
  document.nodesById.button_hover_root!.parentId = null;
  document.nodesById.button_hover_root!.transform = [1, 0, 0, 1, 300, 60];
  document.componentsById.button_default = {
    ...document.componentsById.button_default!,
    variantProperties: {},
  };
  delete document.componentsById.button_default.variantSetId;
  document.componentsById.button_hover = {
    ...document.componentsById.button_hover!,
    variantProperties: {},
  };
  delete document.componentsById.button_hover.variantSetId;
  const instance = document.nodesById.button_instance;
  if (instance?.kind === "instance") {
    instance.properties.componentProperties = {};
  }
  document.variantSetsById = {};
  return document;
}

function transaction(
  runtime: EditorRuntime,
  commands: DesignOperation[],
  transactionId = "combine-variants",
) {
  const document = runtime.getSnapshot().document;
  return {
    transactionId,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user" as const, id: "test" },
    label: "Combine as variants",
    commands,
  };
}

function variantFixture(): DesignDocument {
  const ordinaryPropertyName = "Show label#button:visible";
  const setRoot = frame("button_set_root", null, [
    "button_default_root",
    "button_hover_root",
  ]);
  const defaultRoot = frame(
    "button_default_root",
    setRoot.id,
    ["default_label"],
    0,
  );
  const hoverRoot = frame(
    "button_hover_root",
    setRoot.id,
    ["hover_label"],
    200,
  );
  const defaultLabel = text("default_label", defaultRoot.id, "Default");
  const hoverLabel = text("hover_label", hoverRoot.id, "Hover");
  defaultLabel.componentPropertyReferences = {
    visible: ordinaryPropertyName,
  };
  hoverLabel.componentPropertyReferences = {
    visible: ordinaryPropertyName,
  };
  return {
    format: "dev.opendesign.document",
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "variant_document",
    revision: 1,
    pageOrder: ["page"],
    pagesById: {
      page: {
        id: "page",
        name: "Components",
        rootNodeIds: [setRoot.id, "button_instance"],
        extensions: {},
      },
    },
    nodesById: {
      [setRoot.id]: setRoot,
      [defaultRoot.id]: defaultRoot,
      [hoverRoot.id]: hoverRoot,
      [defaultLabel.id]: defaultLabel,
      [hoverLabel.id]: hoverLabel,
      button_instance: {
        id: "button_instance",
        name: "Button",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 200],
        size: { width: 120, height: 44 },
        opacity: 1,
        kind: "instance",
        properties: {
          componentId: "button_default",
          componentProperties: { State: "Hover" },
          overrides: [],
        },
        extensions: {},
      },
    },
    componentsById: {
      button_default: {
        id: "button_default",
        name: "State=Default",
        rootNodeId: defaultRoot.id,
        componentPropertyOrder: [ordinaryPropertyName],
        componentPropertyDefinitions: {
          [ordinaryPropertyName]: { type: "BOOLEAN", defaultValue: true },
        },
        variantSetId: "button_set",
        variantProperties: { State: "Default" },
        extensions: {},
      },
      button_hover: {
        id: "button_hover",
        name: "State=Hover",
        rootNodeId: hoverRoot.id,
        componentPropertyOrder: [ordinaryPropertyName],
        componentPropertyDefinitions: {
          [ordinaryPropertyName]: { type: "BOOLEAN", defaultValue: true },
        },
        variantSetId: "button_set",
        variantProperties: { State: "Hover" },
        extensions: {},
      },
    },
    variantSetsById: {
      button_set: {
        id: "button_set",
        name: "Button",
        rootNodeId: setRoot.id,
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
      },
    },
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

function frame(
  id: string,
  parentId: string | null,
  childIds: string[],
  x = 0,
): FrameNode {
  return {
    id,
    name: id,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, 0],
    size: { width: id === "button_set_root" ? 320 : 120, height: 44 },
    opacity: 1,
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: false,
    },
    extensions: {},
  };
}

function text(id: string, parentId: string, content: string): TextNode {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 12],
    size: { width: 80, height: 20 },
    opacity: 1,
    kind: "text",
    properties: {
      content,
      fontFamily: "Inter",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      letterSpacing: 0,
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "none",
      textOverflow: "visible",
      fills: [],
      strokes: [],
      strokeWidth: 0,
    },
    extensions: {},
  };
}
