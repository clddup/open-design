import {
  isDesignAsset,
  isDesignOperation,
  isImagePlacement,
  type BooleanOperation,
  type DesignAsset,
  type DesignOperation,
  type ImagePlacement,
} from "@opendesign/design-contracts";
import {
  isSvgInterchangeIssue,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service/svg-issues";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import { isPortableFileName } from "./portable-file-name";
export const DESIGN_CAPABILITIES_TOOL_NAME = "opendesign_get_capabilities";
export const DESIGN_INSPECT_TOOL_NAME = "opendesign_inspect_document";
export const DESIGN_CAPTURE_TOOL_NAME = "opendesign_capture_canvas";
export const DESIGN_PLAN_TOOL_NAME = "opendesign_define_design_plan";
export const DESIGN_REVIEW_TOOL_NAME = "opendesign_record_visual_review";
export const DESIGN_APPLY_TOOL_NAME = "opendesign_apply_transaction";
export const DESIGN_HIERARCHY_TOOL_NAME = "opendesign_edit_hierarchy";
export const DESIGN_ARRANGE_TOOL_NAME = "opendesign_arrange_layers";
export const READ_IMAGE_TOOL_NAME = "opendesign_read_image";
export const GENERATE_IMAGE_TOOL_NAME = "opendesign_generate_image";
export const PLACE_IMAGE_TOOL_NAME = "opendesign_place_image";
export const UPDATE_IMAGE_TOOL_NAME = "opendesign_update_image";
export const IMPORT_SVG_TOOL_NAME = "opendesign_import_svg";
export const EXPORT_SVG_TOOL_NAME = "opendesign_export_svg";
export const INTERNAL_DESIGN_APPLY_TOOL_NAME =
  "opendesign_internal_apply_transaction";
export const INTERNAL_UPDATE_IMAGE_TOOL_NAME =
  "opendesign_internal_update_image";
export const INTERNAL_IMPORT_SVG_TOOL_NAME = "opendesign_internal_import_svg";

export type ReadImageToolInput = { source: string };
export type DesignDeliverable =
  | "ui"
  | "poster"
  | "logo"
  | "brand-asset"
  | "illustration"
  | "presentation-visual"
  | "other";
export type RasterAssetRole =
  | "reference"
  | "background"
  | "hero"
  | "supporting-content"
  | "final-single-image";
export type PlaceableRasterAssetRole = Exclude<RasterAssetRole, "reference">;
export type DesignPlanToolInput = {
  pageId: string;
  deliverable: DesignDeliverable;
  objective: string;
  outputMode: "editable-composition" | "single-raster";
  artboard: {
    mode: "create" | "existing";
    frameId: string;
    width: number;
    height: number;
  };
  composition: {
    assetIntegration: string;
    direction: string;
    hierarchy: string[];
    spacingRhythm: string;
  };
  visualSystem: {
    avoidances: string[];
    formLanguage: string;
    palette: string[];
    surfaceAndDepth: string;
    typography: string[];
    effects: string[];
  };
  rasterAssetRoles: RasterAssetRole[];
  editableLayers: string[];
  implementationSteps: string[];
  validationChecks: string[];
  singleRasterEvidence?: string;
};
export type DesignVisualReviewToolInput = {
  composition: string;
  hierarchy: string;
  typography: string;
  assetIntegration: string;
  formAndSurface: string;
  effects: string;
  refinements: string[];
};
export type ImageGenerationSize = "auto" | `${number}x${number}`;
export type ImageGenerationQuality = "auto" | "low" | "medium" | "high";
export type ImageGenerationOutputFormat = "png" | "jpeg" | "webp";
export type GenerateImageToolInput = {
  prompt: string;
  role: RasterAssetRole;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
};
export type PlaceImageToolInput = {
  attachmentId: string;
  pageId: string;
  parentId: string | null;
  index: number;
  nodeId: string;
  name: string;
  role: PlaceableRasterAssetRole;
  x: number;
  y: number;
  width?: number;
  height?: number;
  placement?: ImagePlacement;
};
export type UpdateImageToolInput =
  | {
      action: "set-placement";
      label: string;
      pageId: string;
      nodeId: string;
      placement: ImagePlacement;
    }
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      attachmentId: string;
      placement?: ImagePlacement;
    };

export type ExportSvgToolInput = {
  pageId: string;
  rootNodeIds: string[];
  suggestedName: string;
  includeLayerIds?: boolean;
  padding?: number;
};

export type ImportSvgToolInput = {
  attachmentId: string;
  pageId: string;
  parentId: string | null;
  index: number;
  x: number;
  y: number;
};

export type InternalImportSvgToolInput = ImportSvgToolInput & {
  name: string;
  svg: string;
  idPrefix: string;
};

export type AgentSvgImportResult = {
  kind: "svg-import-result";
  version: 1;
  ok: true;
  format: "svg";
  attachmentId: string;
  name: string;
  pageId: string;
  parentId: string | null;
  rootNodeId: string;
  importedNodeIds: string[];
  revision: number;
  atomic: true;
  issues: SvgInterchangeIssue[];
};

export type PreparedAgentSvgExport = {
  kind: "svg-export-preparation";
  version: 1;
  suggestedName: string;
  svg: string;
  revision: number;
  exportedNodeIds: string[];
  issues: SvgInterchangeIssue[];
};

export type InternalUpdateImageToolInput =
  | Extract<UpdateImageToolInput, { action: "set-placement" }>
  | {
      action: "replace-source";
      label: string;
      pageId: string;
      nodeId: string;
      asset: DesignAsset;
      placement?: ImagePlacement;
    };

export type DesignApplyToolInput = {
  label: string;
  summary?: string;
  commands: DesignOperation[];
};

export type DesignHierarchyToolInput =
  | {
      action: "group";
      label: string;
      pageId: string;
      nodeIds: string[];
      groupId: string;
      name: string;
    }
  | {
      action: "ungroup";
      label: string;
      pageId: string;
      groupId: string;
    }
  | {
      action: "create-boolean";
      label: string;
      pageId: string;
      nodeIds: string[];
      booleanId: string;
      name: string;
      operation: BooleanOperation;
    }
  | {
      action: "set-boolean-operation";
      label: string;
      pageId: string;
      booleanId: string;
      operation: BooleanOperation;
    }
  | {
      action: "ungroup-boolean";
      label: string;
      pageId: string;
      booleanId: string;
    }
  | {
      action: "reorder";
      label: string;
      pageId: string;
      nodeIds: string[];
      order:
        "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back";
    }
  | {
      action: "reparent";
      label: string;
      pageId: string;
      nodeIds: string[];
      parentId: string | null;
      index: number;
    };

