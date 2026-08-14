import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { exportSvg } from "@opendesign/import-export-service";
import { createEmptyDesignDocument } from "./document.js";
import {
  planAddComponentProperty,
  planRemoveComponentProperty,
  planSetComponentPropertyValue,
} from "./component-property-operations.js";
import {
  planClearComponentSlot,
  planCreateComponentSlotOverride,
  planResetComponentSlot,
  planSetComponentSlotSettings,
} from "./component-slot-operations.js";
import { EditorRuntime } from "./runtime.js";
import {
  planDetachComponentInstance,
  planRemoveComponent,
} from "./component-operations.js";
import { planSvgExportRequest } from "./svg-export-operations.js";
import { planCombineComponentsAsVariants } from "./variant-set-operations.js";
import { planDuplicateVariant } from "./variant-set-membership-operations.js";

describe("Component Slot lifecycle", () => {
  it("converts a Frame to a Slot and preserves default and overridden contents", () => {
    const runtime = new EditorRuntime(slotFixture());
    const added = planAddComponentProperty(runtime.getSnapshot().document, {
      componentId: "card_component",
      propertyId: "card:content",
      name: "Content",
      type: "SLOT",
      sourceNodeId: "card_content",
      slotSettings: { minChildren: 1, maxChildren: 3 },
      commandPrefix: "add_slot",
    });
    expect(added.ok).toBe(true);
    apply(runtime, added.ok ? added.commands : [], "add-slot");

    const withSlot = runtime.getSnapshot().document;
    expect(withSlot.nodesById.card_content).toMatchObject({
      kind: "slot",
      properties: { sourceSlotId: null },
    });
    expect(
      withSlot.componentsById.card_component?.componentPropertyDefinitions[
        "Content#card:content"
      ],
    ).toMatchObject({
      type: "SLOT",
      defaultValue: "card_content",
      slotSettings: { minChildren: 1, maxChildren: 3 },
    });
    const defaultResolution = resolveComponentInstance(
      withSlot,
      "card_instance",
    );
    expect(defaultResolution.ok).toBe(true);
    expect(defaultResolution.ok && defaultResolution.slots[0]).toMatchObject({
      childCount: 1,
      overridden: false,
      propertyName: "Content#card:content",
      limitViolations: [],
    });

    const override = planCreateComponentSlotOverride(withSlot, {
      instanceId: "card_instance",
      propertyName: "Content#card:content",
      commandPrefix: "override_slot",
    });
    expect(override.ok).toBe(true);
    apply(runtime, override.ok ? override.commands : [], "override-slot");
    const overridden = runtime.getSnapshot().document;
    const instance = overridden.nodesById.card_instance;
    expect(instance?.kind).toBe("instance");
    const overrideRoot =
      instance?.kind === "instance"
        ? overridden.nodesById[instance.childIds[0]!]
        : undefined;
    expect(overrideRoot).toMatchObject({
      kind: "slot",
      parentId: "card_instance",
      properties: { sourceSlotId: "card_content" },
    });
    expect(overrideRoot?.childIds).toHaveLength(1);
    expect(overrideRoot?.childIds[0]).not.toBe("card_body");
    const overriddenResolution = resolveComponentInstance(
      overridden,
      "card_instance",
    );
    expect(overriddenResolution.ok).toBe(true);
    expect(
      overriddenResolution.ok && overriddenResolution.slots[0],
    ).toMatchObject({ childCount: 1, overridden: true });
    const overrideChildId = overrideRoot?.childIds[0];
    if (!overrideChildId) throw new Error("Missing Slot override child");
    apply(
      runtime,
      [
        {
          commandId: "repaint_slot_content",
          type: "update_properties",
          nodeId: overrideChildId,
          properties: {
            fills: [{ type: "solid", color: "#ff00aa", opacity: 1 }],
          },
        },
      ],
      "repaint-slot-content",
    );
    const exportDocument = runtime.getSnapshot().document;
    const exportPlan = planSvgExportRequest(exportDocument, {
      pageId: "main",
      rootNodeIds: ["card_instance"],
      baseRevision: exportDocument.revision,
    });
    expect(exportPlan.ok).toBe(true);
    const exported = exportPlan.ok ? exportSvg(exportPlan.request) : null;
    expect(exported, JSON.stringify(exported)).toMatchObject({ ok: true });
    expect(exported?.ok && exported.svg).toContain("#ff00aa");

    const cleared = planClearComponentSlot(runtime.getSnapshot().document, {
      instanceId: "card_instance",
      propertyName: "Content#card:content",
      commandPrefix: "clear_slot",
    });
    expect(cleared.ok).toBe(true);
    apply(runtime, cleared.ok ? cleared.commands : [], "clear-slot");
    const clearedResolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "card_instance",
    );
    expect(clearedResolution.ok && clearedResolution.slots[0]).toMatchObject({
      childCount: 0,
      limitViolations: ["BELOW_MIN"],
      overridden: true,
    });

    const reset = planResetComponentSlot(runtime.getSnapshot().document, {
      instanceId: "card_instance",
      propertyName: "Content#card:content",
      commandPrefix: "reset_slot",
    });
    expect(reset.ok).toBe(true);
    apply(runtime, reset.ok ? reset.commands : [], "reset-slot");
    const resetResolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "card_instance",
    );
    expect(resetResolution.ok && resetResolution.slots[0]).toMatchObject({
      childCount: 1,
      limitViolations: [],
      overridden: false,
    });
  });

  it("updates guidance and removes source and instance Slot state atomically", () => {
    const runtime = new EditorRuntime(slotFixture());
    const added = planAddComponentProperty(runtime.getSnapshot().document, {
      componentId: "card_component",
      propertyId: "card:content",
      name: "Content",
      type: "SLOT",
      sourceNodeId: "card_content",
      commandPrefix: "add_slot",
    });
    apply(runtime, added.ok ? added.commands : [], "add-slot");
    const settings = planSetComponentSlotSettings(
      runtime.getSnapshot().document,
      {
        componentId: "card_component",
        propertyName: "Content#card:content",
        settings: {
          allowPreferredValuesOnly: true,
          displayEmptyByDefault: true,
          minChildren: 2,
          maxChildren: 4,
          stretchChildOnInsert: true,
        },
        preferredValues: [{ type: "COMPONENT", key: "row_component" }],
        description: "Use approved rows",
        commandPrefix: "settings",
      },
    );
    expect(settings.ok).toBe(true);
    apply(runtime, settings.ok ? settings.commands : [], "slot-settings");
    const resolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "card_instance",
    );
    expect(resolution.ok && resolution.slots[0]).toMatchObject({
      limitViolations: ["BELOW_MIN", "HAS_NON_PREFERRED"],
      settings: {
        allowPreferredValuesOnly: true,
        displayEmptyByDefault: true,
        stretchChildOnInsert: true,
      },
    });

    const override = planCreateComponentSlotOverride(
      runtime.getSnapshot().document,
      {
        instanceId: "card_instance",
        propertyName: "Content#card:content",
        commandPrefix: "override",
      },
    );
    apply(runtime, override.ok ? override.commands : [], "override");
    const removed = planRemoveComponentProperty(
      runtime.getSnapshot().document,
      {
        componentId: "card_component",
        propertyName: "Content#card:content",
        commandPrefix: "remove",
      },
    );
    expect(removed.ok).toBe(true);
    apply(runtime, removed.ok ? removed.commands : [], "remove-slot");
    const document = runtime.getSnapshot().document;
    expect(document.nodesById.card_content?.kind).toBe("frame");
    expect(document.nodesById.card_instance?.childIds).toEqual([]);
    expect(
      document.componentsById.card_component?.componentPropertyDefinitions,
    ).toEqual({});
    runtime.undo();
    expect(runtime.getSnapshot().document.nodesById.card_content?.kind).toBe(
      "slot",
    );
  });

  it("stretches inserted flow children through the Runtime insert boundary", () => {
    const source = slotFixture();
    const content = source.nodesById.card_content;
    if (content?.kind !== "frame") throw new Error("Missing content Frame");
    content.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 8, right: 12, bottom: 8, left: 12 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(source);
    const added = planAddComponentProperty(runtime.getSnapshot().document, {
      componentId: "card_component",
      propertyId: "card:content",
      name: "Content",
      type: "SLOT",
      sourceNodeId: "card_content",
      slotSettings: { stretchChildOnInsert: true },
      commandPrefix: "add_slot",
    });
    apply(runtime, added.ok ? added.commands : [], "add-slot");
    const inserted = rectangle("card_inserted", "card_content");
    apply(
      runtime,
      [
        {
          commandId: "insert_slot_child",
          type: "insert_element",
          pageId: "main",
          parentId: "card_content",
          index: 1,
          node: inserted,
        },
      ],
      "insert-slot-child",
    );
    expect(
      runtime.getSnapshot().document.nodesById.card_inserted,
    ).toMatchObject({
      layoutSizing: { horizontal: "fill", vertical: "fixed" },
      size: { width: 216 },
    });
  });

  it("preserves Slot override contents when switching Variants", () => {
    const source = slotFixture();
    addAlternateCard(source);
    const runtime = new EditorRuntime(source);
    for (const [componentId, sourceNodeId] of [
      ["card_component", "card_content"],
      ["card_alt_component", "card_alt_content"],
    ] as const) {
      const added = planAddComponentProperty(runtime.getSnapshot().document, {
        componentId,
        propertyId: "card:content",
        name: "Content",
        type: "SLOT",
        sourceNodeId,
        commandPrefix: `slot_${componentId}`,
      });
      apply(runtime, added.ok ? added.commands : [], `slot-${componentId}`);
    }
    const combined = planCombineComponentsAsVariants(
      runtime.getSnapshot().document,
      {
        pageId: "main",
        componentIds: ["card_component", "card_alt_component"],
        variantSetId: "card_set",
        rootNodeId: "card_set_root",
        name: "Card",
        variantPropertiesByComponentId: {
          card_component: { State: "Default" },
          card_alt_component: { State: "Alternate" },
        },
        commandPrefix: "combine_cards",
      },
    );
    expect(combined.ok).toBe(true);
    apply(runtime, combined.ok ? combined.commands : [], "combine-cards");
    const duplicated = planDuplicateVariant(runtime.getSnapshot().document, {
      pageId: "main",
      variantSetId: "card_set",
      sourceComponentId: "card_component",
      componentId: "card_third_component",
      rootNodeId: "card_third_main",
      variantProperties: { State: "Third" },
      commandPrefix: "duplicate_card",
    });
    expect(duplicated.ok).toBe(true);
    apply(runtime, duplicated.ok ? duplicated.commands : [], "duplicate-card");
    const duplicateDefinition =
      runtime.getSnapshot().document.componentsById.card_third_component
        ?.componentPropertyDefinitions["Content#card:content"];
    expect(duplicateDefinition?.type).toBe("SLOT");
    const duplicateSlotId =
      duplicateDefinition?.type === "SLOT"
        ? duplicateDefinition.defaultValue
        : "";
    expect(duplicateSlotId).not.toBe("card_content");
    expect(
      runtime.getSnapshot().document.nodesById[duplicateSlotId]?.kind,
    ).toBe("slot");
    const override = planCreateComponentSlotOverride(
      runtime.getSnapshot().document,
      {
        instanceId: "card_instance",
        propertyName: "Content#card:content",
        commandPrefix: "override_before_switch",
      },
    );
    apply(
      runtime,
      override.ok ? override.commands : [],
      "override-before-switch",
    );
    const beforeSwitch = runtime.getSnapshot().document;
    const instance = beforeSwitch.nodesById.card_instance;
    const overrideId = instance?.childIds[0];
    const overrideChildIds = overrideId
      ? [...(beforeSwitch.nodesById[overrideId]?.childIds ?? [])]
      : [];
    const switched = planSetComponentPropertyValue(beforeSwitch, {
      instanceId: "card_instance",
      propertyName: "State",
      value: "Alternate",
      commandPrefix: "switch_variant",
    });
    expect(switched.ok).toBe(true);
    apply(runtime, switched.ok ? switched.commands : [], "switch-variant");
    const afterSwitch = runtime.getSnapshot().document;
    expect(
      overrideId && afterSwitch.nodesById[overrideId]?.kind === "slot"
        ? afterSwitch.nodesById[overrideId].properties.sourceSlotId
        : null,
    ).toBe("card_alt_content");
    expect(overrideId && afterSwitch.nodesById[overrideId]?.childIds).toEqual(
      overrideChildIds,
    );
    const resolution = resolveComponentInstance(afterSwitch, "card_instance");
    expect(resolution.ok && resolution.componentId).toBe("card_alt_component");
    expect(resolution.ok && resolution.slots[0]?.overridden).toBe(true);
  });

  it("materializes Slots as ordinary Frames on detach and component removal", () => {
    const runtime = new EditorRuntime(slotFixture());
    const added = planAddComponentProperty(runtime.getSnapshot().document, {
      componentId: "card_component",
      propertyId: "card:content",
      name: "Content",
      type: "SLOT",
      sourceNodeId: "card_content",
      commandPrefix: "add_slot",
    });
    apply(runtime, added.ok ? added.commands : [], "add-slot");
    const override = planCreateComponentSlotOverride(
      runtime.getSnapshot().document,
      {
        instanceId: "card_instance",
        propertyName: "Content#card:content",
        commandPrefix: "override_slot",
      },
    );
    apply(runtime, override.ok ? override.commands : [], "override-slot");
    const detached = planDetachComponentInstance(
      runtime.getSnapshot().document,
      { instanceId: "card_instance", commandPrefix: "detach" },
    );
    expect(detached.ok).toBe(true);
    apply(runtime, detached.ok ? detached.commands : [], "detach");
    const detachedDocument = runtime.getSnapshot().document;
    expect(detachedDocument.nodesById.card_instance?.kind).toBe("frame");
    const detachedIds = collectSubtreeIds(detachedDocument, "card_instance");
    expect(
      detachedIds.some(
        (nodeId) => detachedDocument.nodesById[nodeId]?.kind === "slot",
      ),
    ).toBe(false);

    const removalRuntime = new EditorRuntime(slotFixture());
    const removalAdded = planAddComponentProperty(
      removalRuntime.getSnapshot().document,
      {
        componentId: "card_component",
        propertyId: "card:content",
        name: "Content",
        type: "SLOT",
        sourceNodeId: "card_content",
        commandPrefix: "add_slot",
      },
    );
    apply(
      removalRuntime,
      removalAdded.ok ? removalAdded.commands : [],
      "add-slot",
    );
    apply(
      removalRuntime,
      [
        {
          commandId: "delete_instance",
          type: "delete_element",
          nodeId: "card_instance",
        },
      ],
      "delete-instance",
    );
    const removed = planRemoveComponent(removalRuntime.getSnapshot().document, {
      componentId: "card_component",
      commandPrefix: "remove_component",
    });
    expect(removed.ok).toBe(true);
    apply(
      removalRuntime,
      removed.ok ? removed.commands : [],
      "remove-component",
    );
    expect(
      removalRuntime.getSnapshot().document.nodesById.card_content?.kind,
    ).toBe("frame");
  });
});

