const VARIABLE_VALUE_SCHEMA = {
  oneOf: [
    { type: "boolean" },
    { type: "string", maxLength: 100000 },
    { type: "number" },
    {
      type: "object",
      properties: {
        type: { const: "VARIABLE_ALIAS" },
        id: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["type", "id"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        r: { type: "number", minimum: 0, maximum: 1 },
        g: { type: "number", minimum: 0, maximum: 1 },
        b: { type: "number", minimum: 0, maximum: 1 },
        a: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["r", "g", "b"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        type: {
          enum: [
            "EASE_IN",
            "EASE_OUT",
            "EASE_IN_AND_OUT",
            "LINEAR",
            "EASE_IN_BACK",
            "EASE_OUT_BACK",
            "EASE_IN_AND_OUT_BACK",
            "GENTLE",
            "QUICK",
            "BOUNCY",
            "SLOW",
            "HOLD",
          ],
        },
      },
      required: ["type"],
      additionalProperties: false,
    },
  ],
} as const;

export const DESIGN_VARIABLE_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Manage Figma-compatible Variable Collections, modes, six typed Variable values, same-type aliases, picker scopes, code syntax, node/Paint bindings, and Page/node mode overrides through the trusted Variable Service. Use only stable IDs and current definitions returned by inspection. Scopes rank picker suggestions but do not authorize or invalidate explicit bindings. FLOAT opacity values use 0..1 and COLOR uses RGB/RGBA 0..1 channels. Timing and Easing can be authored but cannot bind until Motion is available.",
  properties: {
    action: {
      enum: [
        "create-collection",
        "rename-collection",
        "delete-collection",
        "add-mode",
        "rename-mode",
        "remove-mode",
        "create-variable",
        "set-value",
        "update-variable",
        "delete-variable",
        "set-binding",
        "set-mode",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    collectionId: { type: "string", minLength: 1, maxLength: 256 },
    key: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 512 },
    defaultModeId: { type: "string", minLength: 1, maxLength: 256 },
    defaultModeName: { type: "string", minLength: 1, maxLength: 256 },
    modeId: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    replacementModeId: { type: "string", minLength: 1, maxLength: 256 },
    variableId: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    resolvedType: {
      enum: ["BOOLEAN", "COLOR", "EASING", "FLOAT", "STRING", "TIMING"],
    },
    value: VARIABLE_VALUE_SCHEMA,
    valuesByMode: {
      type: "object",
      maxProperties: 128,
      additionalProperties: VARIABLE_VALUE_SCHEMA,
    },
    valuesByVariableId: {
      type: "object",
      maxProperties: 5000,
      additionalProperties: VARIABLE_VALUE_SCHEMA,
    },
    scopes: {
      type: "array",
      maxItems: 32,
      uniqueItems: true,
      items: {
        enum: [
          "ALL_SCOPES",
          "TEXT_CONTENT",
          "CORNER_RADIUS",
          "WIDTH_HEIGHT",
          "GAP",
          "ALL_FILLS",
          "FRAME_FILL",
          "SHAPE_FILL",
          "TEXT_FILL",
          "STROKE_COLOR",
          "STROKE_FLOAT",
          "EFFECT_FLOAT",
          "EFFECT_COLOR",
          "OPACITY",
          "FONT_FAMILY",
          "FONT_STYLE",
          "FONT_WEIGHT",
          "FONT_SIZE",
          "LINE_HEIGHT",
          "LETTER_SPACING",
          "PARAGRAPH_SPACING",
          "PARAGRAPH_INDENT",
        ],
      },
    },
    description: { type: "string", maxLength: 2000 },
    hiddenFromPublishing: { type: "boolean" },
    codeSyntax: {
      type: "object",
      properties: {
        WEB: { type: "string", maxLength: 512 },
        ANDROID: { type: "string", maxLength: 512 },
        iOS: { type: "string", maxLength: 512 },
      },
      additionalProperties: false,
    },
    target: {
      type: "object",
      properties: {
        kind: { enum: ["page", "node", "paint"] },
        id: { type: "string", minLength: 1, maxLength: 256 },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        field: { enum: ["visible", "opacity", "characters", "color"] },
        paintField: { enum: ["fills", "strokes"] },
        paintIndex: { type: "integer", minimum: 0, maximum: 4095 },
      },
    },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const;