export type DesignArrangeToolInput =
  | {
      action:
        | "align-left"
        | "align-horizontal-center"
        | "align-right"
        | "align-top"
        | "align-vertical-center"
        | "align-bottom"
        | "distribute-horizontal"
        | "distribute-vertical";
      label: string;
      pageId: string;
      nodeIds: string[];
    }
  | {
      action: "set-horizontal-spacing" | "set-vertical-spacing";
      label: string;
      pageId: string;
      nodeIds: string[];
      spacing: number;
    };

// The canonical DesignOperation schema is deliberately exhaustive and is used
// for the trusted runtime validation below. Serializing that TypeBox union into
// a model tool repeated the complete node union for insert and replace, turning
// one tool into a 300+ KB request. The model-facing schema describes the same
// public command surface in a compact form; it is guidance, never the trust
// boundary. Every generated command still has to pass isDesignOperation().
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

const MODEL_PAINT_SCHEMA = {
  type: "object",
  description:
    "A solid, linear-gradient, radial-gradient, angular-gradient, or image paint. solid requires color; gradients require stops and may use from/to/rotation/stretch; image requires assetId and fit. opacity is always required.",
  properties: {
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
    opacity: { type: "number", minimum: 0, maximum: 1 },
    visible: { type: "boolean" },
    blendMode: { enum: MODEL_BLEND_MODES },
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
    assetId: { type: "string", minLength: 1 },
    fit: { enum: ["fill", "contain", "cover", "tile"] },
    scale: MODEL_POINT_SCHEMA,
    offset: MODEL_POINT_SCHEMA,
  },
  required: ["type", "opacity"],
  additionalProperties: false,
} as const;

