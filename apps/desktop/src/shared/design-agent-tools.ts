import {
  isDesignAsset,
  isImagePlacement,
  type BooleanOperation,
  type DesignAsset,
  type ImagePlacement,
  type Point,
} from "@opendesign/design-contracts";
import {
  isSvgInterchangeIssue,
  type SvgInterchangeIssue,
} from "@opendesign/import-export-service/svg-issues";
import { SVG_MAX_CHARACTERS } from "@opendesign/import-export-service/limits";
import {
  RASTER_EXPORT_MAX_ENCODED_BYTES,
  RASTER_EXPORT_VERSION,
  isRasterExportRequest,
  rasterExportMimeType,
  type RasterExportBackground,
  type RasterExportFormat,
  type RasterExportMimeType,
  type RasterExportResampling,
  type RasterExportSize,
} from "@opendesign/import-export-service/raster";
import { isPortableFileName } from "./portable-file-name";
import { DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA } from "./design-bootstrap-apply-schema";
import {
  isInternalDesignApplyToolInput,
  normalizeDesignApplyToolInput,
  type DesignApplyToolInput,
} from "./design-apply-input";
import {
  DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
  isDesignArrangeToolInput,
} from "./design-arrange-tool";
import {
  componentStrategyOccurrencesForTarget,
  DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA,
  isDesignPlanComponentStrategy,
  type DesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
import {
  explainInvalidDesignComponentToolInput,
  isDesignComponentToolInput,
} from "./design-component-tool";
import { isDesignVariableToolInput } from "./design-variable-tool";
import { DESIGN_VARIABLE_TOOL_INPUT_SCHEMA } from "./design-variable-tool-schema";
import { isDesignStyleToolInput } from "./design-style-tool";
import { DESIGN_STYLE_TOOL_INPUT_SCHEMA } from "./design-style-tool-schema";
export {
  isDesignApplyToolInput,
  isInternalDesignApplyToolInput,
  normalizeDesignApplyToolInput,
} from "./design-apply-input";
export { DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA } from "./design-bootstrap-apply-schema";
export type {
  DesignApplyToolInput,
  InternalDesignApplyToolInput,
  PlannedDesignRebaseGuard,
  PlannedDesignRebaseTarget,
} from "./design-apply-input";
export { isDesignArrangeToolInput } from "./design-arrange-tool";
export type { DesignArrangeToolInput } from "./design-arrange-tool";
export {
  componentStrategyOccurrencesForTarget,
  isDesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
export {
  explainInvalidDesignComponentToolInput,
  isDesignComponentToolInput,
} from "./design-component-tool";
export type { DesignComponentToolInput } from "./design-component-tool";
export { isDesignVariableToolInput } from "./design-variable-tool";
export type { DesignVariableToolInput } from "./design-variable-tool";
export { isDesignStyleToolInput } from "./design-style-tool";
export type { DesignStyleToolInput } from "./design-style-tool";
export type {
  DesignPlanComponentCandidate,
  DesignPlanComponentStrategy,
  DesignPlanSemanticOccurrence,
} from "./design-plan-component-strategy";
export const DESIGN_CAPABILITIES_TOOL_NAME = "opendesign_get_capabilities";
export const DESIGN_INSPECT_TOOL_NAME = "opendesign_inspect_document";
export const DESIGN_CAPTURE_TOOL_NAME = "opendesign_capture_canvas";
export const DESIGN_PLAN_TOOL_NAME = "opendesign_define_design_plan";
export const DESIGN_REVIEW_TOOL_NAME = "opendesign_record_visual_review";
export const DESIGN_APPLY_TOOL_NAME = "opendesign_apply_transaction";
export const DESIGN_HIERARCHY_TOOL_NAME = "opendesign_edit_hierarchy";
export const DESIGN_ARRANGE_TOOL_NAME = "opendesign_arrange_layers";
export const DESIGN_VECTOR_TOOL_NAME = "opendesign_edit_vector";
export const DESIGN_PAGE_TOOL_NAME = "opendesign_manage_pages";
export const DESIGN_COMPONENT_TOOL_NAME = "opendesign_manage_components";
export const DESIGN_VARIABLE_TOOL_NAME = "opendesign_manage_variables";
export const DESIGN_STYLE_TOOL_NAME = "opendesign_manage_styles";
export const PAGE_STRUCTURE_ACCESS_TOOL_NAME =
  "opendesign_request_page_structure_access";
export const READ_IMAGE_TOOL_NAME = "opendesign_read_image";
export const GENERATE_IMAGE_TOOL_NAME = "opendesign_generate_image";
export const PLACE_IMAGE_TOOL_NAME = "opendesign_place_image";
export const UPDATE_IMAGE_TOOL_NAME = "opendesign_update_image";
export const IMPORT_SVG_TOOL_NAME = "opendesign_import_svg";
export const EXPORT_SVG_TOOL_NAME = "opendesign_export_svg";
export const EXPORT_RASTER_TOOL_NAME = "opendesign_export_raster";
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
export type DesignPlanRegionRole =
  | "structure"
  | "content"
  | "typography"
  | "media"
  | "graphic"
  | "decoration"
  | "interaction"
  | "other";
export type DesignPlanRegion = {
  nodeId: string;
  name: string;
  role: DesignPlanRegionRole;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DesignPlanArtboard = {
  mode: "create" | "existing";
  frameId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type DesignPlanComposition = {
  assetIntegration: string;
  direction: string;
  hierarchy: string[];
  regions: DesignPlanRegion[];
  spacingRhythm: string;
};
export type DesignPlanTarget = {
  targetId: string;
  label: string;
  pageId: string;
  objective: string;
  artboard: DesignPlanArtboard;
  composition: DesignPlanComposition;
  editableLayers: string[];
  implementationSteps: string[];
  validationChecks: string[];
};
export type LegacyDesignPlanToolInput = {
  version: 2;
  pageId: string;
  deliverable: DesignDeliverable;
  objective: string;
  outputMode: "editable-composition" | "single-raster";
  artboard: DesignPlanArtboard;
  composition: DesignPlanComposition;
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
export type DesignPlanToolInputV3 = {
  version: 3;
  deliverable: DesignDeliverable;
  objective: string;
  outputMode: "editable-composition" | "single-raster";
  targets: DesignPlanTarget[];
  visualSystem: LegacyDesignPlanToolInput["visualSystem"];
  rasterAssetRoles: RasterAssetRole[];
  singleRasterEvidence?: string;
};
export type DesignPlanToolInputV4 = Omit<DesignPlanToolInputV3, "version"> & {
  version: 4;
  componentStrategy: DesignPlanComponentStrategy;
};
export type DesignPlanToolInput =
  LegacyDesignPlanToolInput | DesignPlanToolInputV3 | DesignPlanToolInputV4;
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

export type ExportRasterToolInput = {
  pageId: string;
  rootNodeId: string;
  suggestedName: string;
  format: RasterExportFormat;
  size: RasterExportSize;
  background: RasterExportBackground;
  quality?: number;
  resampling: RasterExportResampling;
};

export type PreparedAgentRasterExport = {
  kind: "raster-export-preparation";
  version: 1;
  suggestedName: string;
  format: RasterExportFormat;
  mimeType: RasterExportMimeType;
  bytes: Uint8Array;
  width: number;
  height: number;
  revision: number;
  rootNodeId: string;
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

export type DesignPageToolInput =
  | {
      action: "create";
      label: string;
      name: string;
      index?: number;
    }
  | {
      action: "rename";
      label: string;
      pageId: string;
      name: string;
    }
  | {
      action: "duplicate";
      label: string;
      pageId: string;
      name?: string;
      index?: number;
    }
  | {
      action: "reorder";
      label: string;
      pageId: string;
      index: number;
    }
  | {
      action: "delete";
      label: string;
      pageId: string;
    };

export type PageStructureAccessAction =
  | "create-page"
  | "duplicate-page"
  | "reorder-pages"
  | "delete-page"
  | "cross-page-edit";

export type PageStructureAccessToolInput = {
  actions: PageStructureAccessAction[];
  reason: string;
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

export type DesignVectorToolInput =
  | {
      action: "set-closed";
      closed: boolean;
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "reverse-path";
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "cut-path";
      at:
        | { kind: "vertex"; vertexId: string }
        | { kind: "segment"; segmentId: string; t: number };
      label: string;
      nodeId: string;
      pageId: string;
      pathId: string;
    }
  | {
      action: "cut-with-line";
      end: Point;
      label: string;
      nodeId: string;
      pageId: string;
      start: Point;
    }
  | {
      action: "cut-layers-with-line";
      end: Point;
      label: string;
      nodeIds: string[];
      pageId: string;
      start: Point;
    };

// The exhaustive runtime schema stays the trust boundary. This compact model
// schema avoids repeating a 300+ KB node union and remains guidance only.
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

const MODEL_VECTOR_LOCAL_POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    y: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
  },
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
  description:
    "A solid, linear-gradient, radial-gradient, angular-gradient, or image paint. solid requires color; gradients require stops and may use from/to/rotation/stretch; image requires assetId and fit. opacity is always required.",
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
  description:
    "An OpenDesign effect. Shadows require color, opacity, offset, blur, and spread; glows require color, opacity, radius, and spread; blur requires radius; grayscale requires amount.",
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

const MODEL_IMAGE_PLACEMENT_SCHEMA = {
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
        focalPoint: MODEL_NORMALIZED_POINT_SCHEMA,
      },
      required: ["mode", "focalPoint"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "crop" },
        focalPoint: MODEL_NORMALIZED_POINT_SCHEMA,
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
  fontSize: { type: "number", exclusiveMinimum: 0 },
  fontWeight: { type: "integer", minimum: 1, maximum: 1_000 },
  lineHeight: { type: "number", exclusiveMinimum: 0 },
  letterSpacing: { type: "number" },
  textAlignHorizontal: { enum: ["left", "center", "right", "justify"] },
  textAlignVertical: { enum: ["top", "center", "bottom"] },
  textResize: { enum: ["auto-width", "auto-height", "fixed"] },
  textWrap: { enum: ["none", "word", "character"] },
  textOverflow: { enum: ["visible", "clip", "ellipsis"] },
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
    "Properties must match the inspected node kind. Frame requires shape fields, cornerRadius, and clipsContent; Group requires an empty object; Rectangle requires shape fields and cornerRadius; Ellipse requires shape fields; Line requires empty fills, stroke fields, start/end, and endpoints; Polygon/Star require their semantic fields; Text requires typography plus shape fields; Image requires assetId, placement, altText, and cornerRadius; Path/Vector require shape fields and exactly one geometry source. The trusted host validates the complete discriminated node before writing.",
  properties: {
    ...MODEL_SHAPE_PROPERTIES,
    cornerRadius: { type: "number", minimum: 0 },
    clipsContent: { type: "boolean" },
    content: MODEL_TEXT_PROPERTIES.content,
    fontFamily: MODEL_TEXT_PROPERTIES.fontFamily,
    fontSize: MODEL_TEXT_PROPERTIES.fontSize,
    fontWeight: MODEL_TEXT_PROPERTIES.fontWeight,
    lineHeight: MODEL_TEXT_PROPERTIES.lineHeight,
    letterSpacing: MODEL_TEXT_PROPERTIES.letterSpacing,
    textAlignHorizontal: MODEL_TEXT_PROPERTIES.textAlignHorizontal,
    textAlignVertical: MODEL_TEXT_PROPERTIES.textAlignVertical,
    textResize: MODEL_TEXT_PROPERTIES.textResize,
    textWrap: MODEL_TEXT_PROPERTIES.textWrap,
    textOverflow: MODEL_TEXT_PROPERTIES.textOverflow,
    assetId: { type: "string", minLength: 1 },
    placement: MODEL_IMAGE_PLACEMENT_SCHEMA,
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
      items: {
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
      },
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

const MODEL_COMPONENT_SCHEMA = {
  type: "object",
  description:
    "Create and place linked components, combine inspected sibling Component Mains into a Figma-compatible Component Set with explicit unique VARIANT values, author and reorder Boolean/Text/Instance-swap/Slot properties on explicit Main sublayers, edit/reset/clear Slot contents and guidance settings, set/reset typed instance and VARIANT property values, use advanced sourcePath overrides, detach an instance, or locate its Main. Component, set, root, property IDs, and existing property order must come from inspection.",
  properties: {
    action: {
      description:
        "Choose one action. create-component requires exactly action, label, pageId, rootNodeId, componentId, and name; rootNodeId is the existing inspected Frame/Group promoted as the Main.",
      enum: [
        "create-component",
        "create-instance",
        "remove-component",
        "combine-as-variants",
        "add-component-to-variant-set",
        "duplicate-variant",
        "remove-variant",
        "dissolve-variant-set",
        "add-variant-property",
        "rename-variant-property",
        "reorder-variant-properties",
        "remove-variant-property",
        "rename-variant-value",
        "reorder-variant-values",
        "set-variant-properties",
        "add-property",
        "rename-property",
        "reorder-properties",
        "remove-property",
        "set-property",
        "reset-property",
        "create-slot-override",
        "clear-slot",
        "reset-slot",
        "set-slot-settings",
        "set-override",
        "reset-overrides",
        "detach-instance",
        "go-to-main",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    componentId: { type: "string", minLength: 1, maxLength: 256 },
    componentIds: {
      type: "array",
      minItems: 2,
      maxItems: 128,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    componentRootNodeIds: {
      type: "array",
      minItems: 2,
      maxItems: 128,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    componentRootNodeId: { type: "string", minLength: 1, maxLength: 256 },
    sourceComponentId: { type: "string", minLength: 1, maxLength: 256 },
    sourceRootNodeId: { type: "string", minLength: 1, maxLength: 256 },
    variantSetId: { type: "string", minLength: 1, maxLength: 256 },
    rootNodeId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Existing inspected root for create-component and Component Set actions. Never substitute nodeId or componentRootNodeId for create-component.",
    },
    variantPropertiesByComponentId: {
      type: "object",
      minProperties: 2,
      maxProperties: 128,
      additionalProperties: {
        type: "object",
        minProperties: 1,
        maxProperties: 128,
        additionalProperties: {
          type: "string",
          minLength: 1,
          maxLength: 256,
        },
      },
    },
    variantProperties: {
      type: "object",
      minProperties: 1,
      maxProperties: 128,
      additionalProperties: { type: "string", minLength: 1, maxLength: 256 },
    },
    valuesByComponentId: {
      type: "object",
      minProperties: 1,
      maxProperties: 128,
      additionalProperties: { type: "string", minLength: 1, maxLength: 256 },
    },
    propertyOrder: {
      type: "array",
      minItems: 1,
      maxItems: 128,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    componentPropertyOrder: {
      type: "array",
      minItems: 1,
      maxItems: 4096,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 512 },
    },
    values: {
      type: "array",
      minItems: 1,
      maxItems: 1024,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    instanceId: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    propertyId: { type: "string", minLength: 1, maxLength: 256 },
    propertyName: { type: "string", minLength: 1, maxLength: 512 },
    type: { enum: ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "SLOT"] },
    sourceNodeId: { type: "string", minLength: 1, maxLength: 256 },
    preferredValues: {
      type: "array",
      maxItems: 256,
      items: {
        type: "object",
        properties: {
          type: { enum: ["COMPONENT", "COMPONENT_SET"] },
          key: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["type", "key"],
        additionalProperties: false,
      },
    },
    settings: {
      type: "object",
      properties: {
        stretchChildOnInsert: { type: "boolean" },
        displayEmptyByDefault: { type: "boolean" },
        minChildren: {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 4096 },
            { type: "null" },
          ],
        },
        maxChildren: {
          anyOf: [
            { type: "integer", minimum: 0, maximum: 4096 },
            { type: "null" },
          ],
        },
        allowPreferredValuesOnly: { type: "boolean" },
      },
      additionalProperties: false,
    },
    description: { type: "string", maxLength: 2000 },
    value: {
      anyOf: [{ type: "boolean" }, { type: "string", maxLength: 100_000 }],
    },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    index: { type: "integer", minimum: 0 },
    x: { type: "number" },
    y: { type: "number" },
    sourcePath: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    patch: {
      type: "object",
      minProperties: 1,
      properties: {
        name: { type: "string" },
        visible: { type: "boolean" },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        blendMode: { enum: MODEL_BLEND_MODES },
        effects: { type: "array", items: MODEL_EFFECT_SCHEMA },
        maskMode: {
          enum: ["none", "alpha", "luminance", "clipping", "outline"],
        },
        properties: MODEL_NODE_PROPERTY_PATCH_SCHEMA,
      },
      additionalProperties: false,
    },
  },
  required: ["action", "pageId"],
  additionalProperties: false,
} as const;

const MODEL_VECTOR_EDIT_SCHEMA = {
  type: "object",
  description:
    "Edit explicit existing editable Vector Networks by stable Page, node, path, vertex, and segment IDs from inspection. set-closed requires closed; cut-path requires pathId and at; cut-with-line cuts one node's supported open or closed contours using node-local points; cut-layers-with-line cuts every crossed nodeId using one finite line in document coordinates. The host derives all new geometry, result layer IDs, bounds, transforms, and one atomic transaction.",
  properties: {
    action: {
      enum: [
        "set-closed",
        "reverse-path",
        "cut-path",
        "cut-with-line",
        "cut-layers-with-line",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    nodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
      description:
        "Required only for cut-layers-with-line. Explicit stable Vector layer IDs from inspection, in result order.",
    },
    pathId: { type: "string", minLength: 1, maxLength: 128 },
    closed: {
      type: "boolean",
      description: "Required only for set-closed.",
    },
    at: {
      description:
        "Required only for cut-path. t follows the inspected path run direction and must be between 0 and 1.",
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "vertex" },
            vertexId: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["kind", "vertexId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "segment" },
            segmentId: { type: "string", minLength: 1, maxLength: 128 },
            t: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["kind", "segmentId", "t"],
          additionalProperties: false,
        },
      ],
    },
    start: {
      ...MODEL_VECTOR_LOCAL_POINT_SCHEMA,
      description:
        "Required for line Cut. For cut-with-line this is node-local; for cut-layers-with-line this is document-space.",
    },
    end: {
      ...MODEL_VECTOR_LOCAL_POINT_SCHEMA,
      description:
        "Required for line Cut. For cut-with-line this is node-local; for cut-layers-with-line this is document-space.",
    },
  },
  required: ["action", "label", "pageId"],
  oneOf: [
    {
      properties: {
        action: {
          enum: ["set-closed", "reverse-path", "cut-path", "cut-with-line"],
        },
      },
      required: ["nodeId"],
    },
    {
      properties: { action: { const: "cut-layers-with-line" } },
      required: ["nodeIds"],
    },
  ],
  additionalProperties: false,
} as const;

const MODEL_DESIGN_PLAN_ARTBOARD_SCHEMA = {
  type: "object",
  properties: {
    mode: { enum: ["create", "existing"] },
    frameId: { type: "string", minLength: 1, maxLength: 256 },
    x: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    y: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    width: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
    height: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
  },
  required: ["mode", "frameId", "x", "y", "width", "height"],
  additionalProperties: false,
} as const;

const MODEL_DESIGN_PLAN_COMPOSITION_SCHEMA = {
  type: "object",
  properties: {
    direction: { type: "string", minLength: 1, maxLength: 1_000 },
    hierarchy: {
      type: "array",
      minItems: 2,
      maxItems: 16,
      items: { type: "string", minLength: 1, maxLength: 256 },
    },
    regions: {
      type: "array",
      minItems: 1,
      maxItems: 16,
      description:
        "Major composition regions in artboard-local coordinates. Each nodeId must later become a direct Group or Frame child of this target artboard.",
      items: {
        type: "object",
        properties: {
          nodeId: { type: "string", minLength: 1, maxLength: 256 },
          name: { type: "string", minLength: 1, maxLength: 128 },
          role: {
            enum: [
              "structure",
              "content",
              "typography",
              "media",
              "graphic",
              "decoration",
              "interaction",
              "other",
            ],
          },
          x: { type: "number", minimum: 0, maximum: 100_000 },
          y: { type: "number", minimum: 0, maximum: 100_000 },
          width: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
          height: { type: "number", exclusiveMinimum: 0, maximum: 100_000 },
        },
        required: ["nodeId", "name", "role", "x", "y", "width", "height"],
        additionalProperties: false,
      },
    },
    assetIntegration: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      description:
        "How native shapes, vectors, typography, and any raster imagery form one editable composition. State an intentional no-raster strategy when appropriate.",
    },
    spacingRhythm: { type: "string", minLength: 1, maxLength: 500 },
  },
  required: [
    "direction",
    "hierarchy",
    "regions",
    "assetIntegration",
    "spacingRhythm",
  ],
  additionalProperties: false,
} as const;

const MODEL_DESIGN_PLAN_TARGET_SCHEMA = {
  type: "object",
  description:
    "One required user-facing deliverable. Use exactly one target for a single requested design and one target per requested screen or asset for a set.",
  properties: {
    targetId: { type: "string", minLength: 1, maxLength: 128 },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
    artboard: MODEL_DESIGN_PLAN_ARTBOARD_SCHEMA,
    composition: MODEL_DESIGN_PLAN_COMPOSITION_SCHEMA,
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
  },
  required: [
    "targetId",
    "label",
    "pageId",
    "objective",
    "artboard",
    "composition",
    "editableLayers",
    "implementationSteps",
    "validationChecks",
  ],
  additionalProperties: false,
} as const;

const MODEL_DESIGN_PLAN_SCHEMA = {
  type: "object",
  description:
    "Version 4 of the executable delivery plan. targets must match the user's requested scope exactly and componentStrategy must explicitly judge plausible reusable semantic objects without category or occurrence-count shortcuts.",
  properties: {
    version: { const: 4 },
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
    targets: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: MODEL_DESIGN_PLAN_TARGET_SCHEMA,
    },
    visualSystem: {
      type: "object",
      properties: {
        avoidances: {
          type: "array",
          minItems: 2,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        formLanguage: { type: "string", minLength: 1, maxLength: 1_000 },
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
    componentStrategy: DESIGN_PLAN_COMPONENT_STRATEGY_SCHEMA,
    singleRasterEvidence: {
      type: "string",
      minLength: 1,
      maxLength: 200,
      description:
        "Allowed only for one target when the user explicitly requests a single flattened image.",
    },
  },
  required: [
    "version",
    "deliverable",
    "objective",
    "outputMode",
    "targets",
    "visualSystem",
    "rasterAssetRoles",
    "componentStrategy",
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
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
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
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "inspection" as const,
    },
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
    modelDisclosure: { bootstrap: "deferred" as const },
    description:
      "Capture the Main-selected target in the Run-bound OpenDesign document as a bounded image and return it as multimodal content together with captureTarget, the observed document revision, and reviewWorkflow. After the planned artboard exists, captureTarget is that exact Frame; otherwise it is the bound Page. Frame captures also return layoutQuality, a trusted exact-revision geometry report with node-specific clipping and artboard-overflow errors or warnings. Overflow issues include world-space node/artboard bounds plus geometry.currentLocalPosition, recommendedLocalDelta, and recommendedLocalPosition in the node parent's local coordinate space; use the recommended local x/y directly while preserving the node's inspected transform linear terms, and resize only when requiresResize is true. Use it in the visual review and correct every error before final verification; the host rejects a refined target whose final report still has errors. Final verification may include a bounded non-blocking componentStrategy report when actual Component/Instance bindings differ from the model-authored plan; it is maintainability guidance and does not invalidate an otherwise useful visual delivery. The capture uses an isolated Leafer projection of the captured revision, so user pan, zoom, selection, window size, or switching to another open Design File cannot change its pixels or mutation target. Call record_visual_review only when reviewWorkflow.reviewEligible is true; otherwise perform reviewWorkflow.nextAction first. Use this after a successful material design write to evaluate the rendered composition, hierarchy, spacing, proportions, and effects before recording the required visual review. A baseline capture before a write may inform planning but does not unlock review. This does not capture other applications, windows, files, or screens.",
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
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "plan" as const,
    },
    description:
      "Define version 4 of the executable delivery plan after inspection and before generating imagery or creating design layers. targets must reflect the user's request exactly: one target for one design, or one stable artboard root per requested screen or asset for a set. componentStrategy must identify plausible reusable semantic objects, decide component versus ordinary hierarchy from reuse, stable identity, centralized updates, structural consistency, and intended instance differences, and bind every declared occurrence to a stable target/node ID. The host verifies declared Component Mains, Instances, and ordinary semantic containers from the live captured document; an empty candidate list is valid only when the summary explains why no semantic object merits component consideration. Every mode=create target is allocated as a real Page-root Frame and every target still passes draft, capture, review, refinement, and final verification. single-raster is allowed only for one target when singleRasterEvidence quotes an explicit current-user request and component candidates are empty.",
    inputSchema: MODEL_DESIGN_PLAN_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_REVIEW_TOOL_NAME,
    modelDisclosure: { bootstrap: "deferred" as const },
    description:
      "Record a structured critique of the newest unreviewed opendesign_capture_canvas result after a successful material design write in this Run. Evaluate the rendered composition, hierarchy, typography, asset integration, form/surface, and effects, then name at least two concrete refinements. Do not submit generic praise. The host rejects baseline/pre-write captures, already-reviewed captures, and captures older than the latest material revision with a design_workflow.* recovery instruction; follow that instruction instead of retrying the same review. This records Run review state and does not mutate the canvas.",
    inputSchema: MODEL_VISUAL_REVIEW_SCHEMA,
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: READ_IMAGE_TOOL_NAME,
    modelDisclosure: { bootstrap: "available" as const },
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
    modelDisclosure: { bootstrap: "available" as const },
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
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Place an image attachment returned by opendesign_read_image, opendesign_generate_image, or explicitly attached by the user into the currently bound Design File. A successful design plan must declare the image role. Editable posters must first create their planned artboard Frame with meaningful editable shape/text content, then place the image inside that existing Frame or one of its inspected/current descendants; parentId may never be null for this flow. Do not copy attachmentId into an insert_element image assetId. Editable posters cannot use final-single-image. The host imports the approved attachment as a durable project image asset and inserts one image node through the same atomic OpenDesign transaction and revision history as every other design edit.",
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
        placement: MODEL_IMAGE_PLACEMENT_SCHEMA,
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
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
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
          ...MODEL_IMAGE_PLACEMENT_SCHEMA,
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
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
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
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
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
    name: EXPORT_RASTER_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      afterInspection: "available" as const,
    },
    description:
      "Export one explicit existing layer or Frame from the currently bound Design File as a delivery-quality PNG, JPEG, or WebP. pageId and rootNodeId must be stable IDs returned by opendesign_inspect_document; this tool never reads the live user selection or viewport. It freezes the current revision, renders an isolated Leafer projection with explicit 1x/2x/3x or fixed width/height, background, quality, and resampling settings, then opens Main's native save dialog. The user chooses or cancels the destination; the model never receives bytes or a local path. Call only when the user explicitly asks to export or deliver a raster image. opendesign_capture_canvas is a bounded review preview and must not be presented as the exported artifact.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        rootNodeId: { type: "string", minLength: 1, maxLength: 256 },
        suggestedName: {
          type: "string",
          minLength: 1,
          maxLength: 255,
          description: "Portable file name only, never a path.",
        },
        format: { enum: ["png", "jpeg", "webp"] },
        size: {
          oneOf: [
            {
              type: "object",
              properties: {
                mode: { const: "scale" },
                value: { enum: [1, 2, 3] },
              },
              required: ["mode", "value"],
              additionalProperties: false,
            },
            ...(["width", "height"] as const).map((mode) => ({
              type: "object" as const,
              properties: {
                mode: { const: mode },
                value: {
                  type: "integer" as const,
                  minimum: 1,
                  maximum: 16_384,
                },
              },
              required: ["mode", "value"],
              additionalProperties: false,
            })),
          ],
        },
        background: {
          oneOf: [
            {
              type: "object",
              properties: { mode: { const: "transparent" } },
              required: ["mode"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                mode: { const: "color" },
                color: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
              },
              required: ["mode", "color"],
              additionalProperties: false,
            },
          ],
        },
        quality: { type: "number", minimum: 0.01, maximum: 1 },
        resampling: { enum: ["smooth", "pixelated"] },
      },
      required: [
        "pageId",
        "rootNodeId",
        "suggestedName",
        "format",
        "size",
        "background",
        "resampling",
      ],
      additionalProperties: false,
    },
    risk: "external" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_HIERARCHY_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Edit existing layer hierarchy and non-destructive Boolean groups in the currently bound Design File without asking the model to calculate low-level move commands, transforms, or derived paths. It can group siblings, ungroup one Group, create union/subtract/intersect/exclude from explicit supported siblings, change a Boolean operation, ungroup one Boolean, reorder siblings, or reparent layers to an explicit Page-root, Frame, or Group insertion index. Source Boolean operands remain editable and the provider-derived result is never model-authored or persisted. Reparenting preserves world transforms and dynamically recomputes affected Group bounds; Frame sizes remain fixed. Targets are explicit stable node IDs on an explicit existing Page, never the send-time or live user selection. The host previews the complete change and applies it as one atomic undoable OpenDesign transaction. It rejects locked layers, mixed parents, stale revisions, out-of-scope nodes, duplicate IDs, unsupported or masked Boolean operands, cycles, empty source Groups, non-invertible targets, no-op changes, and visually lossy ungrouping; inherited clipping or appearance changes return a visual-review warning.",
    inputSchema: MODEL_HIERARCHY_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_ARRANGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Precisely arrange explicit existing layers in the currently bound Design File using host-computed geometry. It aligns selection bounds, distributes or sets exact spacing, performs deterministic one- or two-dimensional Tidy up, assigns Constraints v1 to an ordinary Frame child, resizes a Frame while resolving constraints, configures Frame-owned Auto Layout, direct flow-child sizing, bounded min/max width and height, an absolute child that ignores Auto Layout flow, or non-exported Frame Layout Guides with action=set-layout-guides. Uniform, Columns, and Rows guides are visual editing aids only: they never change child geometry, participate in Auto Layout, or appear in capture/export. Columns/Rows accept count/gutter and either stretch + margin or fixed start/center/end + sectionSize with edge offset. Auto Layout supports per-axis Frame Fixed/Hug, child Fixed/Fill, fixed or Auto gap, min/max clamping, bounded Fill redistribution, padding minimums, hidden-child exclusion, nested convergence, and horizontal Fill + Auto Height text remeasurement. Set primaryAlignment=space-between for Auto gap; it never becomes negative and starts a single child at the leading padding. Horizontal Wrap resolves Auto gap independently per row while preserving the explicit counter gap; it requires Fixed Frame width and rejects visible Fill children. Child geometry is always host-derived. The host previews the complete change and applies one atomic undoable transaction. Targets are stable Page and layer IDs returned by inspection, never the send-time or live user selection. It rejects locked, missing, stale, out-of-scope, non-invertible, ambiguous, lossy, no-op, inverted limits, and over-limit operations. Snapping, Auto Layout Grid, vertical wrap, Wrap+Fill, auto track gap, baseline, Smart Selection canvas handles, and reflow handles remain separate capabilities.",
    inputSchema: DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_VECTOR_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Edit one or more existing non-branching editable Vector Networks without asking the model to rewrite vertices, segments, path runs, regions, bounds, transforms, or result layer IDs. set-closed opens or closes one explicit contour; reverse-path reverses one contour while preserving effective closed-region winding; cut-path creates a true break at an inspected vertex or at parameter t on an inspected line/cubic segment; cut-with-line divides supported open or closed contours using node-local coordinates; cut-layers-with-line applies one document-space line across explicit Vector layer IDs and atomically divides every crossed target into host-created editable sibling layers. Closed boundaries may cross the line two or more transverse times: the host stitches boundary arcs with same-side cut connectors, keeps the component containing the source start under the stable source path/region ID, and collects the other closed components into one sibling network. If a line crosses both the unambiguous outer loop and one or more hole loops, crossed-hole boundaries become continuous closed result loops rather than retaining invalid holes. Uncut holes move unchanged with the sibling component that contains them, preserving stable path IDs and effective nonzero winding. Open contours split at every transverse crossing into alternating retained/extracted path runs without connectors, regions, or implicit fill. Targets are stable Page, node, path, vertex, and segment IDs returned by inspection, never the send-time or live selection. The host resolves each layer's world transform, computes geometry through the same versioned vector-edit service as the human canvas, previews the complete change, and applies one atomic undoable EditorRuntime transaction. Uncrossed targets are unchanged; missing, locked, stale, out-of-scope, non-invertible, invalid, branching, tangent, overlapping, direct hole-only cuts, ambiguous outer loops, and shared compound loops are rejected. Connect/disconnect, branches, flatten, and outline stroke remain separate capabilities and must not be simulated with this tool.",
    inputSchema: MODEL_VECTOR_EDIT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_COMPONENT_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage reusable components through OpenDesign's typed component runtime. create-component promotes one existing Frame/Group as the Main and requires exactly action, label, pageId, rootNodeId, componentId, and name. combine-as-variants creates one real Component Set Frame from inspected sibling Mains. add-component-to-variant-set, duplicate-variant, remove-variant, and dissolve-variant-set manage Set membership. add/rename/reorder/remove-variant-property, rename/reorder-variant-value, and set-variant-properties edit the Figma-compatible two-dimensional Variant matrix using explicit inspected Set/member roots; the host preserves complete unique combinations, property/value order, top-left defaults, current Instance resolution, one revision, and one undo. create-instance places a linked instance. add/rename/remove-property author Boolean, Text, Instance-swap, or Slot properties on explicit Main sublayers. create-slot-override, clear-slot, reset-slot, and set-slot-settings manage bounded instance Slot contents and guidance without detaching the Instance; arbitrary content is inserted only under the real override Slot root returned by a fresh inspection. set/reset-property also selects VARIANT values exposed by inspection. set/reset-overrides remains the advanced sourcePath layer and wins after typed properties. Main edits synchronize property defaults, ordinary Instance structure remains read-only, every write is previewed and atomic, and cross-Page work requires the same one-time Page structure access as other writes.",
    inputSchema: MODEL_COMPONENT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
    explainInvalidInput: explainInvalidDesignComponentToolInput,
  },
  {
    name: DESIGN_VARIABLE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage Figma-compatible Variables through the versioned Variable Service. Collections, modes, values, aliases, scopes, code syntax, Page/node mode overrides, and supported node/Paint bindings are validated, previewed, and applied as one atomic undoable transaction. Use stable IDs and current definitions from opendesign_inspect_document. BOOLEAN binds visibility, FLOAT binds opacity in 0..1, STRING binds Text content, and COLOR RGB/RGBA binds SolidPaint color. Scope only ranks picker recommendations and never replaces type validation. TIMING/EASING remain authorable but are not bindable before Motion support.",
    inputSchema: DESIGN_VARIABLE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_STYLE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "deferred" as const,
      role: "material-write" as const,
    },
    description:
      "Manage Figma-compatible local Paint, Text, Effect, and Grid styles through the versioned Style Service. Create or update a Style from an explicit inspected node property, edit metadata/order, apply or detach stable style references, and delete while preserving every consumer's resolved appearance. Every write is validated, previewed, atomic, undoable, and scoped to the current Design File and Page node IDs returned by inspection. Remote Libraries and arbitrary Figma private data are not accepted.",
    inputSchema: DESIGN_STYLE_TOOL_INPUT_SCHEMA,
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
    modelDisclosure: { bootstrap: "available" as const },
    description:
      "Request one user-approved, Run-scoped capability to modify Page structure or design across Pages in the currently bound Design File. Call this only when the user's request actually requires creating, duplicating, reordering, deleting, or editing another Page. The default Run remains bound to the current Page until the user approves. Approval expires when this Run ends and never grants access to another Design File, Project, directory, or future Run. After approval, inspect the Design File again before calling opendesign_manage_pages or planning work on another Page. Do not call this for renaming the already bound Page or for ordinary edits inside the current Page.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 5,
          uniqueItems: true,
          items: {
            enum: [
              "create-page",
              "duplicate-page",
              "reorder-pages",
              "delete-page",
              "cross-page-edit",
            ],
          },
        },
        reason: { type: "string", minLength: 8, maxLength: 500 },
      },
      required: ["actions", "reason"],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "required" as const,
    approvalScope: "run" as const,
    approvalPrompt: {
      title: "Allow Page structure changes",
      summary:
        "This task is requesting temporary access to create, duplicate, reorder, delete, or edit across Pages in the bound Design File. Access expires when the task ends.",
    },
  },
  {
    name: DESIGN_PAGE_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "material-write" as const,
    },
    description:
      "Create, rename, duplicate, reorder, or delete Pages in the currently bound OpenDesign Design File through one validated, undoable transaction. Use exactly the fields declared for the selected action: create has name and optional index but no pageId; rename has pageId and name but no index. Names may be duplicated and are trimmed to 1–256 non-control characters. create makes an empty Page; duplicate clones the complete Page node tree with host-generated stable IDs while sharing document-level assets; reorder uses a zero-based final index; delete removes that Page tree but never the final Page. rename is allowed for the Run-bound Page without expanding scope. create, duplicate, reorder, delete, and operations targeting another Page require a successful opendesign_request_page_structure_access approval in this Run. Page IDs and node IDs for new copies are generated by the host and returned in the result; never invent them. Page lifecycle changes do not require a visual design plan or canvas review.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          enum: ["create", "rename", "duplicate", "reorder", "delete"],
        },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        index: { type: "integer", minimum: 0 },
      },
      oneOf: [
        {
          properties: {
            action: { const: "create" },
            label: { type: "string", minLength: 1, maxLength: 256 },
            name: { type: "string", minLength: 1, maxLength: 256 },
            index: { type: "integer", minimum: 0 },
          },
          required: ["action", "label", "name"],
          additionalProperties: false,
        },
        {
          properties: {
            action: { const: "rename" },
            label: { type: "string", minLength: 1, maxLength: 256 },
            pageId: { type: "string", minLength: 1, maxLength: 256 },
            name: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["action", "label", "pageId", "name"],
          additionalProperties: false,
        },
        {
          properties: {
            action: { const: "duplicate" },
            label: { type: "string", minLength: 1, maxLength: 256 },
            pageId: { type: "string", minLength: 1, maxLength: 256 },
            name: { type: "string", minLength: 1, maxLength: 256 },
            index: { type: "integer", minimum: 0 },
          },
          required: ["action", "label", "pageId"],
          additionalProperties: false,
        },
        {
          properties: {
            action: { const: "reorder" },
            label: { type: "string", minLength: 1, maxLength: 256 },
            pageId: { type: "string", minLength: 1, maxLength: 256 },
            index: { type: "integer", minimum: 0 },
          },
          required: ["action", "label", "pageId", "index"],
          additionalProperties: false,
        },
        {
          properties: {
            action: { const: "delete" },
            label: { type: "string", minLength: 1, maxLength: 256 },
            pageId: { type: "string", minLength: 1, maxLength: 256 },
          },
          required: ["action", "label", "pageId"],
          additionalProperties: false,
        },
      ],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_APPLY_TOOL_NAME,
    modelDisclosure: {
      bootstrap: "available" as const,
      role: "material-write" as const,
      bootstrapDescription:
        "Create the first small but meaningful editable visual slice inside the planned artboard, or perform a basic inspected edit. This compact phase supports Frame, Group, Rectangle, Ellipse, and Text with solid paints plus insert, basic property update, move, and delete commands. Prefer one region such as navigation, hero, primary mark, or core content instead of waiting to emit an entire page. Ordered steps must represent real semantic units and cover every command exactly once. The trusted host still validates and applies these commands through the same OpenDesign transaction, revision, history, scope, and recovery boundary. After a successful material revision, the complete apply schema and advanced professional tools become available automatically.",
      bootstrapInputSchema: DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA,
    },
    description:
      "Apply one validated OpenDesign node transaction to the currently bound Design File and an existing Page. Supports insert_element, update_properties, move_element, delete_element, and replace_subtree. When one target needs several meaningful visible stages, provide ordered steps whose commandIds cover every command exactly once and in command order; use semantic units such as navigation, hero, content, and footer, never arbitrary 1–3 command batches. The host commits each valid step as a real revision inside one rollback-safe history group and reports the committed step revisions; without steps it applies the transaction once. update_properties must match the inspected target kind; Group properties are empty, and the host validates the merged discriminated node before writing. Text must declare textResize auto-width/auto-height/fixed. Auto Width uses textWrap none + textOverflow visible; Auto Height keeps width and uses word/character wrapping + visible overflow; Fixed supports all textWrap and textOverflow choices. The trusted host measures Auto Size with the versioned Leafer Text provider and persists concrete authoritative size, so do not estimate glyph bounds. A size update without an explicit non-fixed textResize switches that text layer to Fixed. max-lines are not available. For editable organic silhouettes, mascots, logos, custom icons, wings, limbs, fabric, and other non-geometric contours, use path or vector nodes with properties.network: stable vertices, persistent corner/smooth/mirrored/independent handle modes, cubic segment tangents, ordered path runs, and closed fill regions. One non-branching path run is fully editable by the human point editor; a closed run needs one matching region, while an open run must have no fill. Branch authoring and multiple contours are not yet available. Use properties.path only when exact imported SVG path data must be preserved and node-level point editing is not required; never provide path and network together. Both geometry forms support the same fills, strokes, gradients, effects, and advanced stroke fields. Coordinates are parent-local and must fit the node's declared size. Plan-created artboard Frames are already allocated; add real content inside the active Frame and do not recreate it. For planned region IDs, provide the declared Group/Frame kind and real content; the trusted host compiles canonical parent-local bounds. Every inserted planned region must include real editable content in the same transaction. Composite designs should create a named Frame or Group together with its children; do not flatten parts into Page-root layers. This tool does not manage Projects, Design Files, or Pages. Use stable unique IDs. Recoverable invariant failures return structured commandId/nodeId/path issues; inspect and revise instead of repeating the same transaction.",
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
  if (toolName === EXPORT_RASTER_TOOL_NAME) {
    return isExportRasterToolInput(input);
  }
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
  if (toolName === DESIGN_VECTOR_TOOL_NAME) {
    return isDesignVectorToolInput(input);
  }
  if (toolName === DESIGN_PAGE_TOOL_NAME) {
    return normalizeDesignPageToolInput(input) !== undefined;
  }
  if (toolName === DESIGN_COMPONENT_TOOL_NAME) {
    return isDesignComponentToolInput(input);
  }
  if (toolName === DESIGN_VARIABLE_TOOL_NAME) {
    return isDesignVariableToolInput(input);
  }
  if (toolName === DESIGN_STYLE_TOOL_NAME) {
    return isDesignStyleToolInput(input);
  }
  if (toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    return isPageStructureAccessToolInput(input);
  }
  if (
    (toolName !== DESIGN_APPLY_TOOL_NAME &&
      toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME) ||
    !isRecord(input)
  ) {
    return false;
  }
  if (toolName === DESIGN_APPLY_TOOL_NAME) {
    return normalizeDesignApplyToolInput(input) !== undefined;
  }
  return isInternalDesignApplyToolInput(input);
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

export function isExportRasterToolInput(
  input: unknown,
): input is ExportRasterToolInput {
  if (!isRecord(input) || !isPortableFileName(input.suggestedName))
    return false;
  if (
    !Object.keys(input).every((key) =>
      [
        "pageId",
        "rootNodeId",
        "suggestedName",
        "format",
        "size",
        "background",
        "quality",
        "resampling",
      ].includes(key),
    )
  )
    return false;
  return isRasterExportRequest({
    version: RASTER_EXPORT_VERSION,
    pageId: input.pageId,
    rootNodeId: input.rootNodeId,
    format: input.format,
    size: input.size,
    background: input.background,
    quality: input.quality,
    resampling: input.resampling,
  });
}

export function isPreparedAgentRasterExport(
  value: unknown,
): value is PreparedAgentRasterExport {
  if (!isRecord(value)) return false;
  return (
    value.kind === "raster-export-preparation" &&
    value.version === 1 &&
    isPortableFileName(value.suggestedName) &&
    (value.format === "png" ||
      value.format === "jpeg" ||
      value.format === "webp") &&
    value.mimeType === rasterExportMimeType(value.format) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= RASTER_EXPORT_MAX_ENCODED_BYTES &&
    Number.isInteger(value.width) &&
    Number(value.width) > 0 &&
    Number(value.width) <= 16_384 &&
    Number.isInteger(value.height) &&
    Number(value.height) > 0 &&
    Number(value.height) <= 16_384 &&
    Number.isInteger(value.revision) &&
    Number(value.revision) >= 0 &&
    safeId(value.rootNodeId) &&
    Object.keys(value).every((key) =>
      [
        "kind",
        "version",
        "suggestedName",
        "format",
        "mimeType",
        "bytes",
        "width",
        "height",
        "revision",
        "rootNodeId",
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
  return (
    isLegacyDesignPlanToolInput(input) ||
    isMultiTargetDesignPlanToolInput(input)
  );
}

function isLegacyDesignPlanToolInput(
  input: unknown,
): input is LegacyDesignPlanToolInput {
  if (!isRecord(input)) return false;
  const allowed = [
    "version",
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
    input.version !== 2 ||
    !safeId(input.pageId) ||
    !isDesignDeliverable(input.deliverable) ||
    !boundedText(input.objective, 2_000) ||
    (input.outputMode !== "editable-composition" &&
      input.outputMode !== "single-raster") ||
    !Object.keys(input).every((key) => allowed.includes(key))
  ) {
    return false;
  }

  const artboard = input.artboard;
  if (
    !isRecord(artboard) ||
    (artboard.mode !== "create" && artboard.mode !== "existing") ||
    !safeId(artboard.frameId) ||
    !finiteBounded(artboard.x, 1_000_000) ||
    !finiteBounded(artboard.y, 1_000_000) ||
    !positiveBounded(artboard.width, 100_000) ||
    !positiveBounded(artboard.height, 100_000) ||
    !exactKeys(artboard, ["mode", "frameId", "x", "y", "width", "height"])
  ) {
    return false;
  }
  const artboardWidth = artboard.width;
  const artboardHeight = artboard.height;

  const composition = input.composition;
  if (
    !isRecord(composition) ||
    !boundedText(composition.direction, 1_000) ||
    !boundedTextArray(composition.hierarchy, 2, 16, 256) ||
    !Array.isArray(composition.regions) ||
    composition.regions.length < 1 ||
    composition.regions.length > 16 ||
    !composition.regions.every((region) =>
      isDesignPlanRegion(region, artboardWidth, artboardHeight),
    ) ||
    composition.regions.some(
      (region) => isRecord(region) && region.nodeId === artboard.frameId,
    ) ||
    new Set(
      composition.regions.flatMap((region) =>
        isRecord(region) && typeof region.nodeId === "string"
          ? [region.nodeId]
          : [],
      ),
    ).size !== composition.regions.length ||
    !boundedText(composition.assetIntegration, 1_000) ||
    !boundedText(composition.spacingRhythm, 500) ||
    !exactKeys(composition, [
      "direction",
      "hierarchy",
      "regions",
      "assetIntegration",
      "spacingRhythm",
    ])
  ) {
    return false;
  }

  const visualSystem = input.visualSystem;
  if (
    !isRecord(visualSystem) ||
    !boundedTextArray(visualSystem.avoidances, 2, 12, 256) ||
    !boundedText(visualSystem.formLanguage, 1_000) ||
    !boundedTextArray(visualSystem.palette, 1, 12, 128) ||
    !boundedText(visualSystem.surfaceAndDepth, 1_000) ||
    !boundedTextArray(visualSystem.typography, 1, 8, 256) ||
    !boundedTextArray(visualSystem.effects, 0, 12, 256) ||
    !exactKeys(visualSystem, [
      "avoidances",
      "formLanguage",
      "palette",
      "surfaceAndDepth",
      "typography",
      "effects",
    ])
  ) {
    return false;
  }

  if (
    !Array.isArray(input.rasterAssetRoles) ||
    input.rasterAssetRoles.length > 5 ||
    !input.rasterAssetRoles.every(isRasterAssetRole) ||
    new Set(input.rasterAssetRoles).size !== input.rasterAssetRoles.length ||
    !boundedTextArray(input.editableLayers, 2, 24, 256) ||
    !boundedTextArray(input.implementationSteps, 2, 16, 500) ||
    !boundedTextArray(input.validationChecks, 2, 16, 500)
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

function isMultiTargetDesignPlanToolInput(
  input: unknown,
): input is DesignPlanToolInputV3 | DesignPlanToolInputV4 {
  if (!isRecord(input)) return false;
  const version4 = input.version === 4;
  if (
    (input.version !== 3 && !version4) ||
    !isDesignDeliverable(input.deliverable) ||
    !boundedText(input.objective, 2_000) ||
    (input.outputMode !== "editable-composition" &&
      input.outputMode !== "single-raster") ||
    !Array.isArray(input.targets) ||
    input.targets.length < 1 ||
    input.targets.length > 32 ||
    !input.targets.every(isDesignPlanTarget) ||
    !isDesignPlanVisualSystem(input.visualSystem) ||
    !Array.isArray(input.rasterAssetRoles) ||
    input.rasterAssetRoles.length > 5 ||
    !input.rasterAssetRoles.every(isRasterAssetRole) ||
    new Set(input.rasterAssetRoles).size !== input.rasterAssetRoles.length ||
    !exactKeys(input, [
      "version",
      "deliverable",
      "objective",
      "outputMode",
      "targets",
      "visualSystem",
      "rasterAssetRoles",
      ...(version4 ? ["componentStrategy"] : []),
      ...(input.singleRasterEvidence === undefined
        ? []
        : ["singleRasterEvidence"]),
    ])
  ) {
    return false;
  }
  const targets = input.targets;
  const componentStrategy = isDesignPlanComponentStrategy(
    input.componentStrategy,
    targets.map((target) => target.targetId),
  )
    ? input.componentStrategy
    : undefined;
  if (version4 && !componentStrategy) {
    return false;
  }
  if (
    new Set(targets.map((target) => target.targetId)).size !== targets.length ||
    new Set(targets.map((target) => target.artboard.frameId)).size !==
      targets.length ||
    new Set(
      targets.flatMap((target) =>
        target.composition.regions.map((region) => region.nodeId),
      ),
    ).size !==
      targets.reduce(
        (count, target) => count + target.composition.regions.length,
        0,
      ) ||
    targets.some((target) =>
      targets.some(
        (candidate) =>
          candidate.targetId !== target.targetId &&
          candidate.composition.regions.some(
            (region) => region.nodeId === target.artboard.frameId,
          ),
      ),
    )
  ) {
    return false;
  }
  if (
    version4 &&
    componentStrategy &&
    targets.some((target) =>
      componentStrategyOccurrencesForTarget(
        componentStrategy,
        target.targetId,
      ).some((occurrence) => occurrence.nodeId === target.artboard.frameId),
    )
  ) {
    return false;
  }
  if (input.outputMode === "single-raster") {
    return (
      targets.length === 1 &&
      boundedText(input.singleRasterEvidence, 200) &&
      input.rasterAssetRoles.includes("final-single-image") &&
      (!version4 || componentStrategy?.candidates.length === 0)
    );
  }
  return (
    input.singleRasterEvidence === undefined &&
    !input.rasterAssetRoles.includes("final-single-image")
  );
}

export function designPlanTargets(
  plan: DesignPlanToolInput,
): DesignPlanTarget[] {
  if (plan.version !== 2) return structuredClone(plan.targets);
  return [
    {
      targetId: plan.artboard.frameId,
      label: plan.objective,
      pageId: plan.pageId,
      objective: plan.objective,
      artboard: structuredClone(plan.artboard),
      composition: structuredClone(plan.composition),
      editableLayers: [...plan.editableLayers],
      implementationSteps: [...plan.implementationSteps],
      validationChecks: [...plan.validationChecks],
    },
  ];
}

export function designPlanComponentStrategy(
  plan: DesignPlanToolInput,
): DesignPlanComponentStrategy | undefined {
  return plan.version === 4
    ? structuredClone(plan.componentStrategy)
    : undefined;
}

function isDesignPlanTarget(value: unknown): value is DesignPlanTarget {
  if (!isRecord(value)) return false;
  const artboard = value.artboard;
  const composition = value.composition;
  if (
    !safeId(value.targetId) ||
    !boundedText(value.label, 256) ||
    !safeId(value.pageId) ||
    !boundedText(value.objective, 2_000) ||
    !isDesignPlanArtboard(artboard) ||
    !isRecord(composition) ||
    !boundedText(composition.direction, 1_000) ||
    !boundedTextArray(composition.hierarchy, 2, 16, 256) ||
    !Array.isArray(composition.regions) ||
    composition.regions.length < 1 ||
    composition.regions.length > 16 ||
    !composition.regions.every((region) =>
      isDesignPlanRegion(region, artboard.width, artboard.height),
    ) ||
    composition.regions.some(
      (region) => isRecord(region) && region.nodeId === artboard.frameId,
    ) ||
    new Set(
      composition.regions.flatMap((region) =>
        isRecord(region) && typeof region.nodeId === "string"
          ? [region.nodeId]
          : [],
      ),
    ).size !== composition.regions.length ||
    !boundedText(composition.assetIntegration, 1_000) ||
    !boundedText(composition.spacingRhythm, 500) ||
    !exactKeys(composition, [
      "direction",
      "hierarchy",
      "regions",
      "assetIntegration",
      "spacingRhythm",
    ]) ||
    !boundedTextArray(value.editableLayers, 2, 24, 256) ||
    !boundedTextArray(value.implementationSteps, 2, 16, 500) ||
    !boundedTextArray(value.validationChecks, 2, 16, 500) ||
    !exactKeys(value, [
      "targetId",
      "label",
      "pageId",
      "objective",
      "artboard",
      "composition",
      "editableLayers",
      "implementationSteps",
      "validationChecks",
    ])
  ) {
    return false;
  }
  return true;
}

function isDesignPlanArtboard(value: unknown): value is DesignPlanArtboard {
  return (
    isRecord(value) &&
    (value.mode === "create" || value.mode === "existing") &&
    safeId(value.frameId) &&
    finiteBounded(value.x, 1_000_000) &&
    finiteBounded(value.y, 1_000_000) &&
    positiveBounded(value.width, 100_000) &&
    positiveBounded(value.height, 100_000) &&
    exactKeys(value, ["mode", "frameId", "x", "y", "width", "height"])
  );
}

function isDesignPlanVisualSystem(
  value: unknown,
): value is LegacyDesignPlanToolInput["visualSystem"] {
  return (
    isRecord(value) &&
    boundedTextArray(value.avoidances, 2, 12, 256) &&
    boundedText(value.formLanguage, 1_000) &&
    boundedTextArray(value.palette, 1, 12, 128) &&
    boundedText(value.surfaceAndDepth, 1_000) &&
    boundedTextArray(value.typography, 1, 8, 256) &&
    boundedTextArray(value.effects, 0, 12, 256) &&
    exactKeys(value, [
      "avoidances",
      "formLanguage",
      "palette",
      "surfaceAndDepth",
      "typography",
      "effects",
    ])
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

export function isDesignVectorToolInput(
  input: unknown,
): input is DesignVectorToolInput {
  if (
    !isRecord(input) ||
    (input.action !== "set-closed" &&
      input.action !== "reverse-path" &&
      input.action !== "cut-path" &&
      input.action !== "cut-with-line" &&
      input.action !== "cut-layers-with-line") ||
    !safeLabel(input.label) ||
    !safeId(input.pageId)
  ) {
    return false;
  }
  if (input.action === "cut-layers-with-line") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every((nodeId) => safeId(nodeId)) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      finiteBoundedPoint(input.start, 1_000_000) &&
      finiteBoundedPoint(input.end, 1_000_000) &&
      exactKeys(input, ["action", "end", "label", "nodeIds", "pageId", "start"])
    );
  }
  if (!safeId(input.nodeId)) return false;
  const optionalPathId =
    input.pathId === undefined ||
    (typeof input.pathId === "string" && safeId(input.pathId));
  if (!optionalPathId) return false;
  if (input.action === "set-closed") {
    return (
      typeof input.closed === "boolean" &&
      exactKeys(
        input,
        input.pathId === undefined
          ? ["action", "closed", "label", "nodeId", "pageId"]
          : ["action", "closed", "label", "nodeId", "pageId", "pathId"],
      )
    );
  }
  if (input.action === "reverse-path") {
    return exactKeys(
      input,
      input.pathId === undefined
        ? ["action", "label", "nodeId", "pageId"]
        : ["action", "label", "nodeId", "pageId", "pathId"],
    );
  }
  if (input.action === "cut-with-line") {
    return (
      finiteBoundedPoint(input.start, 1_000_000) &&
      finiteBoundedPoint(input.end, 1_000_000) &&
      exactKeys(input, ["action", "end", "label", "nodeId", "pageId", "start"])
    );
  }
  if (!safeId(input.pathId) || !isRecord(input.at)) return false;
  return (
    exactKeys(input, ["action", "at", "label", "nodeId", "pageId", "pathId"]) &&
    (input.at.kind === "vertex"
      ? safeId(input.at.vertexId) && exactKeys(input.at, ["kind", "vertexId"])
      : input.at.kind === "segment" &&
        safeId(input.at.segmentId) &&
        typeof input.at.t === "number" &&
        Number.isFinite(input.at.t) &&
        input.at.t >= 0 &&
        input.at.t <= 1 &&
        exactKeys(input.at, ["kind", "segmentId", "t"]))
  );
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

export function isDesignPageToolInput(
  input: unknown,
): input is DesignPageToolInput {
  if (!isRecord(input) || !safeLabel(input.label)) return false;
  if (input.action === "create") {
    return (
      safePageName(input.name) &&
      optionalIndex(input.index) &&
      onlyKeys(input, ["action", "label", "name", "index"])
    );
  }
  if (input.action === "rename") {
    return (
      safeId(input.pageId) &&
      safePageName(input.name) &&
      onlyKeys(input, ["action", "label", "pageId", "name"])
    );
  }
  if (input.action === "duplicate") {
    return (
      safeId(input.pageId) &&
      (input.name === undefined || safePageName(input.name)) &&
      optionalIndex(input.index) &&
      onlyKeys(input, ["action", "label", "pageId", "name", "index"])
    );
  }
  if (input.action === "reorder") {
    return (
      safeId(input.pageId) &&
      Number.isInteger(input.index) &&
      Number(input.index) >= 0 &&
      onlyKeys(input, ["action", "label", "pageId", "index"])
    );
  }
  return (
    input.action === "delete" &&
    safeId(input.pageId) &&
    onlyKeys(input, ["action", "label", "pageId"])
  );
}

export function normalizeDesignPageToolInput(
  input: unknown,
): DesignPageToolInput | undefined {
  if (!isRecord(input) || !safeLabel(input.label)) return undefined;
  if (input.action === "create") {
    if (
      !safePageName(input.name) ||
      !optionalIndex(input.index) ||
      (input.pageId !== undefined && !safeId(input.pageId)) ||
      !onlyKeys(input, ["action", "label", "name", "index", "pageId"])
    ) {
      return undefined;
    }
    return {
      action: "create",
      label: input.label,
      name: input.name,
      ...(typeof input.index === "number" ? { index: input.index } : {}),
    };
  }
  if (input.action === "rename") {
    if (
      !safeId(input.pageId) ||
      !safePageName(input.name) ||
      !optionalIndex(input.index) ||
      !onlyKeys(input, ["action", "label", "pageId", "name", "index"])
    ) {
      return undefined;
    }
    return {
      action: "rename",
      label: input.label,
      pageId: input.pageId,
      name: input.name,
    };
  }
  return isDesignPageToolInput(input) ? input : undefined;
}

export function isPageStructureAccessToolInput(
  input: unknown,
): input is PageStructureAccessToolInput {
  const actions = new Set<PageStructureAccessAction>([
    "create-page",
    "duplicate-page",
    "reorder-pages",
    "delete-page",
    "cross-page-edit",
  ]);
  return (
    isRecord(input) &&
    Array.isArray(input.actions) &&
    input.actions.length > 0 &&
    input.actions.length <= actions.size &&
    input.actions.every(
      (action): action is PageStructureAccessAction =>
        typeof action === "string" &&
        actions.has(action as PageStructureAccessAction),
    ) &&
    new Set(input.actions).size === input.actions.length &&
    boundedText(input.reason, 500) &&
    input.reason.length >= 8 &&
    exactKeys(input, ["actions", "reason"])
  );
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

function safeLabel(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

function safePageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 256 &&
    !/\p{Cc}/u.test(value)
  );
}

function optionalIndex(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteBoundedPoint(value: unknown, maximum: number): value is Point {
  return (
    isRecord(value) &&
    finiteBounded(value.x, maximum) &&
    finiteBounded(value.y, maximum) &&
    exactKeys(value, ["x", "y"])
  );
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function positiveBounded(value: unknown, maximum: number): value is number {
  return positive(value) && value <= maximum;
}

function finiteBounded(value: unknown, maximum: number): value is number {
  return finite(value) && Math.abs(value) <= maximum;
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

function isDesignPlanRegion(
  value: unknown,
  artboardWidth: number,
  artboardHeight: number,
): value is DesignPlanRegion {
  if (
    !isRecord(value) ||
    !safeId(value.nodeId) ||
    !boundedText(value.name, 128) ||
    !isDesignPlanRegionRole(value.role) ||
    !finite(value.x) ||
    !finite(value.y) ||
    value.x < 0 ||
    value.y < 0 ||
    !positiveBounded(value.width, 100_000) ||
    !positiveBounded(value.height, 100_000) ||
    value.x + value.width > artboardWidth ||
    value.y + value.height > artboardHeight
  ) {
    return false;
  }
  return exactKeys(value, [
    "nodeId",
    "name",
    "role",
    "x",
    "y",
    "width",
    "height",
  ]);
}

function isDesignPlanRegionRole(value: unknown): value is DesignPlanRegionRole {
  return (
    value === "structure" ||
    value === "content" ||
    value === "typography" ||
    value === "media" ||
    value === "graphic" ||
    value === "decoration" ||
    value === "interaction" ||
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
