import {
  MAX_TRANSACTION_COMMANDS,
  executableJsonSchema,
} from "@opendesign/design-contracts";
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

const MODEL_PAINT_PROPERTIES = {
  type: {
    enum: [
      "solid",
      "linear-gradient",
      "radial-gradient",
      "angular-gradient",
      "image",
    ],
  },
  color: { type: "string", minLength: 1 },
  ...MODEL_GRADIENT_PROPERTIES,
  assetId: { type: "string", minLength: 1 },
  fit: { enum: ["fill", "contain", "cover", "crop", "tile"] },
  scale: MODEL_POINT_SCHEMA,
  offset: MODEL_POINT_SCHEMA,
} as const;

const MODEL_PAINT_SCHEMA = {
  type: "object",
  properties: MODEL_PAINT_PROPERTIES,
  required: ["type", "opacity"],
  additionalProperties: false,
  anyOf: [
    {
      type: "object",
      properties: {
        type: { const: "solid" },
        color: {},
      },
      required: ["type", "color"],
    },
    ...(
      ["linear-gradient", "radial-gradient", "angular-gradient"] as const
    ).map((type) => ({
      type: "object" as const,
      properties: {
        type: { const: type },
        stops: {},
      },
      required: ["type", "stops"],
    })),
    {
      type: "object",
      properties: {
        type: { const: "image" },
        assetId: {},
        fit: {},
      },
      required: ["type", "assetId", "fit"],
    },
  ],
} as const;