const MODEL_EFFECT_SCHEMA = {
  type: "object",
  description:
    "An OpenDesign effect. Shadows require color, opacity, offset, blur, and spread; glows require color, opacity, radius, and spread; blur requires radius; grayscale requires amount.",
  properties: {
    type: {
      enum: [
        "drop-shadow",
        "inner-shadow",
        "outer-glow",
        "inner-glow",
        "layer-blur",
        "background-blur",
        "grayscale",
      ],
    },
    color: { type: "string", minLength: 1 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
    offset: MODEL_POINT_SCHEMA,
    blur: { type: "number", minimum: 0 },
    spread: { type: "number" },
    radius: { type: "number", minimum: 0 },
    amount: { type: "number", minimum: 0, maximum: 1 },
    visible: { type: "boolean" },
    blendMode: { enum: MODEL_BLEND_MODES },
  },
  required: ["type"],
  additionalProperties: false,
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

const MODEL_NODE_KIND_PROPERTIES_SCHEMA = {
  type: "object",
  description:
    "Properties must match node.kind. frame: shape fields + cornerRadius + clipsContent; group: empty object; rectangle: shape fields + cornerRadius; ellipse: shape fields; line: empty fills + center stroke fields + normalized directed start/end + independent startEndpoint/endEndpoint; text: content/fontFamily/fontSize/fontWeight/lineHeight/letterSpacing/textAlignHorizontal/textAlignVertical + shape fields; image: assetId/placement/altText/cornerRadius; path or vector: shape fields + exactly one geometry source (portable SVG path for exact imported data, or network for editable vertices/segments) + optional fillRule.",
  properties: {
    ...MODEL_SHAPE_PROPERTIES,
    cornerRadius: { type: "number", minimum: 0 },
    clipsContent: { type: "boolean" },
    content: { type: "string" },
    fontFamily: { type: "string", minLength: 1 },
    fontSize: { type: "number", exclusiveMinimum: 0 },
    fontWeight: { type: "integer", minimum: 1, maximum: 1_000 },
    lineHeight: { type: "number", exclusiveMinimum: 0 },
    letterSpacing: { type: "number" },
    textAlignHorizontal: {
      enum: ["left", "center", "right", "justify"],
    },
    textAlignVertical: { enum: ["top", "center", "bottom"] },
    assetId: { type: "string", minLength: 1 },
    placement: {
      anyOf: [
        {
          type: "object",
          properties: { mode: { const: "stretch" } },
          required: ["mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: { mode: { const: "fit" } },
          required: ["mode"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "fill" },
            focalPoint: {
              type: "object",
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
          },
          required: ["mode", "focalPoint"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            mode: { const: "crop" },
            focalPoint: {
              type: "object",
              properties: {
                x: { type: "number", minimum: 0, maximum: 1 },
                y: { type: "number", minimum: 0, maximum: 1 },
              },
              required: ["x", "y"],
              additionalProperties: false,
            },
            zoom: { type: "number", minimum: 1, maximum: 64 },
            rotation: { type: "number", minimum: -360, maximum: 360 },
            flipHorizontal: { type: "boolean" },
            flipVertical: { type: "boolean" },
          },
          required: [
            "mode",
            "focalPoint",
            "zoom",
            "rotation",
            "flipHorizontal",
            "flipVertical",
          ],
          additionalProperties: false,
        },
      ],
    },
    altText: { type: "string" },
    path: {
      type: "string",
      minLength: 1,
      maxLength: 200_000,
      description: "Portable SVG path data in the node's local coordinates.",
    },
    network: MODEL_VECTOR_NETWORK_SCHEMA,
    fillRule: { enum: ["nonzero", "evenodd"] },
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
    pointCount: { type: "integer", minimum: 3, maximum: 60 },
    innerRadius: { type: "number", minimum: 0, maximum: 1 },
  },
  additionalProperties: false,
} as const;

const MODEL_NODE_SCHEMA = {
  type: "object",
  description:
    "A complete OpenDesign node. All common fields are required. childIds and parentId must agree with the transaction hierarchy; a new composite container can be inserted before its children in the same ordered transaction.",
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
      items: { type: "string", minLength: 1, maxLength: 256 },
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
        node: MODEL_NODE_SCHEMA,
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
        opacity: { type: "number", minimum: 0, maximum: 1 },
        blendMode: { enum: MODEL_BLEND_MODES },
        effects: { type: "array", items: MODEL_EFFECT_SCHEMA },
        maskMode: {
          enum: ["none", "alpha", "luminance", "clipping", "outline"],
        },
        properties: MODEL_NODE_KIND_PROPERTIES_SCHEMA,
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

const MODEL_APPLY_TRANSACTION_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", minLength: 1, maxLength: 256 },
    summary: { type: "string", maxLength: 2_000 },
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

const MODEL_HIERARCHY_SCHEMA = {
  type: "object",
  description:
    "For group, nodeIds, groupId, and name are required. For ungroup, groupId is required. For create-boolean, nodeIds, booleanId, name, and operation are required. For set-boolean-operation and ungroup-boolean, booleanId is required. For reorder, nodeIds and order are required. For reparent, nodeIds, parentId, and final index are required. Runtime validation enforces the action-specific shape.",
  properties: {
    action: {
      enum: [
        "group",
        "ungroup",
        "create-boolean",
        "set-boolean-operation",
        "ungroup-boolean",
        "reorder",
        "reparent",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
      description:
        "Explicit same-parent layer IDs; required for group and create-boolean (2..249), reorder (1..500), and reparent (1..500).",
    },
    groupId: { type: "string", minLength: 1, maxLength: 256 },
    booleanId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Stable new ID for create-boolean or existing Boolean ID for set-boolean-operation and ungroup-boolean.",
    },
    operation: {
      enum: ["union", "subtract", "intersect", "exclude"],
      description:
        "Boolean operation for create-boolean or set-boolean-operation.",
    },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
      description:
        "Destination Frame or Group ID, or null for the Page root; required only for reparent.",
    },
    index: {
      type: "integer",
      minimum: 0,
      description:
        "Final insertion index after moved nodes are removed from the destination; required only for reparent.",
    },
    order: {
      enum: [
        "bring-forward",
        "bring-to-front",
        "send-backward",
        "send-to-back",
      ],
      description: "Stacking action; required only for reorder.",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Name for the new Group or Boolean group; required for group and create-boolean.",
    },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const;

const MODEL_ARRANGE_SCHEMA = {
  type: "object",
  description:
    "Align requires at least two explicit layers. Distribute requires at least three and preserves the two outermost layers on that axis. Set-spacing requires at least two and a finite spacing value; negative spacing intentionally overlaps layers.",
  properties: {
    action: {
      enum: [
        "align-left",
        "align-horizontal-center",
        "align-right",
        "align-top",
        "align-vertical-center",
        "align-bottom",
        "distribute-horizontal",
        "distribute-vertical",
        "set-horizontal-spacing",
        "set-vertical-spacing",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeIds: {
      type: "array",
      minItems: 2,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
      description:
        "Explicit stable layer IDs from inspection. Selection is context only and is never an implicit target.",
    },
    spacing: {
      type: "number",
      minimum: -1_000_000,
      maximum: 1_000_000,
      description:
        "Exact pixels between adjacent bounds; required only for set-horizontal-spacing and set-vertical-spacing.",
    },
  },
  required: ["action", "label", "pageId", "nodeIds"],
  additionalProperties: false,
} as const;

const MODEL_DESIGN_PLAN_SCHEMA = {
  type: "object",
  description:
    "A bounded, executable visual plan for the current Page. New poster work must name one Frame artboard and keep all poster layers inside it.",
  properties: {
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    deliverable: {
      enum: [
        "ui",
        "poster",
        "logo",
        "brand-asset",
        "illustration",
        "presentation-visual",
        "other",
      ],
    },
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
    outputMode: { enum: ["editable-composition", "single-raster"] },
    artboard: {
      type: "object",
      properties: {
        mode: { enum: ["create", "existing"] },
        frameId: { type: "string", minLength: 1, maxLength: 256 },
        width: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
        height: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
      },
      required: ["mode", "frameId", "width", "height"],
      additionalProperties: false,
    },
    composition: {
      type: "object",
      properties: {
        direction: { type: "string", minLength: 1, maxLength: 1_000 },
        hierarchy: {
          type: "array",
          minItems: 2,
          maxItems: 16,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        assetIntegration: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          description:
            "How native shapes, icons, vectors, illustrations, or raster imagery integrate with editable typography and layout through negative space, contrast, edge treatment, color, masks, gradients, or depth. State an intentional no-raster strategy when appropriate.",
        },
        spacingRhythm: { type: "string", minLength: 1, maxLength: 500 },
      },
      required: ["direction", "hierarchy", "assetIntegration", "spacingRhythm"],
      additionalProperties: false,
    },
    visualSystem: {
      type: "object",
      properties: {
        avoidances: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 256 },
          description:
            "Concrete visual shortcuts to avoid for this design, such as a generic opaque text slab, arbitrary centered layout, or unintegrated stock imagery.",
        },
        formLanguage: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          description:
            "The intended shape, radius, edge, icon, illustration, and control language. Repeating generic rounded rectangles is not a sufficient form language.",
        },
        palette: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        surfaceAndDepth: {
          type: "string",
          minLength: 1,
          maxLength: 1_000,
          description:
            "How borders, fills, gradients, shadows, glows, blur, overlap, and contrast establish hierarchy without turning every region into the same card.",
        },
        typography: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        effects: {
          type: "array",
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
      required: [
        "avoidances",
        "formLanguage",
        "palette",
        "surfaceAndDepth",
        "typography",
        "effects",
      ],
      additionalProperties: false,
    },
    rasterAssetRoles: {
      type: "array",
      maxItems: 5,
      uniqueItems: true,
      items: {
        enum: [
          "reference",
          "background",
          "hero",
          "supporting-content",
          "final-single-image",
        ],
      },
    },
    editableLayers: {
      type: "array",
      minItems: 2,
      maxItems: 24,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    implementationSteps: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    validationChecks: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 500 },
    },
    singleRasterEvidence: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        "Required only for single-raster output. Quote the user's explicit request for a single flattened image; the host verifies it against the current prompt.",
    },
  },
  required: [
    "pageId",
    "deliverable",
    "objective",
    "outputMode",
    "artboard",
    "composition",
    "visualSystem",
    "rasterAssetRoles",
    "editableLayers",
    "implementationSteps",
    "validationChecks",
  ],
  additionalProperties: false,
} as const;

const MODEL_VISUAL_REVIEW_SCHEMA = {
  type: "object",
  description:
    "A concrete critique of the most recent rendered canvas capture. Every field must identify what the image actually shows and refinements must be actionable edits, not generic praise.",
  properties: {
    composition: { type: "string", minLength: 12, maxLength: 1_000 },
    hierarchy: { type: "string", minLength: 12, maxLength: 1_000 },
    typography: { type: "string", minLength: 12, maxLength: 1_000 },
    assetIntegration: { type: "string", minLength: 12, maxLength: 1_000 },
    formAndSurface: { type: "string", minLength: 12, maxLength: 1_000 },
    effects: { type: "string", minLength: 12, maxLength: 1_000 },
    refinements: {
      type: "array",
      minItems: 2,
      maxItems: 12,
      items: { type: "string", minLength: 8, maxLength: 500 },
    },
  },
  required: [
    "composition",
    "hierarchy",
    "typography",
    "assetIntegration",
    "formAndSurface",
    "effects",
    "refinements",
  ],
  additionalProperties: false,
} as const;

export const DESIGN_AGENT_TOOL_SPECS = [
  {
    name: DESIGN_CAPABILITIES_TOOL_NAME,
    description:
      "Read the trusted, versioned OpenDesign professional design capability manifest. It reports available, degraded, and unavailable workflows across contract, runtime, human UI, Agent, render, and export surfaces, including providers, limitations, and evidence counts. Call this before planning work that may require Pen editing, boolean operations, Auto Layout, components, variables, rich typography, image crop, AI image editing, or export.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_INSPECT_TOOL_NAME,
    description:
      "Read the currently bound OpenDesign Design File, active Page, node tree, referenced asset metadata, selection, revision, and bounded structural/render diagnostics before planning a design change. Diagnostics identify empty paths/text, invisible nodes, missing assets, non-finite or clipped-out bounds, root-layer fragmentation, and actual Path/gradient/glow/blur/blend/mask/image/text usage. Asset source bytes and URIs are intentionally omitted; use opendesign_capture_canvas for bounded visual inspection. This does not inspect project files, source code, directories, or other Design Files. Call this instead of guessing canvas structure.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_CAPTURE_TOOL_NAME,
    description:
      "Capture the currently bound OpenDesign canvas viewport as a bounded image and return it as multimodal content. Use this after a material design write to evaluate the rendered composition, hierarchy, spacing, proportions, and effects before claiming visual quality. This captures only the active design canvas; it does not capture other applications, windows, files, or screens.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_PLAN_TOOL_NAME,
    description:
      "Define the executable visual plan for the current Page after inspection and before generating imagery or creating new design layers. The plan fixes the deliverable, artboard Frame and dimensions, composition hierarchy, spacing, palette, typography, effects, editable layers, raster asset roles, implementation steps, and rendered validation checks. Posters default to editable-composition and must live inside the named Frame. single-raster is allowed only when singleRasterEvidence exactly quotes an explicit request in the current user prompt. This tool records Run planning state; it does not mutate the canvas.",
    inputSchema: MODEL_DESIGN_PLAN_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_REVIEW_TOOL_NAME,
    description:
      "Record a structured critique of the most recent opendesign_capture_canvas result before refining a material draft. Evaluate the rendered composition, hierarchy, typography, asset integration, form/surface, and effects, then name at least two concrete refinements. Do not submit generic praise. The host rejects a review when no newer canvas capture exists. This records Run review state and does not mutate the canvas.",
    inputSchema: MODEL_VISUAL_REVIEW_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: READ_IMAGE_TOOL_NAME,
    description:
      "Read an image that the user explicitly referenced in the current prompt or attached to the current run. source must be the exact attachment ID, absolute local path, file URL, or HTTP(S) image URL written by the user. The host resolves it as a bounded, content-addressed image attachment and returns multimodal content. This tool cannot enumerate directories, discover neighboring files, use browser cookies, or read an unmentioned source.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", minLength: 1, maxLength: 4_096 },
      },
      required: ["source"],
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: GENERATE_IMAGE_TOOL_NAME,
    description:
      "Generate one original raster image with OpenDesign's globally configured image-generation model. A successful opendesign_define_design_plan call must already declare the exact role as reference, background, hero, supporting-content, or final-single-image. This selection is application-wide and independent of the current conversation model. The result is a content-addressed image attachment; call opendesign_place_image only for a declared placeable role. The tool never accepts a provider or model ID and fails explicitly when no global image-generation model is configured.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 32_000 },
        role: {
          enum: [
            "reference",
            "background",
            "hero",
            "supporting-content",
            "final-single-image",
          ],
        },
        size: {
          type: "string",
          pattern: "^(auto|[1-9][0-9]{2,3}x[1-9][0-9]{2,3})$",
          description:
            "Output resolution. Popular values include 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, 2160x3840, and auto.",
        },
        quality: { enum: ["auto", "low", "medium", "high"] },
        outputFormat: { enum: ["png", "jpeg", "webp"] },
      },
      required: ["prompt", "role"],
      additionalProperties: false,
    },
    risk: "external" as const,
    approval: "never" as const,
  },
  {
    name: PLACE_IMAGE_TOOL_NAME,
    description:
      "Place an image attachment returned by opendesign_read_image, opendesign_generate_image, or explicitly attached by the user into the currently bound Design File. A successful design plan must declare the image role. Editable posters must place the image inside their planned artboard Frame and cannot use final-single-image. The host imports the approved attachment as a durable project image asset and inserts one image node through the same atomic OpenDesign transaction and revision history as every other design edit.",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: {
          type: "string",
          pattern: "^image_[a-f0-9]{64}$",
        },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        parentId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 256 },
            { type: "null" },
          ],
        },
        index: { type: "integer", minimum: 0 },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        role: {
          enum: [
            "background",
            "hero",
            "supporting-content",
            "final-single-image",
          ],
        },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        placement: MODEL_NODE_KIND_PROPERTIES_SCHEMA.properties.placement,
      },
      required: [
        "attachmentId",
        "pageId",
        "parentId",
        "index",
        "nodeId",
        "name",
        "role",
        "x",
        "y",
      ],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: UPDATE_IMAGE_TOOL_NAME,
    description:
      "Update one existing Image node through OpenDesign's non-destructive image workflow. set-placement switches Stretch/Fit/Fill/Crop or changes normalized focal point, crop zoom, rotation, and flips without modifying the source asset. replace-source consumes an image attachment already authorized for this run, creates a new durable content-addressed asset, preserves the existing placement unless a replacement placement is supplied, and atomically updates the node. Targets are explicit Page and node IDs returned by inspection, never the live selection. This tool does not perform pixel generation, inpainting, background removal, or destructive file edits.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          enum: ["set-placement", "replace-source"],
          description:
            "set-placement requires placement; replace-source requires attachmentId and may also provide placement.",
        },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        attachmentId: {
          type: "string",
          pattern: "^image_[a-f0-9]{64}$",
          description: "Required only for replace-source.",
        },
        placement: {
          ...MODEL_NODE_KIND_PROPERTIES_SCHEMA.properties.placement,
          description:
            "Required for set-placement and optional for replace-source.",
        },
      },
      required: ["action", "label", "pageId", "nodeId"],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: IMPORT_SVG_TOOL_NAME,
    description:
      "Import one SVG attachment explicitly authorized for the current Run as an editable OpenDesign vector tree of supported layers. The supported subset preserves Frame/Group hierarchy, basic vectors, gradients, rounded Frame clipping, ordered sibling masks, and bounded filter effects; unsupported semantics return explicit fidelity issues. attachmentId must be a run-scoped svg_<sha256> handle shown in the user's attachment metadata; SVG XML and local paths are never accepted. pageId, parentId, and index must be stable targets returned by opendesign_inspect_document. x and y place the imported SVG's top-left corner in the local coordinate system of that Page root, Frame, or Group. The tool never reads the live user selection or viewport. Main materializes the authorized SVG only after validation, Renderer parses it in the same cancellable SVG worker as manual import, and the host previews and applies one atomic undoable EditorRuntime transaction, selects the imported root, and reports explicit fidelity issues.",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: {
          type: "string",
          pattern: "^svg_[a-f0-9]{64}$",
        },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        parentId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 256 },
            { type: "null" },
          ],
        },
        index: { type: "integer", minimum: 0 },
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["attachmentId", "pageId", "parentId", "index", "x", "y"],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: EXPORT_SVG_TOOL_NAME,
    description:
      "Export explicit existing layers from the currently bound Design File as one SVG through OpenDesign's versioned interchange service. The supported subset preserves Frame/Group hierarchy, basic vectors, gradients, rounded Frame clipping, ordered sibling masks, and bounded filter effects. pageId and rootNodeIds must be stable IDs returned by opendesign_inspect_document; the tool never reads the live user selection. It freezes the current revision, resolves Boolean geometry in a cancellable Renderer worker, reports fidelity limitations, and opens the native save dialog owned by Main. Call this only when the user explicitly asks to export or deliver SVG. The user chooses or cancels the destination; the model never receives a local path. Only implemented includeLayerIds and padding settings are exposed. Text, images, unsupported effects or combined mask graphs, angular gradients, multiple paints, inside/outside strokes, and Boolean source operands may be rejected, omitted, or flattened with explicit fidelity notes.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        rootNodeIds: {
          type: "array",
          minItems: 1,
          maxItems: 512,
          uniqueItems: true,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        suggestedName: {
          type: "string",
          minLength: 1,
          maxLength: 255,
          description:
            "Portable file name only, never a path. OpenDesign appends .svg when needed.",
        },
        includeLayerIds: { type: "boolean" },
        padding: { type: "number", minimum: 0, maximum: 100_000 },
      },
      required: ["pageId", "rootNodeIds", "suggestedName"],
      additionalProperties: false,
    },
    risk: "external" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_HIERARCHY_TOOL_NAME,
    description:
      "Edit existing layer hierarchy and non-destructive Boolean groups in the currently bound Design File without asking the model to calculate low-level move commands, transforms, or derived paths. It can group siblings, ungroup one Group, create union/subtract/intersect/exclude from explicit supported siblings, change a Boolean operation, ungroup one Boolean, reorder siblings, or reparent layers to an explicit Page-root, Frame, or Group insertion index. Source Boolean operands remain editable and the provider-derived result is never model-authored or persisted. Reparenting preserves world transforms and dynamically recomputes affected Group bounds; Frame sizes remain fixed. Targets are explicit stable node IDs on an explicit existing Page, never the send-time or live user selection. The host previews the complete change and applies it as one atomic undoable OpenDesign transaction. It rejects locked layers, mixed parents, stale revisions, out-of-scope nodes, duplicate IDs, unsupported or masked Boolean operands, cycles, empty source Groups, non-invertible targets, no-op changes, and visually lossy ungrouping; inherited clipping or appearance changes return a visual-review warning.",
    inputSchema: MODEL_HIERARCHY_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_ARRANGE_TOOL_NAME,
    description:
      "Precisely arrange explicit existing layers in the currently bound Design File using host-computed geometry. It aligns selection bounds, distributes horizontal or vertical spacing while preserving the two outermost layers, or sets an exact positive, zero, or negative 1D spacing from the leading layer. The host handles rotated/scaled parent transforms, dynamically recomputes affected Group bounds, previews the complete change, and applies one atomic undoable transaction. Targets are stable Page and layer IDs returned by inspection, never the send-time or live user selection. It rejects locked, missing, stale, out-of-scope, non-invertible, ambiguous, no-op, and over-limit operations. This is deterministic 1D arrangement, not 2D Tidy up or Auto Layout.",
    inputSchema: MODEL_ARRANGE_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_APPLY_TOOL_NAME,
    description:
      "Apply one validated, atomic OpenDesign node transaction to the currently bound Design File and an existing Page. Supports insert_element, update_properties, move_element, delete_element, and replace_subtree. For editable organic silhouettes, mascots, logos, custom icons, wings, limbs, fabric, and other non-geometric contours, use path or vector nodes with properties.network: stable vertices, cubic segment tangents, ordered path runs, and closed fill regions. The current editable product slice should use one non-branching path run; a closed run needs one matching region, while an open run must have no fill. Existing-node point editing, branch authoring, and multiple contours are not yet available. Use properties.path only when exact imported SVG path data must be preserved and node-level point editing is not required; never provide path and network together. Both geometry forms support the same fills, strokes, gradients, effects, and advanced stroke fields. Coordinates are local to the node and must fit its declared size. Composite designs should create a named Frame or Group before inserting its children later in the same ordered transaction; do not flatten their parts into Page-root layers. It does not create, rename, duplicate, or delete Projects, Design Files, or Pages. Use stable unique IDs for new nodes and command IDs. The host supplies document identity, base revision, and Agent actor; never place them in the input.",
    inputSchema: {
      ...MODEL_APPLY_TRANSACTION_SCHEMA,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
] as const;

