import { executableJsonSchema } from "@opendesign/design-contracts";
import { DESIGN_IMAGE_PLACEMENT_SCHEMA } from "./design-agent-image-tools";

const MODEL_BLEND_MODES = [
  "pass-through",
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;

const MODEL_POINT_SCHEMA = {
  type: "object",
  properties: { x: { type: "number" }, y: { type: "number" } },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const MODEL_NORMALIZED_POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const MODEL_SIZE_SCHEMA = {
  type: "object",
  properties: {
    width: { type: "number", minimum: 0 },
    height: { type: "number", minimum: 0 },
  },
  required: ["width", "height"],
  additionalProperties: false,
} as const;

const MODEL_TRANSFORM_SCHEMA = {
  type: "array",
  minItems: 6,
  maxItems: 6,
  items: { type: "number" },
  description: "Affine matrix [a,b,c,d,tx,ty].",
} as const;

const MODEL_PAINT_BASE_PROPERTIES = {
  opacity: { type: "number", minimum: 0, maximum: 1 },
  visible: { type: "boolean" },
  blendMode: { enum: MODEL_BLEND_MODES },
} as const;

const MODEL_GRADIENT_PROPERTIES = {
  ...MODEL_PAINT_BASE_PROPERTIES,
  stops: {
    type: "array",
    minItems: 2,
    items: {
      type: "object",
      properties: {
        offset: { type: "number", minimum: 0, maximum: 1 },
        color: { type: "string", minLength: 1 },
        opacity: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["offset", "color", "opacity"],
      additionalProperties: false,
    },
  },
  from: MODEL_POINT_SCHEMA,
  to: MODEL_POINT_SCHEMA,
  rotation: { type: "number" },
  stretch: { type: "number", exclusiveMinimum: 0 },
} as const;

const MODEL_PAINT_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        type: { const: "solid" },
        color: { type: "string", minLength: 1 },
        ...MODEL_PAINT_BASE_PROPERTIES,
      },
      required: ["type", "color", "opacity"],
      additionalProperties: false,
    },
    ...(
      ["linear-gradient", "radial-gradient", "angular-gradient"] as const
    ).map((type) => ({
      type: "object" as const,
      properties: {
        type: { const: type },
        ...MODEL_GRADIENT_PROPERTIES,
      },
      required: ["type", "opacity", "stops"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        type: { const: "image" },
        assetId: { type: "string", minLength: 1 },
        fit: { enum: ["fill", "contain", "cover", "tile"] },
        ...MODEL_PAINT_BASE_PROPERTIES,
        rotation: { type: "number" },
        scale: MODEL_POINT_SCHEMA,
        offset: MODEL_POINT_SCHEMA,
      },
      required: ["type", "assetId", "fit", "opacity"],
      additionalProperties: false,
    },
  ],
} as const;

const MODEL_EFFECT_SCHEMA = {
  anyOf: [
    ...(["drop-shadow", "inner-shadow"] as const).map((type) => ({
      type: "object" as const,
      properties: {
        type: { const: type },
        color: { type: "string", minLength: 1 },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        offset: MODEL_POINT_SCHEMA,
        blur: { type: "number", minimum: 0 },
        spread: { type: "number" },
        visible: { type: "boolean" },
        blendMode: { enum: MODEL_BLEND_MODES },
      },
      required: ["type", "color", "opacity", "offset", "blur", "spread"],
      additionalProperties: false,
    })),
    ...(["outer-glow", "inner-glow"] as const).map((type) => ({
      type: "object" as const,
      properties: {
        type: { const: type },
        color: { type: "string", minLength: 1 },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        radius: { type: "number", minimum: 0 },
        spread: { type: "number" },
        visible: { type: "boolean" },
        blendMode: { enum: MODEL_BLEND_MODES },
      },
      required: ["type", "color", "opacity", "radius", "spread"],
      additionalProperties: false,
    })),
    ...(["layer-blur", "background-blur"] as const).map((type) => ({
      type: "object" as const,
      properties: {
        type: { const: type },
        radius: { type: "number", minimum: 0 },
        visible: { type: "boolean" },
      },
      required: ["type", "radius"],
      additionalProperties: false,
    })),
    {
      type: "object",
      properties: {
        type: { const: "grayscale" },
        amount: { type: "number", minimum: 0, maximum: 1 },
        visible: { type: "boolean" },
      },
      required: ["type", "amount"],
      additionalProperties: false,
    },
  ],
} as const;

const MODEL_SHAPE_PROPERTIES = {
  fills: { type: "array", items: MODEL_PAINT_SCHEMA },
  strokes: { type: "array", items: MODEL_PAINT_SCHEMA },
  strokeWidth: { type: "number", minimum: 0 },
  strokeAlign: { enum: ["inside", "center", "outside"] },
  strokeCap: { enum: ["none", "round", "square"] },
  strokeJoin: { enum: ["miter", "round", "bevel"] },
  dashPattern: {
    type: "array",
    items: { type: "number", minimum: 0 },
  },
} as const;

const MODEL_VECTOR_GEOMETRY_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z][A-Za-z0-9._:-]*$",
} as const;