export const DESIGN_MODEL_PAINT_PROPERTY_KEYS_BY_TYPE = {
  solid: ["type", "color", "opacity", "visible", "blendMode"],
  "linear-gradient": [
    "type",
    "opacity",
    "visible",
    "blendMode",
    "stops",
    "from",
    "to",
    "rotation",
    "stretch",
  ],
  "radial-gradient": [
    "type",
    "opacity",
    "visible",
    "blendMode",
    "stops",
    "from",
    "to",
    "rotation",
    "stretch",
  ],
  "angular-gradient": [
    "type",
    "opacity",
    "visible",
    "blendMode",
    "stops",
    "from",
    "to",
    "rotation",
    "stretch",
  ],
  image: [
    "type",
    "assetId",
    "fit",
    "opacity",
    "visible",
    "blendMode",
    "rotation",
    "scale",
    "offset",
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

const MODEL_NODE_PROPERTY_FIELDS = {
  ...MODEL_SHAPE_PROPERTIES,
  cornerRadius: { type: "number", minimum: 0 },
  cornerSmoothing: { type: "number", minimum: 0, maximum: 1 },
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
} as const;

const MODEL_NODE_PROPERTIES_SCHEMA = {
  type: "object",
  description:
    "Kind fields: Group/Slice {}; Frame shape+cornerRadius+clipsContent; Rectangle shape+cornerRadius; Ellipse shape; Line shape+start/end/endpoints; Polygon shape+pointCount+cornerRadius; Star shape+pointCount+innerRadius+cornerRadius; Text typography+shape; Image assetId+placement+altText+cornerRadius; Path/Vector shape plus exactly one of path or network; cornerRadius/cornerSmoothing apply only to editable network geometry.",
  properties: MODEL_NODE_PROPERTY_FIELDS,
  additionalProperties: false,
} as const;

const MODEL_NODE_PROPERTY_PATCH_SCHEMA = {
  ...MODEL_NODE_PROPERTIES_SCHEMA,
  description:
    "A partial property patch. Use only fields supported by the inspected target kind; the host validates the patch against that current node before writing.",
} as const;

const MODEL_SHAPE_PROPERTY_KEYS = Object.keys(MODEL_SHAPE_PROPERTIES);

function requiredPropertiesSchema(
  required: readonly string[] = [],
  anyOf?: readonly Record<string, unknown>[],
) {
  return {
    type: "object" as const,
    properties: Object.fromEntries(required.map((key) => [key, {}])),
    ...(required.length === 0 ? {} : { required }),
    ...(anyOf === undefined ? {} : { anyOf }),
  };
}

const MODEL_FRAME_PROPERTY_KEYS = [
  ...MODEL_SHAPE_PROPERTY_KEYS,
  "cornerRadius",
  "clipsContent",
] as const;
const MODEL_FRAME_PROPERTIES_SCHEMA = requiredPropertiesSchema();

const MODEL_GROUP_PROPERTY_KEYS: readonly string[] = [];
const MODEL_GROUP_PROPERTIES_SCHEMA = requiredPropertiesSchema();

const MODEL_RECTANGLE_PROPERTY_KEYS = [
  ...MODEL_SHAPE_PROPERTY_KEYS,
  "cornerRadius",
] as const;
const MODEL_RECTANGLE_PROPERTIES_SCHEMA = requiredPropertiesSchema();

const MODEL_ELLIPSE_PROPERTY_KEYS = MODEL_SHAPE_PROPERTY_KEYS;
const MODEL_ELLIPSE_PROPERTIES_SCHEMA = requiredPropertiesSchema();

const MODEL_LINE_PROPERTY_KEYS = Object.keys(MODEL_LINE_PROPERTIES);
const MODEL_LINE_PROPERTIES_SCHEMA = requiredPropertiesSchema([
  "start",
  "end",
  "startEndpoint",
  "endEndpoint",
]);

const MODEL_POLYGON_PROPERTY_KEYS = [
  ...MODEL_SHAPE_PROPERTY_KEYS,
  "pointCount",
  "cornerRadius",
] as const;
const MODEL_POLYGON_PROPERTIES_SCHEMA = requiredPropertiesSchema([
  "pointCount",
]);

const MODEL_STAR_PROPERTY_KEYS = [
  ...MODEL_SHAPE_PROPERTY_KEYS,
  "pointCount",
  "innerRadius",
  "cornerRadius",
] as const;
const MODEL_STAR_PROPERTIES_SCHEMA = requiredPropertiesSchema([
  "pointCount",
  "innerRadius",
]);

const MODEL_TEXT_CORE_REQUIRED = [
  "content",
  "fontFamily",
  "fontStyleName",
  "fontSize",
  "fontWeight",
  "fontSlant",
  "lineHeight",
  "letterSpacing",
  "paragraphIndent",
  "paragraphSpacing",
  "listSpacing",
  "hangingList",
  "textCase",
  "textDecoration",
  "textAlignHorizontal",
  "textAlignVertical",
  "textResize",
  "textWrap",
  "textOverflow",
  "textTruncation",
  "maxLines",
] as const;

function textMode(
  textResize: "fixed" | "auto-width" | "auto-height",
  textWrap: readonly ("none" | "word" | "character")[],
  textOverflow: readonly ("visible" | "clip")[],
  textTruncation: "disabled" | "ending",
  maxLines: Record<string, unknown>,
) {
  return {
    type: "object" as const,
    properties: {
      textResize: { const: textResize },
      textWrap: { enum: textWrap },
      textOverflow: { enum: textOverflow },
      textTruncation: { const: textTruncation },
      maxLines,
    },
    required: [
      "textResize",
      "textWrap",
      "textOverflow",
      "textTruncation",
      "maxLines",
    ],
  };
}

const MODEL_TEXT_PROPERTY_KEYS = Object.keys(MODEL_TEXT_PROPERTIES);
const MODEL_TEXT_PROPERTIES_SCHEMA = requiredPropertiesSchema(
  MODEL_TEXT_CORE_REQUIRED,
  [
    textMode(
      "fixed",
      ["none", "word", "character"],
      ["visible", "clip"],
      "disabled",
      { type: "null" },
    ),
    textMode("fixed", ["none", "word", "character"], ["clip"], "ending", {
      anyOf: [{ type: "null" }, { type: "integer", minimum: 1 }],
    }),
    textMode("auto-width", ["none"], ["visible"], "disabled", { type: "null" }),
    textMode("auto-width", ["none"], ["visible"], "ending", {
      type: "integer",
      minimum: 1,
    }),
    textMode("auto-height", ["word", "character"], ["visible"], "disabled", {
      type: "null",
    }),
    textMode("auto-height", ["word", "character"], ["visible"], "ending", {
      type: "integer",
      minimum: 1,
    }),
  ],
);

const MODEL_IMAGE_PROPERTY_KEYS = [
  "assetId",
  "placement",
  "altText",
  "cornerRadius",
] as const;
const MODEL_IMAGE_PROPERTIES_SCHEMA = requiredPropertiesSchema([
  "assetId",
  "placement",
  "altText",
]);

const MODEL_PATH_PROPERTY_KEYS = [
  ...MODEL_SHAPE_PROPERTY_KEYS,
  "path",
  "network",
  "fillRule",
  "cornerRadius",
  "cornerSmoothing",
] as const;
const MODEL_PATH_DATA_PROPERTIES_SCHEMA = requiredPropertiesSchema(["path"]);

const MODEL_VECTOR_NETWORK_PROPERTIES_SCHEMA = requiredPropertiesSchema([
  "network",
]);

const MODEL_PATH_PROPERTIES_SCHEMA = {
  anyOf: [
    MODEL_PATH_DATA_PROPERTIES_SCHEMA,
    MODEL_VECTOR_NETWORK_PROPERTIES_SCHEMA,
  ],
} as const;

const MODEL_SLICE_PROPERTIES_SCHEMA = MODEL_GROUP_PROPERTIES_SCHEMA;

export const DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND = {
  frame: MODEL_FRAME_PROPERTY_KEYS,
  group: MODEL_GROUP_PROPERTY_KEYS,
  rectangle: MODEL_RECTANGLE_PROPERTY_KEYS,
  ellipse: MODEL_ELLIPSE_PROPERTY_KEYS,
  line: MODEL_LINE_PROPERTY_KEYS,
  polygon: MODEL_POLYGON_PROPERTY_KEYS,
  star: MODEL_STAR_PROPERTY_KEYS,
  text: MODEL_TEXT_PROPERTY_KEYS,
  image: MODEL_IMAGE_PROPERTY_KEYS,
  vector: MODEL_PATH_PROPERTY_KEYS,
  path: MODEL_PATH_PROPERTY_KEYS,
  slice: MODEL_GROUP_PROPERTY_KEYS,
} as const;

const MODEL_NODE_KIND_BRANCHES = [
  ["frame", MODEL_FRAME_PROPERTIES_SCHEMA],
  ["group", MODEL_GROUP_PROPERTIES_SCHEMA],
  ["rectangle", MODEL_RECTANGLE_PROPERTIES_SCHEMA],
  ["ellipse", MODEL_ELLIPSE_PROPERTIES_SCHEMA],
  ["line", MODEL_LINE_PROPERTIES_SCHEMA],
  ["polygon", MODEL_POLYGON_PROPERTIES_SCHEMA],
  ["star", MODEL_STAR_PROPERTIES_SCHEMA],
  ["text", MODEL_TEXT_PROPERTIES_SCHEMA],
  ["image", MODEL_IMAGE_PROPERTIES_SCHEMA],
  ["vector", MODEL_PATH_PROPERTIES_SCHEMA],
  ["path", MODEL_PATH_PROPERTIES_SCHEMA],
  ["slice", MODEL_SLICE_PROPERTIES_SCHEMA],
] as const;

const MODEL_NODE_KINDS = MODEL_NODE_KIND_BRANCHES.map(([kind]) => kind);

const MODEL_NODE_DISCRIMINATED_BRANCHES = MODEL_NODE_KIND_BRANCHES.map(
  ([kind, properties]) => ({
    type: "object" as const,
    properties: {
      kind: { const: kind },
      properties,
    },
    required: ["kind", "properties"],
  }),
);

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
  description:
    "OpenDesign node with kind-discriminated properties. No-op appearance defaults are compiled deterministically; kind-specific semantic fields are required here. Set exportSettings with update_properties.",
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
    kind: { enum: MODEL_NODE_KINDS },
    properties: MODEL_NODE_PROPERTIES_SCHEMA,
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
  anyOf: MODEL_NODE_DISCRIMINATED_BRANCHES,
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
      minProperties: 4,
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
      maxItems: MAX_TRANSACTION_COMMANDS,
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
      maxItems: MAX_TRANSACTION_COMMANDS,
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
