import {
  AutoLayoutSchema,
  executableJsonSchema,
  GridChildPlacementSchema,
  LayoutConstraintsSchema,
  LayoutGuideSchema,
  LayoutLimitsSchema,
  LayoutSizingSchema,
} from "@opendesign/design-contracts";

export const DESIGN_ARRANGE_ACTIONS = [
  "align-left",
  "align-horizontal-center",
  "align-right",
  "align-top",
  "align-vertical-center",
  "align-bottom",
  "distribute-horizontal",
  "distribute-vertical",
  "tidy-up",
  "flip-horizontal",
  "flip-vertical",
  "set-horizontal-spacing",
  "set-vertical-spacing",
  "set-constraints",
  "repair-overflow",
  "resize-frame",
  "set-auto-layout",
  "set-layout-sizing",
  "set-layout-positioning",
  "set-layout-limits",
  "set-layout-guides",
  "set-grid-placement",
  "reorder-grid-tracks",
] as const;

const ALIGN_ACTIONS = [
  "align-left",
  "align-horizontal-center",
  "align-right",
  "align-top",
  "align-vertical-center",
  "align-bottom",
] as const;

const DISTRIBUTION_ACTIONS = [
  "distribute-horizontal",
  "distribute-vertical",
  "tidy-up",
] as const;

const SPACING_ACTIONS = [
  "set-horizontal-spacing",
  "set-vertical-spacing",
] as const;

const FLIP_ACTIONS = ["flip-horizontal", "flip-vertical"] as const;

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

function nodeIdsSchema(minItems: number) {
  return {
    type: "array" as const,
    minItems,
    maxItems: 500,
    uniqueItems: true,
    items: ID_SCHEMA,
  };
}

const SPACING_SCHEMA = {
  type: "number",
  minimum: -1_000_000,
  maximum: 1_000_000,
} as const;

const FRAME_SIZE_SCHEMA = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: 1_000_000,
} as const;

const FROM_INDICES_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 4_096,
  items: { type: "integer", minimum: 0, maximum: 4_095 },
} as const;

const LAYOUT_GUIDES_SCHEMA = {
  type: "array",
  maxItems: 8,
  items: LayoutGuideSchema,
} as const;

const ARRANGE_COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
} as const;

function arrangeBranch<
  const TAction extends (typeof DESIGN_ARRANGE_ACTIONS)[number],
  const TProperties extends Record<string, unknown>,
>(
  action: TAction,
  properties: TProperties,
  required: readonly (keyof TProperties & string)[],
) {
  return {
    type: "object" as const,
    properties: {
      action: { const: action },
      ...ARRANGE_COMMON_PROPERTIES,
      ...properties,
    },
    required: ["action", "label", "pageId", ...required],
    additionalProperties: false,
  };
}

const ARRANGE_ACTION_BRANCHES = [
  ...ALIGN_ACTIONS.map((action) =>
    arrangeBranch(action, { nodeIds: nodeIdsSchema(1) }, ["nodeIds"]),
  ),
  ...DISTRIBUTION_ACTIONS.map((action) =>
    arrangeBranch(action, { nodeIds: nodeIdsSchema(3) }, ["nodeIds"]),
  ),
  ...FLIP_ACTIONS.map((action) =>
    arrangeBranch(action, { nodeIds: nodeIdsSchema(1) }, ["nodeIds"]),
  ),
  ...SPACING_ACTIONS.map((action) =>
    arrangeBranch(
      action,
      { nodeIds: nodeIdsSchema(2), spacing: SPACING_SCHEMA },
      ["nodeIds", "spacing"],
    ),
  ),
  arrangeBranch(
    "set-constraints",
    { nodeId: ID_SCHEMA, constraints: LayoutConstraintsSchema },
    ["nodeId", "constraints"],
  ),
  arrangeBranch("repair-overflow", { frameId: ID_SCHEMA }, ["frameId"]),
  arrangeBranch(
    "resize-frame",
    {
      frameId: ID_SCHEMA,
      width: FRAME_SIZE_SCHEMA,
      height: FRAME_SIZE_SCHEMA,
    },
    ["frameId", "width", "height"],
  ),
  arrangeBranch(
    "set-auto-layout",
    { frameId: ID_SCHEMA, autoLayout: AutoLayoutSchema },
    ["frameId", "autoLayout"],
  ),
  arrangeBranch(
    "set-layout-sizing",
    { nodeId: ID_SCHEMA, sizing: LayoutSizingSchema },
    ["nodeId", "sizing"],
  ),
  arrangeBranch(
    "set-layout-positioning",
    { nodeId: ID_SCHEMA, positioning: { const: "flow" } },
    ["nodeId", "positioning"],
  ),
  arrangeBranch(
    "set-layout-positioning",
    {
      nodeId: ID_SCHEMA,
      positioning: { const: "absolute" },
      constraints: LayoutConstraintsSchema,
    },
    ["nodeId", "positioning"],
  ),
  arrangeBranch(
    "set-layout-limits",
    {
      nodeId: ID_SCHEMA,
      limits: { anyOf: [LayoutLimitsSchema, { type: "null" }] },
    },
    ["nodeId", "limits"],
  ),
  arrangeBranch(
    "set-layout-guides",
    { frameId: ID_SCHEMA, layoutGuides: LAYOUT_GUIDES_SCHEMA },
    ["frameId", "layoutGuides"],
  ),
  arrangeBranch(
    "set-grid-placement",
    { nodeId: ID_SCHEMA, placement: GridChildPlacementSchema },
    ["nodeId", "placement"],
  ),
  arrangeBranch(
    "reorder-grid-tracks",
    {
      frameId: ID_SCHEMA,
      axis: { enum: ["rows", "columns"] },
      fromIndices: FROM_INDICES_SCHEMA,
      insertionIndex: { type: "integer", minimum: 0, maximum: 4_096 },
    },
    ["frameId", "axis", "fromIndices", "insertionIndex"],
  ),
] as const;