export function validateDesignAgentToolInput(
  toolName: string,
  input: unknown,
): boolean {
  if (toolName === DESIGN_CAPABILITIES_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_INSPECT_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_CAPTURE_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_PLAN_TOOL_NAME) return isDesignPlanToolInput(input);
  if (toolName === DESIGN_REVIEW_TOOL_NAME) {
    return isDesignVisualReviewToolInput(input);
  }
  if (toolName === READ_IMAGE_TOOL_NAME) {
    return (
      isRecord(input) &&
      typeof input.source === "string" &&
      input.source.length > 0 &&
      input.source.length <= 4_096 &&
      Object.keys(input).every((key) => key === "source")
    );
  }
  if (toolName === GENERATE_IMAGE_TOOL_NAME) {
    return isGenerateImageToolInput(input);
  }
  if (toolName === PLACE_IMAGE_TOOL_NAME) return isPlaceImageToolInput(input);
  if (toolName === UPDATE_IMAGE_TOOL_NAME) return isUpdateImageToolInput(input);
  if (toolName === IMPORT_SVG_TOOL_NAME) return isImportSvgToolInput(input);
  if (toolName === EXPORT_SVG_TOOL_NAME) return isExportSvgToolInput(input);
  if (toolName === INTERNAL_IMPORT_SVG_TOOL_NAME) {
    return isInternalImportSvgToolInput(input);
  }
  if (toolName === INTERNAL_UPDATE_IMAGE_TOOL_NAME) {
    return isInternalUpdateImageToolInput(input);
  }
  if (toolName === DESIGN_HIERARCHY_TOOL_NAME) {
    return isDesignHierarchyToolInput(input);
  }
  if (toolName === DESIGN_ARRANGE_TOOL_NAME) {
    return isDesignArrangeToolInput(input);
  }
  if (
    (toolName !== DESIGN_APPLY_TOOL_NAME &&
      toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME) ||
    !isRecord(input)
  ) {
    return false;
  }
  const internal = toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME;
  return (
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    (input.summary === undefined ||
      (typeof input.summary === "string" && input.summary.length <= 2_000)) &&
    Array.isArray(input.commands) &&
    input.commands.length > 0 &&
    input.commands.length <= 1_000 &&
    input.commands.every((command) => {
      if (!isDesignOperation(command)) return false;
      return (
        internal ||
        (command.type !== "put_asset" && command.type !== "delete_asset")
      );
    }) &&
    Object.keys(input).every((key) =>
      ["label", "summary", "commands"].includes(key),
    )
  );
}