function apply(
  runtime: EditorRuntime,
  commands: DesignOperation[],
  transactionId: string,
): void {
  const snapshot = runtime.getSnapshot();
  const result = runtime.apply({
    transactionId,
    documentId: snapshot.document.documentId,
    baseRevision: snapshot.document.revision,
    actor: { type: "user", id: "slot-test" },
    label: transactionId,
    commands,
  });
  expect(result.ok, JSON.stringify(result)).toBe(true);
}

function slotFixture(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("slot_document", "main"),
  );
  document.pagesById.main!.rootNodeIds = [
    "card_main",
    "row_main",
    "card_instance",
  ];
  document.nodesById.card_main = frame("card_main", null, ["card_content"]);
  document.nodesById.card_content = frame("card_content", "card_main", [
    "card_body",
  ]);
  document.nodesById.card_body = rectangle("card_body", "card_content");
  document.nodesById.row_main = frame("row_main", null, ["row_body"]);
  document.nodesById.row_body = rectangle("row_body", "row_main");
  document.nodesById.card_instance = {
    id: "card_instance",
    name: "Card instance",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 300, 0],
    size: { width: 240, height: 160 },
    opacity: 1,
    extensions: {},
    kind: "instance",
    properties: {
      componentId: "card_component",
      componentProperties: {},
      overrides: [],
    },
  };
  document.componentsById.card_component = component(
    "card_component",
    "card_main",
  );
  document.componentsById.row_component = component(
    "row_component",
    "row_main",
  );
  return document;
}

function addAlternateCard(document: DesignDocument): void {
  document.pagesById.main!.rootNodeIds.splice(1, 0, "card_alt_main");
  document.nodesById.card_alt_main = frame("card_alt_main", null, [
    "card_alt_content",
  ]);
  document.nodesById.card_alt_main.transform = [1, 0, 0, 1, 280, 0];
  document.nodesById.card_alt_content = frame(
    "card_alt_content",
    "card_alt_main",
    ["card_alt_body"],
  );
  document.nodesById.card_alt_body = rectangle(
    "card_alt_body",
    "card_alt_content",
  );
  document.componentsById.card_alt_component = component(
    "card_alt_component",
    "card_alt_main",
  );
}

function collectSubtreeIds(document: DesignDocument, rootId: string): string[] {
  const result: string[] = [];
  const visit = (nodeId: string) => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.push(nodeId);
    node.childIds.forEach(visit);
  };
  visit(rootId);
  return result;
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
    size: { width: 240, height: 160 },
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
    transform: [1, 0, 0, 1, 12, 12],
    size: { width: 216, height: 48 },
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 4,
    },
  };
}