const CONTINUATION_ARRANGE_ACTIONS = [
  ...ALIGN_ACTIONS,
  ...DISTRIBUTION_ACTIONS,
  ...SPACING_ACTIONS,
  ...FLIP_ACTIONS,
  "repair-overflow",
  "resize-frame",
] as const;

const ARRANGE_TOOL_PROPERTIES = {
  action: { enum: DESIGN_ARRANGE_ACTIONS },
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
  nodeIds: nodeIdsSchema(1),
  spacing: SPACING_SCHEMA,
  nodeId: ID_SCHEMA,
  constraints: LayoutConstraintsSchema,
  positioning: { enum: ["flow", "absolute"] },
  frameId: ID_SCHEMA,
  width: FRAME_SIZE_SCHEMA,
  height: FRAME_SIZE_SCHEMA,
  axis: { enum: ["rows", "columns"] },
  fromIndices: FROM_INDICES_SCHEMA,
  insertionIndex: { type: "integer", minimum: 0, maximum: 4_096 },
  autoLayout: AutoLayoutSchema,
  placement: GridChildPlacementSchema,
  sizing: LayoutSizingSchema,
  limits: { anyOf: [LayoutLimitsSchema, { type: "null" }] },
  layoutGuides: LAYOUT_GUIDES_SCHEMA,
} as const;

const ARRANGE_CONTINUATION_ACTION_BRANCHES = ARRANGE_ACTION_BRANCHES.filter(
  (branch) =>
    CONTINUATION_ARRANGE_ACTIONS.includes(
      branch.properties.action
        .const as (typeof CONTINUATION_ARRANGE_ACTIONS)[number],
    ),
);

const ARRANGE_CONTINUATION_TOOL_PROPERTIES = {
  action: { enum: CONTINUATION_ARRANGE_ACTIONS },
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
  nodeIds: nodeIdsSchema(1),
  spacing: SPACING_SCHEMA,
  frameId: ID_SCHEMA,
  width: FRAME_SIZE_SCHEMA,
  height: FRAME_SIZE_SCHEMA,
} as const;

export const DESIGN_ARRANGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Arrange or transform explicit inspected layers with one closed action shape. Align accepts one or more unique layer IDs: one direct child aligns to its explicit Frame or Slot parent, while multiple layers align to their selection bounds. Flip mirrors persistent layers with the same matrix semantics as the editor, without changing hierarchy or component links. Distribute and tidy-up need at least three. Spacing may be negative, zero, or positive. Constraints, Frame resize, linear/wrapped Auto Layout, Auto Layout Grid, child sizing/positioning/limits, Grid placement/track reorder, Layout Guides, and bounded overflow repair use the same Figma-shaped document fields as the Runtime. Grid autoTracks is valid only for row-auto-flow. Layout Guide IDs must be unique. The host owns current Page/revision checks, geometry, preview, transaction, and undo.",
  properties: ARRANGE_TOOL_PROPERTIES,
  required: ["action", "label", "pageId"],
  anyOf: ARRANGE_ACTION_BRANCHES,
  additionalProperties: false,
});

export const DESIGN_ARRANGE_CONTINUATION_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Repair and visually align explicit inspected layers inside the current design. Use align, distribute, spacing, repair-overflow, or resize-frame; the host owns geometry, preview, revision, and undo.",
  properties: ARRANGE_CONTINUATION_TOOL_PROPERTIES,
  required: ["action", "label", "pageId"],
  anyOf: ARRANGE_CONTINUATION_ACTION_BRANCHES,
  additionalProperties: false,
});