export function isReadImageToolInput(
  input: unknown,
): input is ReadImageToolInput {
  return validateDesignAgentToolInput(READ_IMAGE_TOOL_NAME, input);
}

export function isGenerateImageToolInput(
  input: unknown,
): input is GenerateImageToolInput {
  if (!isRecord(input)) return false;
  const allowed = ["prompt", "role", "size", "quality", "outputFormat"];
  return (
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    input.prompt.length <= 32_000 &&
    isRasterAssetRole(input.role) &&
    (input.size === undefined || isImageGenerationSize(input.size)) &&
    (input.quality === undefined ||
      input.quality === "auto" ||
      input.quality === "low" ||
      input.quality === "medium" ||
      input.quality === "high") &&
    (input.outputFormat === undefined ||
      input.outputFormat === "png" ||
      input.outputFormat === "jpeg" ||
      input.outputFormat === "webp") &&
    Object.keys(input).every((key) => allowed.includes(key))
  );
}

export function isPlaceImageToolInput(
  input: unknown,
): input is PlaceImageToolInput {
  if (!isRecord(input)) return false;
  const allowed = [
    "attachmentId",
    "pageId",
    "parentId",
    "index",
    "nodeId",
    "name",
    "role",
    "x",
    "y",
    "width",
    "height",
    "placement",
  ];
  return (
    typeof input.attachmentId === "string" &&
    /^image_[a-f0-9]{64}$/.test(input.attachmentId) &&
    safeId(input.pageId) &&
    (input.parentId === null || safeId(input.parentId)) &&
    Number.isInteger(input.index) &&
    Number(input.index) >= 0 &&
    safeId(input.nodeId) &&
    typeof input.name === "string" &&
    input.name.length > 0 &&
    input.name.length <= 256 &&
    isPlaceableRasterAssetRole(input.role) &&
    finite(input.x) &&
    finite(input.y) &&
    (input.width === undefined || positive(input.width)) &&
    (input.height === undefined || positive(input.height)) &&
    (input.placement === undefined || isImagePlacement(input.placement)) &&
    Object.keys(input).every((key) => allowed.includes(key))
  );
}

