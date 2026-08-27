import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
  DESIGN_SYSTEM_TOOL_NAME,
  DesignComponentContract,
  DesignSystemContract,
  type DesignComponentToolInput,
} from "./design-agent-tools";

const validInputs: DesignComponentToolInput[] = [
  {
    action: "create-component",
    label: "Promote button Main",
    pageId: "page_ui",
    rootNodeId: "button_main",
    componentId: "component_button",
    name: "Button",
  },
  {
    action: "create-instance",
    label: "Place button Instance",
    pageId: "page_ui",
    componentId: "component_button",
    instanceId: "button_instance",
    parentId: "screen_frame",
    index: 2,
    x: 48,
    y: 320,
    name: "Primary action",
  },
  {
    action: "remove-component",
    label: "Remove button identity",
    pageId: "page_ui",
    componentId: "component_button",
  },
  {
    action: "combine-as-variants",
    label: "Combine button variants",
    pageId: "page_ui",
    componentIds: ["button_default", "button_hover"],
    componentRootNodeIds: ["button_default_root", "button_hover_root"],
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    name: "Button",
    variantPropertiesByComponentId: {
      button_default: { State: "Default" },
      button_hover: { State: "Hover" },
    },
  },
  {
    action: "add-component-to-variant-set",
    label: "Add pressed variant",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    componentId: "button_pressed",
    componentRootNodeId: "button_pressed_root",
    variantProperties: { State: "Pressed" },
  },
  {
    action: "duplicate-variant",
    label: "Duplicate pressed variant",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    sourceComponentId: "button_default",
    sourceRootNodeId: "button_default_root",
    componentId: "button_pressed",
    componentRootNodeId: "button_pressed_root",
    name: "Button / Pressed",
    variantProperties: { State: "Pressed" },
  },
  {
    action: "remove-variant",
    label: "Remove pressed variant",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    componentId: "button_pressed",
    componentRootNodeId: "button_pressed_root",
  },
  {
    action: "dissolve-variant-set",
    label: "Dissolve button set",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
  },
  {
    action: "add-variant-property",
    label: "Add button size",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyName: "Size",
    valuesByComponentId: {
      button_default: "Small",
      button_hover: "Large",
    },
    index: 1,
  },
  {
    action: "rename-variant-property",
    label: "Rename button state",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyName: "State",
    name: "Interaction",
  },
  {
    action: "reorder-variant-properties",
    label: "Reorder button properties",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyOrder: ["Size", "State"],
  },
  {
    action: "remove-variant-property",
    label: "Remove button size",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyName: "Size",
  },
  {
    action: "rename-variant-value",
    label: "Rename hover value",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyName: "State",
    value: "Hover",
    name: "Hovered",
  },
  {
    action: "reorder-variant-values",
    label: "Reorder button states",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    propertyName: "State",
    values: ["Default", "Hover", "Pressed"],
  },
  {
    action: "set-variant-properties",
    label: "Update hover combination",
    pageId: "page_ui",
    variantSetId: "button_set",
    rootNodeId: "button_set_root",
    componentId: "button_hover",
    componentRootNodeId: "button_hover_root",
    variantProperties: { State: "Hovered", Size: "Large" },
  },
  {
    action: "add-property",
    label: "Expose button icon",
    pageId: "page_ui",
    componentId: "component_button",
    propertyId: "button:icon",
    name: "Icon",
    type: "INSTANCE_SWAP",
    sourceNodeId: "button_icon",
    preferredValues: [{ type: "COMPONENT", key: "component_icon_arrow" }],
  },
  {
    action: "rename-property",
    label: "Rename button label property",
    pageId: "page_ui",
    componentId: "component_button",
    propertyName: "Label#button:text",
    name: "Text",
  },
  {
    action: "reorder-properties",
    label: "Reorder button properties",
    pageId: "page_ui",
    componentId: "component_button",
    componentRootNodeId: "button_main",
    componentPropertyOrder: ["Label#button:text", "Icon#button:icon"],
  },
  {
    action: "remove-property",
    label: "Remove button icon property",
    pageId: "page_ui",
    componentId: "component_button",
    propertyName: "Icon#button:icon",
  },
  {
    action: "set-property",
    label: "Set button label",
    pageId: "page_ui",
    instanceId: "button_instance",
    propertyName: "Label#button:text",
    value: "Continue",
  },
  {
    action: "reset-property",
    label: "Reset button label",
    pageId: "page_ui",
    instanceId: "button_instance",
    propertyName: "Label#button:text",
  },
  {
    action: "create-slot-override",
    label: "Create card slot override",
    pageId: "page_ui",
    instanceId: "card_instance",
    propertyName: "Content#card:slot",
  },
  {
    action: "clear-slot",
    label: "Clear card slot",
    pageId: "page_ui",
    instanceId: "card_instance",
    propertyName: "Content#card:slot",
  },
  {
    action: "reset-slot",
    label: "Reset card slot",
    pageId: "page_ui",
    instanceId: "card_instance",
    propertyName: "Content#card:slot",
  },
  {
    action: "set-slot-settings",
    label: "Configure card slot",
    pageId: "page_ui",
    componentId: "component_card",
    propertyName: "Content#card:slot",
    settings: {
      minChildren: 1,
      maxChildren: 6,
      stretchChildOnInsert: true,
      allowPreferredValuesOnly: true,
    },
    preferredValues: [{ type: "COMPONENT_SET", key: "list_item_set" }],
    description: "Insert one to six list items.",
  },
  {
    action: "set-override",
    label: "Override button label layer",
    pageId: "page_ui",
    instanceId: "button_instance",
    sourcePath: ["button_main", "button_label"],
    patch: { properties: { content: "Continue" }, opacity: 0.9 },
  },
  {
    action: "reset-overrides",
    label: "Reset button label overrides",
    pageId: "page_ui",
    instanceId: "button_instance",
    sourcePath: ["button_main", "button_label"],
  },
  {
    action: "detach-instance",
    label: "Detach button Instance",
    pageId: "page_ui",
    instanceId: "button_instance",
  },
  {
    action: "go-to-main",
    pageId: "page_ui",
    instanceId: "button_instance",
  },
];

