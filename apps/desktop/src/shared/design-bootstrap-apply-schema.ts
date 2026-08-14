const BOOTSTRAP_TRANSFORM_SCHEMA = {
  type: "array",
  minItems: 6,
  maxItems: 6,
  items: { type: "number" },
  description: "Affine matrix [a,b,c,d,tx,ty].",
} as const;

const BOOTSTRAP_SIZE_SCHEMA = {
  type: "object",
  properties: {
    width: { type: "number", minimum: 0 },
    height: { type: "number", minimum: 0 },
  },
  required: ["width", "height"],
  additionalProperties: false,
} as const;

const BOOTSTRAP_SOLID_PAINT_SCHEMA = {
  type: "object",
  properties: {
    type: { const: "solid" },
    color: { type: "string", minLength: 1 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    visible: { type: "boolean" },
  },
  required: ["type", "color", "opacity"],
  additionalProperties: false,
} as const;

const BOOTSTRAP_SHAPE_PROPERTIES = {
  fills: {
    type: "array",
    maxItems: 8,
    items: BOOTSTRAP_SOLID_PAINT_SCHEMA,
  },
  strokes: {
    type: "array",
    maxItems: 8,
    items: BOOTSTRAP_SOLID_PAINT_SCHEMA,
  },
  strokeWidth: { type: "number", minimum: 0 },
  strokeAlign: { enum: ["inside", "center", "outside"] },
  strokeCap: { enum: ["none", "round", "square"] },
  strokeJoin: { enum: ["miter", "round", "bevel"] },
  dashPattern: { type: "array", items: { type: "number", minimum: 0 } },
} as const;

const BOOTSTRAP_NODE_PROPERTIES_SCHEMA = {
  type: "object",
  description:
    "Bootstrap properties for Frame, Group, Rectangle, Ellipse, or Text. Group uses {}. Shapes use solid fills/strokes. Frame adds cornerRadius/clipsContent. Text adds the complete basic typography fields.",
  properties: {
    ...BOOTSTRAP_SHAPE_PROPERTIES,
    cornerRadius: { type: "number", minimum: 0 },
    clipsContent: { type: "boolean" },
    content: { type: "string" },
    fontFamily: { type: "string", minLength: 1 },
    fontSize: { type: "number", exclusiveMinimum: 0 },
    fontWeight: { type: "integer", minimum: 1, maximum: 1_000 },
    lineHeight: { type: "number", exclusiveMinimum: 0 },
    letterSpacing: { type: "number" },
    paragraphIndent: { type: "number", minimum: 0 },
    paragraphSpacing: { type: "number", minimum: 0 },
    textCase: {
      enum: ["original", "uppercase", "lowercase", "title-case", "small-caps"],
    },
    textDecoration: { enum: ["none", "underline", "strikethrough"] },
    textAlignHorizontal: { enum: ["left", "center", "right", "justify"] },
    textAlignVertical: { enum: ["top", "center", "bottom"] },
    textResize: { enum: ["auto-width", "auto-height", "fixed"] },
    textWrap: { enum: ["none", "word", "character"] },
    textOverflow: { enum: ["visible", "clip"] },
    textTruncation: { enum: ["disabled", "ending"] },
    maxLines: {
      anyOf: [{ type: "integer", minimum: 1 }, { type: "null" }],
    },
  },
  additionalProperties: false,
} as const;

const BOOTSTRAP_NODE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    childIds: {
      type: "array",
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    visible: { type: "boolean" },
    locked: { type: "boolean" },
    transform: BOOTSTRAP_TRANSFORM_SCHEMA,
    size: BOOTSTRAP_SIZE_SCHEMA,
    opacity: { type: "number", minimum: 0, maximum: 1 },
    extensions: { type: "object" },
    kind: { enum: ["frame", "group", "rectangle", "ellipse", "text"] },
    properties: BOOTSTRAP_NODE_PROPERTIES_SCHEMA,
  },
  required: ["id", "name", "transform", "size", "kind", "properties"],
  additionalProperties: false,
} as const;

const BOOTSTRAP_OPERATION_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        commandId: { type: "string", minLength: 1, maxLength: 256 },
        type: { const: "insert_element" },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        parentId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 256 },
            { type: "null" },
          ],
        },
        index: { type: "integer", minimum: 0 },
        node: BOOTSTRAP_NODE_SCHEMA,
      },
      required: ["commandId", "type", "pageId", "parentId", "index", "node"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        commandId: { type: "string", minLength: 1, maxLength: 256 },
        type: { const: "update_properties" },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        visible: { type: "boolean" },
        locked: { type: "boolean" },
        transform: BOOTSTRAP_TRANSFORM_SCHEMA,
        size: BOOTSTRAP_SIZE_SCHEMA,
        opacity: { type: "number", minimum: 0, maximum: 1 },
        properties: BOOTSTRAP_NODE_PROPERTIES_SCHEMA,
      },
      required: ["commandId", "type", "nodeId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        commandId: { type: "string", minLength: 1, maxLength: 256 },
        type: { const: "move_element" },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        parentId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 256 },
            { type: "null" },
          ],
        },
        index: { type: "integer", minimum: 0 },
      },
      required: ["commandId", "type", "nodeId", "pageId", "parentId", "index"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        commandId: { type: "string", minLength: 1, maxLength: 256 },
        type: { const: "delete_element" },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["commandId", "type", "nodeId"],
      additionalProperties: false,
    },
  ],
} as const;

export const DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 256 },
    summary: { type: "string", maxLength: 2_000 },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      description:
        "Ordered real visual steps. commandIds cover every command exactly once and in order.",
      items: {
        type: "object",
        properties: {
          stepId: { type: "string", minLength: 1, maxLength: 256 },
          label: { type: "string", minLength: 1, maxLength: 256 },
          commandIds: {
            type: "array",
            minItems: 1,
            maxItems: 240,
            items: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
        required: ["stepId", "label", "commandIds"],
        additionalProperties: false,
      },
    },
    commands: {
      type: "array",
      minItems: 1,
      maxItems: 240,
      items: BOOTSTRAP_OPERATION_SCHEMA,
    },
  },
  required: ["label", "commands"],
  additionalProperties: false,
} as const;