export function isUpdateImageToolInput(
  input: unknown,
): input is UpdateImageToolInput {
  if (!isRecord(input)) return false;
  const common =
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId) &&
    safeId(input.nodeId);
  if (!common) return false;
  if (input.action === "set-placement") {
    return (
      isImagePlacement(input.placement) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeId", "placement"].includes(key),
      )
    );
  }
  if (input.action === "replace-source") {
    return (
      typeof input.attachmentId === "string" &&
      /^image_[a-f0-9]{64}$/.test(input.attachmentId) &&
      (input.placement === undefined || isImagePlacement(input.placement)) &&
      Object.keys(input).every((key) =>
        [
          "action",
          "label",
          "pageId",
          "nodeId",
          "attachmentId",
          "placement",
        ].includes(key),
      )
    );
  }
  return false;
}

export function isExportSvgToolInput(
  input: unknown,
): input is ExportSvgToolInput {
  if (!isRecord(input)) return false;
  return (
    safeId(input.pageId) &&
    Array.isArray(input.rootNodeIds) &&
    input.rootNodeIds.length > 0 &&
    input.rootNodeIds.length <= 512 &&
    input.rootNodeIds.every(safeId) &&
    new Set(input.rootNodeIds).size === input.rootNodeIds.length &&
    isPortableFileName(input.suggestedName) &&
    (input.includeLayerIds === undefined ||
      typeof input.includeLayerIds === "boolean") &&
    (input.padding === undefined ||
      (finite(input.padding) &&
        input.padding >= 0 &&
        input.padding <= 100_000)) &&
    Object.keys(input).every((key) =>
      [
        "pageId",
        "rootNodeIds",
        "suggestedName",
        "includeLayerIds",
        "padding",
      ].includes(key),
    )
  );
}

export function isImportSvgToolInput(
  input: unknown,
): input is ImportSvgToolInput {
  if (!isRecord(input)) return false;
  return (
    typeof input.attachmentId === "string" &&
    /^svg_[a-f0-9]{64}$/.test(input.attachmentId) &&
    safeId(input.pageId) &&
    (input.parentId === null || safeId(input.parentId)) &&
    Number.isInteger(input.index) &&
    Number(input.index) >= 0 &&
    finite(input.x) &&
    finite(input.y) &&
    exactKeys(input, ["attachmentId", "pageId", "parentId", "index", "x", "y"])
  );
}

export function isInternalImportSvgToolInput(
  input: unknown,
): input is InternalImportSvgToolInput {
  if (!isRecord(input)) return false;
  const publicInput = {
    attachmentId: input.attachmentId,
    pageId: input.pageId,
    parentId: input.parentId,
    index: input.index,
    x: input.x,
    y: input.y,
  };
  return (
    isImportSvgToolInput(publicInput) &&
    boundedText(input.name, 255) &&
    typeof input.svg === "string" &&
    input.svg.length > 0 &&
    input.svg.length <= SVG_MAX_CHARACTERS &&
    typeof input.idPrefix === "string" &&
    input.idPrefix.length <= 80 &&
    /^[A-Za-z][A-Za-z0-9_-]*$/.test(input.idPrefix) &&
    exactKeys(input, [
      "attachmentId",
      "pageId",
      "parentId",
      "index",
      "x",
      "y",
      "name",
      "svg",
      "idPrefix",
    ])
  );
}