describe("Component Agent contract", () => {
  it("uses one disclosed executable schema for all action branches", () => {
    expect(DesignComponentContract.schema).toBe(
      DESIGN_COMPONENT_TOOL_INPUT_SCHEMA,
    );
    expect(validInputs).toHaveLength(29);
    for (const input of validInputs) {
      expect(
        schemaValidationIssues(DesignComponentContract.schema, input),
      ).toHaveLength(0);
      expect(DesignComponentContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
  });

  it("returns action-specific missing and foreign field paths", () => {
    expect(
      DesignComponentContract.issues({
        action: "create-component",
        label: "Promote button",
        pageId: "page_ui",
        nodeId: "button_main",
        componentId: "component_button",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/rootNodeId" }),
        expect.objectContaining({ path: "/name" }),
        expect.objectContaining({ path: "/nodeId" }),
      ]),
    );
    expect(
      DesignComponentContract.issues({
        action: "go-to-main",
        label: "Foreign label",
        pageId: "page_ui",
        instanceId: "button_instance",
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/label" })]),
    );
  });

  it("keeps Provider override fields and Runtime fields identical", () => {
    expect(
      DesignComponentContract.issues({
        action: "set-override",
        label: "Lock derived label",
        pageId: "page_ui",
        instanceId: "button_instance",
        sourcePath: ["button_main", "button_label"],
        patch: { locked: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_component.schema_invalid",
          path: "/patch/locked",
        }),
      ]),
    );
  });

  it("refines Component Set member and Variant matrix correspondence once", () => {
    const combine = validInputs.find(
      (input) => input.action === "combine-as-variants",
    );
    if (!combine || combine.action !== "combine-as-variants") {
      throw new Error("Missing combine fixture");
    }
    expect(
      DesignComponentContract.issues({
        ...combine,
        componentRootNodeIds: [
          "button_default_root",
          "button_hover_root",
          "extra",
        ],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_component.component_root_count_mismatch",
          path: "/componentRootNodeIds",
        }),
      ]),
    );
    expect(
      DesignComponentContract.issues({
        ...combine,
        variantPropertiesByComponentId: {
          button_default: { State: "Default" },
          button_pressed: { State: "Pressed" },
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_component.variant_matrix_members_mismatch",
          path: "/variantPropertiesByComponentId",
        }),
      ]),
    );
  });

  it("refines preferred-value ownership and Slot child ranges once", () => {
    expect(
      DesignComponentContract.issues({
        action: "add-property",
        label: "Expose button label",
        pageId: "page_ui",
        componentId: "component_button",
        propertyId: "button:text",
        name: "Label",
        type: "TEXT",
        sourceNodeId: "button_label",
        preferredValues: [{ type: "COMPONENT", key: "component_secondary" }],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_component.preferred_values_not_supported",
        path: "/preferredValues",
      }),
    ]);
    expect(
      DesignComponentContract.issues({
        action: "set-slot-settings",
        label: "Set invalid card slot range",
        pageId: "page_ui",
        componentId: "component_card",
        propertyName: "Content#card:slot",
        settings: { minChildren: 8, maxChildren: 2 },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_component.slot_child_range_invalid",
        path: "/settings/maxChildren",
      }),
    ]);
  });

  it("composes the Component contract into the unified Provider contract", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_SYSTEM_TOOL_NAME,
    );
    expect(tool).not.toHaveProperty("explainInvalidInput");
    expect(tool).toHaveProperty(
      "validateInputIssues",
      DesignSystemContract.issues,
    );
    expect(
      DesignSystemContract.parse({ kind: "component", input: validInputs[0] }),
    ).toEqual({
      ok: true,
      value: { kind: "component", input: validInputs[0] },
    });
  });
});