const MODEL_VECTOR_NETWORK_SCHEMA = {
  type: "object",
  description:
    "Editable vector geometry. Vertices and segments use stable IDs scoped to this node; segment tangents are offsets from their corresponding start/end vertices. Ordered path runs own every segment exactly once. Closed path runs may be referenced by fill regions.",
  properties: {
    vertices: {
      type: "array",
      minItems: 2,
      maxItems: 16_384,
      items: {
        type: "object",
        properties: {
          id: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          handleMode: {
            enum: ["corner", "smooth", "mirrored", "independent"],
            description:
              "Persistent Bézier handle behavior. Omit only when importing legacy geometry and letting the editor infer it.",
          },
          x: { type: "number" },
          y: { type: "number" },
        },
        required: ["id", "x", "y"],
        additionalProperties: false,
      },
    },
    segments: {
      type: "array",
      minItems: 1,
      maxItems: 16_384,
      items: {
        type: "object",
        properties: {
          id: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          startVertexId: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          endVertexId: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          tangentStart: MODEL_POINT_SCHEMA,
          tangentEnd: MODEL_POINT_SCHEMA,
        },
        required: ["id", "startVertexId", "endVertexId"],
        additionalProperties: false,
      },
    },
    paths: {
      type: "array",
      minItems: 1,
      maxItems: 16_384,
      items: {
        type: "object",
        properties: {
          id: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          closed: { type: "boolean" },
          segments: {
            type: "array",
            minItems: 1,
            maxItems: 16_384,
            items: {
              type: "object",
              properties: {
                segmentId: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
                reversed: { type: "boolean" },
              },
              required: ["segmentId", "reversed"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "closed", "segments"],
        additionalProperties: false,
      },
    },
    regions: {
      type: "array",
      maxItems: 16_384,
      items: {
        type: "object",
        properties: {
          id: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
          windingRule: { enum: ["nonzero", "evenodd"] },
          loops: {
            type: "array",
            minItems: 1,
            maxItems: 1_024,
            items: {
              type: "object",
              properties: {
                pathId: MODEL_VECTOR_GEOMETRY_ID_SCHEMA,
                reversed: { type: "boolean" },
              },
              required: ["pathId", "reversed"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "windingRule", "loops"],
        additionalProperties: false,
      },
    },
  },
  required: ["vertices", "segments", "paths", "regions"],
  additionalProperties: false,
} as const;

const MODEL_LINE_PROPERTIES = {
  fills: { type: "array", maxItems: 0, items: MODEL_PAINT_SCHEMA },
  strokes: MODEL_SHAPE_PROPERTIES.strokes,
  strokeWidth: MODEL_SHAPE_PROPERTIES.strokeWidth,
  strokeAlign: { const: "center" },
  strokeCap: MODEL_SHAPE_PROPERTIES.strokeCap,
  strokeJoin: MODEL_SHAPE_PROPERTIES.strokeJoin,
  dashPattern: MODEL_SHAPE_PROPERTIES.dashPattern,
  start: MODEL_NORMALIZED_POINT_SCHEMA,
  end: MODEL_NORMALIZED_POINT_SCHEMA,
  startEndpoint: {
    enum: [
      "none",
      "line-arrow",
      "triangle-arrow",
      "reversed-triangle-arrow",
      "circle",
      "diamond",
    ],
  },
  endEndpoint: {
    enum: [
      "none",
      "line-arrow",
      "triangle-arrow",
      "reversed-triangle-arrow",
      "circle",
      "diamond",
    ],
  },
} as const;

const MODEL_TEXT_PROPERTIES = {
  content: { type: "string" },
  fontFamily: { type: "string", minLength: 1 },
  fontStyleName: {
    anyOf: [{ type: "string", minLength: 1, maxLength: 512 }, { type: "null" }],
    description:
      "Exact font face style name when known (for example Semi Bold Italic); null only when the source format cannot identify the face.",
  },
  fontSize: { type: "number", exclusiveMinimum: 0 },
  fontWeight: { type: "integer", minimum: 1, maximum: 1_000 },
  fontSlant: { enum: ["normal", "italic"] },
  lineHeight: { type: "number", exclusiveMinimum: 0 },
  letterSpacing: { type: "number" },
  paragraphIndent: { type: "number", minimum: 0 },
  paragraphSpacing: { type: "number", minimum: 0 },
  listSpacing: { type: "number", minimum: 0 },
  hangingList: { type: "boolean" },
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
  ...MODEL_SHAPE_PROPERTIES,
} as const;

const MODEL_PATH_PROPERTY = {
  type: "string",
  minLength: 1,
  maxLength: 200_000,
  pattern: "^[\\t\\n\\r ,.+\\-0-9AaCcEeHhLlMmQqSsTtVvZz]+$",
  description: "Portable SVG path data in the node's local coordinates.",
} as const;

const MODEL_NODE_KIND_PROPERTIES_SCHEMA = {
  type: "object",
  description:
    "Properties must match the inspected node kind; Path/Vector require exactly one geometry source. On insert, the host defaults omitted no-op appearance fields by kind: fills/strokes to [], strokeWidth/cornerRadius to 0, and Frame clipsContent to false. The host validates the complete discriminated node before writing.",
  properties: {
    ...MODEL_SHAPE_PROPERTIES,
    cornerRadius: { type: "number", minimum: 0 },
    clipsContent: { type: "boolean" },
    content: MODEL_TEXT_PROPERTIES.content,
    fontFamily: MODEL_TEXT_PROPERTIES.fontFamily,
    fontStyleName: MODEL_TEXT_PROPERTIES.fontStyleName,
    fontSize: MODEL_TEXT_PROPERTIES.fontSize,
    fontWeight: MODEL_TEXT_PROPERTIES.fontWeight,
    fontSlant: MODEL_TEXT_PROPERTIES.fontSlant,
    lineHeight: MODEL_TEXT_PROPERTIES.lineHeight,
    letterSpacing: MODEL_TEXT_PROPERTIES.letterSpacing,
    paragraphIndent: MODEL_TEXT_PROPERTIES.paragraphIndent,
    paragraphSpacing: MODEL_TEXT_PROPERTIES.paragraphSpacing,
    listSpacing: MODEL_TEXT_PROPERTIES.listSpacing,
    hangingList: MODEL_TEXT_PROPERTIES.hangingList,
    textCase: MODEL_TEXT_PROPERTIES.textCase,
    textDecoration: MODEL_TEXT_PROPERTIES.textDecoration,
    textAlignHorizontal: MODEL_TEXT_PROPERTIES.textAlignHorizontal,
    textAlignVertical: MODEL_TEXT_PROPERTIES.textAlignVertical,
    textResize: MODEL_TEXT_PROPERTIES.textResize,
    textWrap: MODEL_TEXT_PROPERTIES.textWrap,
    textOverflow: MODEL_TEXT_PROPERTIES.textOverflow,
    textTruncation: MODEL_TEXT_PROPERTIES.textTruncation,
    maxLines: MODEL_TEXT_PROPERTIES.maxLines,
    assetId: { type: "string", minLength: 1 },
    placement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
    altText: { type: "string" },
    path: MODEL_PATH_PROPERTY,
    network: MODEL_VECTOR_NETWORK_SCHEMA,
    fillRule: { enum: ["nonzero", "evenodd"] },
    start: MODEL_LINE_PROPERTIES.start,
    end: MODEL_LINE_PROPERTIES.end,
    startEndpoint: MODEL_LINE_PROPERTIES.startEndpoint,
    endEndpoint: MODEL_LINE_PROPERTIES.endEndpoint,
    pointCount: { type: "integer", minimum: 3, maximum: 60 },
    innerRadius: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
} as const;

const MODEL_NODE_PROPERTY_PATCH_SCHEMA = {
  ...MODEL_NODE_KIND_PROPERTIES_SCHEMA,
  description:
    "A partial property patch. It must contain only fields supported by the inspected target node kind; the host validates the merged node before any revision is written.",
} as const;

const MODEL_EXPORT_SETTINGS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      format: { enum: ["PNG", "JPG", "WEBP", "SVG"] },
      suffix: { type: "string" },
      constraint: {
        type: "object",
        properties: {
          type: { enum: ["SCALE", "WIDTH", "HEIGHT"] },
          value: { type: "number", exclusiveMinimum: 0, maximum: 16_384 },
        },
        required: ["type", "value"],
        additionalProperties: false,
      },
      svgIdAttribute: { type: "boolean" },
    },
    required: ["format", "suffix"],
    additionalProperties: false,
  },
} as const;

const MODEL_NODE_SCHEMA = {
  type: "object",
  description: "OpenDesign node. Set exportSettings with update_properties.",
  properties: {
    id: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string" },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    childIds: {
      type: "array",
      uniqueItems: true,
      description:
        "Use [] on insert; hierarchy comes from child parentId/index.",
      items: { type: "string", minLength: 1, maxLength: 512 },
    },
    visible: { type: "boolean" },
    locked: { type: "boolean" },
    transform: MODEL_TRANSFORM_SCHEMA,
    size: MODEL_SIZE_SCHEMA,
    opacity: { type: "number", minimum: 0, maximum: 1 },
    blendMode: { enum: MODEL_BLEND_MODES },
    effects: { type: "array", items: MODEL_EFFECT_SCHEMA },
    maskMode: {
      enum: ["none", "alpha", "luminance", "clipping", "outline"],
    },
    extensions: { type: "object" },
    kind: {
      enum: [
        "frame",
        "group",
        "rectangle",
        "ellipse",
        "line",
        "polygon",
        "star",
        "text",
        "image",
        "vector",
        "path",
        "instance",
        "slice",
      ],
    },
    properties: MODEL_NODE_KIND_PROPERTIES_SCHEMA,
  },
  required: [
    "id",
    "name",
    "parentId",
    "childIds",
    "visible",
    "locked",
    "transform",
    "size",
    "opacity",
    "extensions",
    "kind",
    "properties",
  ],
  additionalProperties: false,
} as const;

const MODEL_INSERT_NODE_SCHEMA = {
  ...MODEL_NODE_SCHEMA,
  description:
    "Insert node; the host defaults structural fields and exportSettings.",
  required: ["id", "name", "transform", "size", "kind", "properties"],
} as const;

const MODEL_NODE_OPERATION_SCHEMA = {
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
        node: MODEL_INSERT_NODE_SCHEMA,
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
        name: { type: "string" },
        visible: { type: "boolean" },
        locked: { type: "boolean" },
        transform: MODEL_TRANSFORM_SCHEMA,
        size: MODEL_SIZE_SCHEMA,
        exportSettings: MODEL_EXPORT_SETTINGS_SCHEMA,
        opacity: { type: "number", minimum: 0, maximum: 1 },
        blendMode: { enum: MODEL_BLEND_MODES },
        effects: { type: "array", items: MODEL_EFFECT_SCHEMA },
        maskMode: {
          enum: ["none", "alpha", "luminance", "clipping", "outline"],
        },
        properties: MODEL_NODE_PROPERTY_PATCH_SCHEMA,
        extensions: { type: "object" },
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
    {
      type: "object",
      properties: {
        commandId: { type: "string", minLength: 1, maxLength: 256 },
        type: { const: "replace_subtree" },
        rootNodeId: { type: "string", minLength: 1, maxLength: 256 },
        nodes: { type: "array", minItems: 1, items: MODEL_NODE_SCHEMA },
      },
      required: ["commandId", "type", "rootNodeId", "nodes"],
      additionalProperties: false,
    },
  ],
} as const;

const MODEL_APPLY_STEP_SCHEMA = {
  type: "object",
  properties: {
    stepId: { type: "string", minLength: 1, maxLength: 256 },
    label: { type: "string", minLength: 1, maxLength: 256 },
    commandIds: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
  },
  required: ["stepId", "label", "commandIds"],
  additionalProperties: false,
} as const;

const MODEL_APPLY_TRANSACTION_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 256 },
    summary: { type: "string", maxLength: 2_000 },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      description:
        "Ordered semantic steps. commandIds must cover commands once in order. Use navigation, hero, content, footer—not arbitrary batches.",
      items: MODEL_APPLY_STEP_SCHEMA,
    },
    commands: {
      type: "array",
      minItems: 1,
      maxItems: 1_000,
      items: MODEL_NODE_OPERATION_SCHEMA,
    },
  },
  required: ["label", "commands"],
  additionalProperties: false,
} as const;

export const DESIGN_APPLY_STEP_SCHEMA = executableJsonSchema(
  MODEL_APPLY_STEP_SCHEMA,
);
export const DESIGN_APPLY_TOOL_INPUT_SCHEMA = executableJsonSchema(
  MODEL_APPLY_TRANSACTION_SCHEMA,
);
export const DESIGN_MODEL_BLEND_MODES = MODEL_BLEND_MODES;
export const DESIGN_MODEL_EFFECT_SCHEMA = MODEL_EFFECT_SCHEMA;
export const DESIGN_MODEL_NODE_PROPERTY_PATCH_SCHEMA =
  MODEL_NODE_PROPERTY_PATCH_SCHEMA;