export function isAgentSvgImportResult(
  value: unknown,
): value is AgentSvgImportResult {
  if (!isRecord(value)) return false;
  return (
    value.kind === "svg-import-result" &&
    value.version === 1 &&
    value.ok === true &&
    value.format === "svg" &&
    typeof value.attachmentId === "string" &&
    /^svg_[a-f0-9]{64}$/.test(value.attachmentId) &&
    boundedText(value.name, 255) &&
    safeId(value.pageId) &&
    (value.parentId === null || safeId(value.parentId)) &&
    safeId(value.rootNodeId) &&
    Array.isArray(value.importedNodeIds) &&
    value.importedNodeIds.length > 0 &&
    value.importedNodeIds.length <= 10_000 &&
    value.importedNodeIds.every(safeId) &&
    new Set(value.importedNodeIds).size === value.importedNodeIds.length &&
    value.importedNodeIds.includes(value.rootNodeId) &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 1 &&
    value.atomic === true &&
    Array.isArray(value.issues) &&
    value.issues.length <= 1_000 &&
    value.issues.every(isSvgInterchangeIssue) &&
    exactKeys(value, [
      "kind",
      "version",
      "ok",
      "format",
      "attachmentId",
      "name",
      "pageId",
      "parentId",
      "rootNodeId",
      "importedNodeIds",
      "revision",
      "atomic",
      "issues",
    ])
  );
}

export function isPreparedAgentSvgExport(
  value: unknown,
): value is PreparedAgentSvgExport {
  if (!isRecord(value)) return false;
  return (
    value.kind === "svg-export-preparation" &&
    value.version === 1 &&
    isPortableFileName(value.suggestedName) &&
    typeof value.svg === "string" &&
    value.svg.length > 0 &&
    value.svg.length <= SVG_MAX_CHARACTERS &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    Array.isArray(value.exportedNodeIds) &&
    value.exportedNodeIds.length > 0 &&
    value.exportedNodeIds.length <= 10_000 &&
    value.exportedNodeIds.every(safeId) &&
    new Set(value.exportedNodeIds).size === value.exportedNodeIds.length &&
    Array.isArray(value.issues) &&
    value.issues.length <= 1_000 &&
    value.issues.every(isSvgInterchangeIssue) &&
    exactKeys(value, [
      "kind",
      "version",
      "suggestedName",
      "svg",
      "revision",
      "exportedNodeIds",
      "issues",
    ])
  );
}

export function isInternalUpdateImageToolInput(
  input: unknown,
): input is InternalUpdateImageToolInput {
  if (!isRecord(input)) return false;
  const common =
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId) &&
    safeId(input.nodeId);
  if (!common) return false;
  if (input.action === "set-placement") {
    return (
      isImagePlacement(input.placement) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeId", "placement"].includes(key),
      )
    );
  }
  if (input.action !== "replace-source") return false;
  return (
    isBoundedEmbeddedImageAsset(input.asset) &&
    (input.placement === undefined || isImagePlacement(input.placement)) &&
    Object.keys(input).every((key) =>
      ["action", "label", "pageId", "nodeId", "asset", "placement"].includes(
        key,
      ),
    )
  );
}

export function isDesignPlanToolInput(
  input: unknown,
): input is DesignPlanToolInput {
  if (!isRecord(input)) return false;
  const allowed = [
    "pageId",
    "deliverable",
    "objective",
    "outputMode",
    "artboard",
    "composition",
    "visualSystem",
    "rasterAssetRoles",
    "editableLayers",
    "implementationSteps",
    "validationChecks",
    "singleRasterEvidence",
  ];
  if (
    !safeId(input.pageId) ||
    !isDesignDeliverable(input.deliverable) ||
    !boundedText(input.objective, 2_000) ||
    (input.outputMode !== "editable-composition" &&
      input.outputMode !== "single-raster") ||
    !isRecord(input.artboard) ||
    (input.artboard.mode !== "create" && input.artboard.mode !== "existing") ||
    !safeId(input.artboard.frameId) ||
    !positiveBounded(input.artboard.width, 100_000) ||
    !positiveBounded(input.artboard.height, 100_000) ||
    !exactKeys(input.artboard, ["mode", "frameId", "width", "height"]) ||
    !isRecord(input.composition) ||
    !boundedText(input.composition.direction, 1_000) ||
    !boundedTextArray(input.composition.hierarchy, 2, 16, 256) ||
    !boundedText(input.composition.assetIntegration, 1_000) ||
    !boundedText(input.composition.spacingRhythm, 500) ||
    !exactKeys(input.composition, [
      "direction",
      "hierarchy",
      "assetIntegration",
      "spacingRhythm",
    ]) ||
    !isRecord(input.visualSystem) ||
    !boundedTextArray(input.visualSystem.avoidances, 2, 12, 256) ||
    !boundedText(input.visualSystem.formLanguage, 1_000) ||
    !boundedTextArray(input.visualSystem.palette, 1, 12, 128) ||
    !boundedText(input.visualSystem.surfaceAndDepth, 1_000) ||
    !boundedTextArray(input.visualSystem.typography, 1, 8, 256) ||
    !boundedTextArray(input.visualSystem.effects, 0, 12, 256) ||
    !exactKeys(input.visualSystem, [
      "avoidances",
      "formLanguage",
      "palette",
      "surfaceAndDepth",
      "typography",
      "effects",
    ]) ||
    !Array.isArray(input.rasterAssetRoles) ||
    input.rasterAssetRoles.length > 5 ||
    !input.rasterAssetRoles.every(isRasterAssetRole) ||
    new Set(input.rasterAssetRoles).size !== input.rasterAssetRoles.length ||
    !boundedTextArray(input.editableLayers, 2, 24, 256) ||
    !boundedTextArray(input.implementationSteps, 2, 16, 500) ||
    !boundedTextArray(input.validationChecks, 2, 16, 500) ||
    !Object.keys(input).every((key) => allowed.includes(key))
  ) {
    return false;
  }
  if (input.outputMode === "single-raster") {
    return (
      boundedText(input.singleRasterEvidence, 200) &&
      input.rasterAssetRoles.includes("final-single-image")
    );
  }
  return (
    input.singleRasterEvidence === undefined &&
    !input.rasterAssetRoles.includes("final-single-image")
  );
}

export function isDesignVisualReviewToolInput(
  input: unknown,
): input is DesignVisualReviewToolInput {
  return (
    isRecord(input) &&
    substantiveReviewText(input.composition) &&
    substantiveReviewText(input.hierarchy) &&
    substantiveReviewText(input.typography) &&
    substantiveReviewText(input.assetIntegration) &&
    substantiveReviewText(input.formAndSurface) &&
    substantiveReviewText(input.effects) &&
    boundedTextArray(input.refinements, 2, 12, 500) &&
    input.refinements.every((item) => item.trim().length >= 8) &&
    exactKeys(input, [
      "composition",
      "hierarchy",
      "typography",
      "assetIntegration",
      "formAndSurface",
      "effects",
      "refinements",
    ])
  );
}

