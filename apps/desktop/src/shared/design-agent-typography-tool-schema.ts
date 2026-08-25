import {
  executableJsonSchema,
  TextFontDescriptorSchema,
  UpdateTextRangeStyleCommandSchema,
} from "@opendesign/design-contracts";

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

const FONT_NODE_IDS_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 1_000,
  uniqueItems: true,
  items: ID_SCHEMA,
} as const;

const FONT_COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
  nodeIds: FONT_NODE_IDS_SCHEMA,
  expectedFont: TextFontDescriptorSchema,
} as const;

const FONT_ACTION_BRANCHES = [
  {
    type: "object",
    properties: {
      action: { const: "reflow" },
      ...FONT_COMMON_PROPERTIES,
    },
    required: ["action", "label", "pageId", "nodeIds", "expectedFont"],
    additionalProperties: false,
  },
  {
    type: "object",
    properties: {
      action: { const: "replace" },
      ...FONT_COMMON_PROPERTIES,
      replacementFont: TextFontDescriptorSchema,
    },
    required: [
      "action",
      "label",
      "pageId",
      "nodeIds",
      "expectedFont",
      "replacementFont",
    ],
    additionalProperties: false,
  },
] as const;

export const DESIGN_FONT_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Reflow or replace one exact inspected font face on 1..1000 unique Text node IDs in the active Page. reflow accepts expectedFont only; replace also requires replacementFont. A font face contains the exact family, exact style name or null for unresolved legacy input, integer weight 1..1000, and normal/italic slant. Current Page, revision, node kind, lock state, font availability, layout, preview, transaction, and undo are host-owned.",
  properties: {
    action: { enum: ["reflow", "replace"] },
    ...FONT_COMMON_PROPERTIES,
    replacementFont: TextFontDescriptorSchema,
  },
  required: ["action", "label", "pageId", "nodeIds", "expectedFont"],
  anyOf: FONT_ACTION_BRANCHES,
  additionalProperties: false,
});

export const DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Style one inspected non-empty UTF-16 [start,end) range on a stable Text node in the active Page. end must be greater than start. style must contain at least one field and uses the same authoritative typography, paragraph, Paint, Text Style, and Paint Style value schema as update_text_range_style. Current content boundaries, style references, revision, target scope, preview, transaction, and undo are host-owned.",
  properties: {
    label: LABEL_SCHEMA,
    pageId: ID_SCHEMA,
    nodeId: ID_SCHEMA,
    start: { type: "integer", minimum: 0 },
    end: { type: "integer", minimum: 1 },
    style: UpdateTextRangeStyleCommandSchema.properties.style,
  },
  required: ["label", "pageId", "nodeId", "start", "end", "style"],
  additionalProperties: false,
});