export function designApplyRequiresPlan(input: DesignApplyToolInput): boolean {
  return input.commands.some(
    (command) =>
      command.type === "insert_element" || command.type === "replace_subtree",
  );
}

export function isDesignApplyToolInput(
  input: unknown,
): input is DesignApplyToolInput {
  return validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input);
}

export function isDesignHierarchyToolInput(
  input: unknown,
): input is DesignHierarchyToolInput {
  if (!isRecord(input)) return false;
  const common =
    (input.action === "group" ||
      input.action === "ungroup" ||
      input.action === "create-boolean" ||
      input.action === "set-boolean-operation" ||
      input.action === "ungroup-boolean" ||
      input.action === "reorder" ||
      input.action === "reparent") &&
    typeof input.label === "string" &&
    input.label.trim().length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId);
  if (!common) return false;
  if (input.action === "set-boolean-operation") {
    return (
      safeId(input.booleanId) &&
      isBooleanOperation(input.operation) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "booleanId", "operation"].includes(key),
      )
    );
  }
  if (input.action === "ungroup-boolean") {
    return (
      safeId(input.booleanId) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "booleanId"].includes(key),
      )
    );
  }
  if (input.action === "create-boolean") {
    return (
      safeId(input.booleanId) &&
      typeof input.name === "string" &&
      input.name.trim().length > 0 &&
      input.name.length <= 256 &&
      isBooleanOperation(input.operation) &&
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 2 &&
      input.nodeIds.length <= 249 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      Object.keys(input).every((key) =>
        [
          "action",
          "label",
          "pageId",
          "nodeIds",
          "booleanId",
          "name",
          "operation",
        ].includes(key),
      )
    );
  }
  if (input.action === "ungroup") {
    return (
      safeId(input.groupId) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "groupId"].includes(key),
      )
    );
  }
  if (input.action === "reorder") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      (input.order === "bring-forward" ||
        input.order === "bring-to-front" ||
        input.order === "send-backward" ||
        input.order === "send-to-back") &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeIds", "order"].includes(key),
      )
    );
  }
  if (input.action === "reparent") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      (input.parentId === null || safeId(input.parentId)) &&
      Number.isInteger(input.index) &&
      Number(input.index) >= 0 &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeIds", "parentId", "index"].includes(
          key,
        ),
      )
    );
  }
  return (
    safeId(input.groupId) &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    input.name.length <= 256 &&
    Array.isArray(input.nodeIds) &&
    input.nodeIds.length >= 2 &&
    input.nodeIds.length <= 249 &&
    input.nodeIds.every(safeId) &&
    new Set(input.nodeIds).size === input.nodeIds.length &&
    Object.keys(input).every((key) =>
      ["action", "label", "pageId", "nodeIds", "groupId", "name"].includes(key),
    )
  );
}

function isBooleanOperation(value: unknown): value is BooleanOperation {
  return (
    value === "union" ||
    value === "subtract" ||
    value === "intersect" ||
    value === "exclude"
  );
}

export function isDesignArrangeToolInput(
  input: unknown,
): input is DesignArrangeToolInput {
  if (!isRecord(input)) return false;
  const action = input.action;
  const actions = [
    "align-left",
    "align-horizontal-center",
    "align-right",
    "align-top",
    "align-vertical-center",
    "align-bottom",
    "distribute-horizontal",
    "distribute-vertical",
    "set-horizontal-spacing",
    "set-vertical-spacing",
  ] as const;
  if (!actions.includes(action as (typeof actions)[number])) return false;
  const setSpacing =
    action === "set-horizontal-spacing" || action === "set-vertical-spacing";
  const distribute =
    action === "distribute-horizontal" || action === "distribute-vertical";
  return (
    typeof input.label === "string" &&
    input.label.trim().length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId) &&
    Array.isArray(input.nodeIds) &&
    input.nodeIds.length >= (distribute ? 3 : 2) &&
    input.nodeIds.length <= 500 &&
    input.nodeIds.every(safeId) &&
    new Set(input.nodeIds).size === input.nodeIds.length &&
    (setSpacing
      ? finite(input.spacing) && Math.abs(Number(input.spacing)) <= 1_000_000
      : input.spacing === undefined) &&
    Object.keys(input).every((key) =>
      (setSpacing
        ? ["action", "label", "pageId", "nodeIds", "spacing"]
        : ["action", "label", "pageId", "nodeIds"]
      ).includes(key),
    )
  );
}

export function isInternalDesignApplyToolInput(
  input: unknown,
): input is DesignApplyToolInput {
  return validateDesignAgentToolInput(INTERNAL_DESIGN_APPLY_TOOL_NAME, input);
}

function isBoundedEmbeddedImageAsset(value: unknown): value is DesignAsset {
  if (!isDesignAsset(value) || value.kind !== "image") return false;
  return (
    /^asset_[a-f0-9]{64}$/.test(value.id) &&
    /^(?:image\/png|image\/jpeg|image\/webp|image\/gif)$/.test(
      value.mimeType ?? "",
    ) &&
    value.source.type === "data" &&
    value.source.value.length > 0 &&
    value.source.value.length <= 24_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(value.source.value) &&
    value.size !== undefined &&
    value.size.width > 0 &&
    value.size.height > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function positiveBounded(value: unknown, maximum: number): value is number {
  return positive(value) && value <= maximum;
}

function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function substantiveReviewText(value: unknown): value is string {
  if (!boundedText(value, 1_000) || value.trim().length < 12) return false;
  return !/^(?:looks? good|fine|great|okay|ok|no issues?|很好|不错|没问题|可以|正常)[.!。！\s]*$/i.test(
    value.trim(),
  );
}

function boundedTextArray(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumTextLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= maximumItems &&
    value.every((item) => boundedText(item, maximumTextLength))
  );
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isDesignDeliverable(value: unknown): value is DesignDeliverable {
  return (
    value === "ui" ||
    value === "poster" ||
    value === "logo" ||
    value === "brand-asset" ||
    value === "illustration" ||
    value === "presentation-visual" ||
    value === "other"
  );
}

function isRasterAssetRole(value: unknown): value is RasterAssetRole {
  return (
    value === "reference" ||
    value === "background" ||
    value === "hero" ||
    value === "supporting-content" ||
    value === "final-single-image"
  );
}

function isPlaceableRasterAssetRole(
  value: unknown,
): value is PlaceableRasterAssetRole {
  return isRasterAssetRole(value) && value !== "reference";
}

function isImageGenerationSize(value: unknown): value is ImageGenerationSize {
  if (value === "auto") return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  return (
    shortEdge >= 256 &&
    longEdge <= 4_096 &&
    longEdge / shortEdge <= 4 &&
    pixels <= 16_777_216
  );
}
