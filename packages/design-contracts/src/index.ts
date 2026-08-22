import {
  Type,
  type Static,
  type TObject,
  type TSchema,
  type TUnion,
} from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { checkSchema } from "./schema-check.js";
import * as layout from "./layout.js";
import {
  designDocumentHasValidLayoutLimits,
  designOperationHasValidLayoutLimits,
} from "./layout-limits-validation.js";
import * as limits from "./limits.js";
import * as versions from "./versions.js";
import {
  ComponentPropertyAssignmentsSchema,
  ComponentPropertyDefinitionsSchema,
  ComponentPropertyReferencesSchema,
  migrateFigmaComponentProperties,
} from "./component-properties.js";
import {
  DeleteVariantSetCommandSchema,
  PutVariantSetCommandSchema,
  VariantPropertiesSchema,
  VariantSetChangeSchema,
  VariantSetDefinitionSchema,
  migrateVariantSets,
} from "./variant-sets.js";
import {
  JsonObjectSchema,
  JsonValueSchema,
  NormalizedPointSchema,
  PointSchema,
  SizeSchema,
  TransformSchema,
} from "./primitives.js";
import * as variables from "./variables.js";
import * as styles from "./styles.js";
import * as exportSettings from "./export-settings.js";
import { ImageFiltersSchema, type ImageFilters } from "./image-filters.js";
import {
  BlendModeSchema,
  EffectSchema,
  ImagePaintSchema,
  PaintSchema,
} from "./appearance.js";
import type {
  AngularGradientPaintSchema,
  GradientStopSchema,
  LinearGradientPaintSchema,
  RadialGradientPaintSchema,
  SolidPaintSchema,
} from "./appearance.js";
export * from "./component-properties.js";
export * from "./variant-sets.js";
export * from "./primitives.js";
export * from "./versions.js";
export * from "./variables.js";
export * from "./styles.js";
export * from "./appearance.js";
export * from "./export-settings.js";
export * from "./image-filters.js";
export {
  normalizeLineEndpoints,
  resolveLineEndpointPoint,
  resolveRegularPolygonPoints,
  resolveStarPoints,
} from "./regular-geometry.js";
export * from "./layout.js";
export * from "./limits.js";
export const DESIGN_FORMAT = "dev.opendesign.document" as const;
export const NodeKindSchema = Type.Union([
  Type.Literal("frame"),
  Type.Literal("slot"),
  Type.Literal("group"),
  Type.Literal("boolean"),
  Type.Literal("rectangle"),
  Type.Literal("ellipse"),
  Type.Literal("line"),
  Type.Literal("polygon"),
  Type.Literal("star"),
  Type.Literal("text"),
  Type.Literal("image"),
  Type.Literal("vector"),
  Type.Literal("path"),
  Type.Literal("instance"),
  Type.Literal("slice"),
]);

export const RectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const {
  PaintStyleDefinitionSchema,
  TextStyleDefinitionSchema,
  EffectStyleDefinitionSchema,
  GridStyleDefinitionSchema,
  SharedStyleDefinitionSchema,
  StyleOrderByTypeSchema,
  StyleReferenceTargetSchema,
  PutStyleCommandSchema,
  DeleteStyleCommandSchema,
  MoveStyleCommandSchema,
  SetStyleReferenceCommandSchema,
  SharedStyleChangeSchema,
} = styles.createSharedStyleSchemas({
  paintSchema: PaintSchema,
  effectSchema: EffectSchema,
  layoutGuideSchema: layout.LayoutGuideSchema,
});

export const MaskModeSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("alpha"),
  Type.Literal("luminance"),
  Type.Literal("clipping"),
  Type.Literal("outline"),
]);

const ShapeProperties = {
  fills: Type.Array(PaintSchema),
  strokes: Type.Array(PaintSchema),
  strokeWidth: Type.Number({ minimum: 0 }),
  strokeAlign: Type.Optional(
    Type.Union([
      Type.Literal("inside"),
      Type.Literal("center"),
      Type.Literal("outside"),
    ]),
  ),
  strokeCap: Type.Optional(
    Type.Union([
      Type.Literal("none"),
      Type.Literal("round"),
      Type.Literal("square"),
    ]),
  ),
  strokeJoin: Type.Optional(
    Type.Union([
      Type.Literal("miter"),
      Type.Literal("round"),
      Type.Literal("bevel"),
    ]),
  ),
  dashPattern: Type.Optional(Type.Array(Type.Number({ minimum: 0 }))),
};

export const FramePropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    cornerRadius: Type.Number({ minimum: 0 }),
    clipsContent: Type.Boolean(),
    autoLayout: Type.Optional(layout.AutoLayoutSchema),
    layoutGuides: Type.Optional(
      Type.Array(layout.LayoutGuideSchema, { maxItems: 8 }),
    ),
  },
  { additionalProperties: false },
);

export const GroupPropertiesSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const RectanglePropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    cornerRadius: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const EllipsePropertiesSchema = Type.Object(ShapeProperties, {
  additionalProperties: false,
});

export const LineEndpointSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("line-arrow"),
  Type.Literal("triangle-arrow"),
  Type.Literal("reversed-triangle-arrow"),
  Type.Literal("circle"),
  Type.Literal("diamond"),
]);

export const LinePropertiesSchema = Type.Object(
  {
    fills: Type.Array(PaintSchema, { maxItems: 0 }),
    strokes: ShapeProperties.strokes,
    strokeWidth: ShapeProperties.strokeWidth,
    strokeAlign: Type.Optional(Type.Literal("center")),
    strokeCap: ShapeProperties.strokeCap,
    strokeJoin: ShapeProperties.strokeJoin,
    dashPattern: ShapeProperties.dashPattern,
    start: NormalizedPointSchema,
    end: NormalizedPointSchema,
    startEndpoint: LineEndpointSchema,
    endEndpoint: LineEndpointSchema,
  },
  { additionalProperties: false },
);

export const PolygonPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    pointCount: Type.Integer({ minimum: 3, maximum: 60 }),
    cornerRadius: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const StarPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    pointCount: Type.Integer({ minimum: 3, maximum: 60 }),
    innerRadius: Type.Number({ minimum: 0, maximum: 1 }),
    cornerRadius: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

const TextSharedProperties = {
  content: Type.String(),
  paragraphRuns: Type.Optional(
    Type.Array(
      Type.Object(
        {
          start: Type.Integer({ minimum: 0 }),
          end: Type.Integer({ minimum: 1 }),
          style: Type.Object(
            {
              listOptions: Type.Object(
                {
                  type: Type.Union([
                    Type.Literal("none"),
                    Type.Literal("ordered"),
                    Type.Literal("unordered"),
                  ]),
                },
                { additionalProperties: false },
              ),
              indentation: Type.Integer({ minimum: 0, maximum: 5 }),
              listSpacing: Type.Number({ minimum: 0 }),
              paragraphIndent: Type.Number({ minimum: 0 }),
              paragraphSpacing: Type.Number({ minimum: 0 }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16_384 },
    ),
  ),
  runs: Type.Optional(
    Type.Array(
      Type.Object(
        {
          start: Type.Integer({ minimum: 0 }),
          end: Type.Integer({ minimum: 1 }),
          style: Type.Object(
            {
              ...styles.FontFaceIdentityProperties,
              fontSize: Type.Number({ exclusiveMinimum: 0 }),
              letterSpacing: Type.Number(),
              lineHeight: Type.Number({ exclusiveMinimum: 0 }),
              textCase: Type.Union([
                Type.Literal("original"),
                Type.Literal("uppercase"),
                Type.Literal("lowercase"),
                Type.Literal("title-case"),
                Type.Literal("small-caps"),
              ]),
              textDecoration: Type.Union([
                Type.Literal("none"),
                Type.Literal("underline"),
                Type.Literal("strikethrough"),
              ]),
              fills: Type.Array(PaintSchema, { maxItems: 64 }),
              textStyleId: Type.Optional(
                Type.String({ minLength: 1, maxLength: 512 }),
              ),
              fillStyleId: Type.Optional(
                Type.String({ minLength: 1, maxLength: 512 }),
              ),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
      { maxItems: 16_384 },
    ),
  ),
  ...styles.FontFaceIdentityProperties,
  fontSize: Type.Number({ exclusiveMinimum: 0 }),
  lineHeight: Type.Number({ exclusiveMinimum: 0 }),
  letterSpacing: Type.Number(),
  paragraphIndent: Type.Number({ minimum: 0 }),
  paragraphSpacing: Type.Number({ minimum: 0 }),
  listSpacing: Type.Number({ minimum: 0 }),
  hangingList: Type.Boolean(),
  textCase: Type.Union([
    Type.Literal("original"),
    Type.Literal("uppercase"),
    Type.Literal("lowercase"),
    Type.Literal("title-case"),
    Type.Literal("small-caps"),
  ]),
  textDecoration: Type.Union([
    Type.Literal("none"),
    Type.Literal("underline"),
    Type.Literal("strikethrough"),
  ]),
  textAlignHorizontal: Type.Union([
    Type.Literal("left"),
    Type.Literal("center"),
    Type.Literal("right"),
    Type.Literal("justify"),
  ]),
  textAlignVertical: Type.Union([
    Type.Literal("top"),
    Type.Literal("center"),
    Type.Literal("bottom"),
  ]),
  fills: Type.Array(PaintSchema),
  strokes: Type.Array(PaintSchema),
  strokeWidth: Type.Number({ minimum: 0 }),
  strokeAlign: ShapeProperties.strokeAlign,
  strokeCap: ShapeProperties.strokeCap,
  strokeJoin: ShapeProperties.strokeJoin,
  dashPattern: ShapeProperties.dashPattern,
} as const;

const FixedTextTruncationDisabledPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("fixed"),
    textWrap: Type.Union([
      Type.Literal("none"),
      Type.Literal("word"),
      Type.Literal("character"),
    ]),
    textOverflow: Type.Union([Type.Literal("visible"), Type.Literal("clip")]),
    textTruncation: Type.Literal("disabled"),
    maxLines: Type.Null(),
  },
  { additionalProperties: false },
);

const FixedTextTruncationEndingPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("fixed"),
    textWrap: Type.Union([
      Type.Literal("none"),
      Type.Literal("word"),
      Type.Literal("character"),
    ]),
    textOverflow: Type.Literal("clip"),
    textTruncation: Type.Literal("ending"),
    maxLines: Type.Union([Type.Null(), Type.Integer({ minimum: 1 })]),
  },
  { additionalProperties: false },
);

const AutoWidthTextTruncationDisabledPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("auto-width"),
    textWrap: Type.Literal("none"),
    textOverflow: Type.Literal("visible"),
    textTruncation: Type.Literal("disabled"),
    maxLines: Type.Null(),
  },
  { additionalProperties: false },
);

const AutoWidthTextTruncationEndingPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("auto-width"),
    textWrap: Type.Literal("none"),
    textOverflow: Type.Literal("visible"),
    textTruncation: Type.Literal("ending"),
    maxLines: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

const AutoHeightTextTruncationDisabledPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("auto-height"),
    textWrap: Type.Union([Type.Literal("word"), Type.Literal("character")]),
    textOverflow: Type.Literal("visible"),
    textTruncation: Type.Literal("disabled"),
    maxLines: Type.Null(),
  },
  { additionalProperties: false },
);

const AutoHeightTextTruncationEndingPropertiesSchema = Type.Object(
  {
    ...TextSharedProperties,
    textResize: Type.Literal("auto-height"),
    textWrap: Type.Union([Type.Literal("word"), Type.Literal("character")]),
    textOverflow: Type.Literal("visible"),
    textTruncation: Type.Literal("ending"),
    maxLines: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const TextPropertiesSchema = Type.Union([
  FixedTextTruncationDisabledPropertiesSchema,
  FixedTextTruncationEndingPropertiesSchema,
  AutoWidthTextTruncationDisabledPropertiesSchema,
  AutoWidthTextTruncationEndingPropertiesSchema,
  AutoHeightTextTruncationDisabledPropertiesSchema,
  AutoHeightTextTruncationEndingPropertiesSchema,
]);

export const ImagePlacementSchema = Type.Union([
  Type.Object(
    { mode: Type.Literal("stretch") },
    { additionalProperties: false },
  ),
  Type.Object({ mode: Type.Literal("fit") }, { additionalProperties: false }),
  Type.Object(
    {
      mode: Type.Literal("fill"),
      focalPoint: NormalizedPointSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      mode: Type.Literal("crop"),
      focalPoint: NormalizedPointSchema,
      zoom: Type.Number({ minimum: 1, maximum: 64 }),
      rotation: Type.Number({ minimum: -360, maximum: 360 }),
      flipHorizontal: Type.Boolean(),
      flipVertical: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
]);

export const ImagePropertiesSchema = Type.Object(
  {
    assetId: Type.String({ minLength: 1 }),
    placement: ImagePlacementSchema,
    filters: Type.Optional(ImageFiltersSchema),
    altText: Type.String(),
    cornerRadius: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PathDataSchema = Type.String({
  minLength: 1,
  maxLength: 200_000,
  pattern: "^[\\t\\n\\r ,.+\\-0-9AaCcEeHhLlMmQqSsTtVvZz]+$",
});

export const VectorGeometryIdSchema = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: "^[A-Za-z][A-Za-z0-9._:-]*$",
});

export const VectorPointModeSchema = Type.Union([
  Type.Literal("corner"),
  Type.Literal("smooth"),
  Type.Literal("mirrored"),
  Type.Literal("independent"),
]);

export const VectorVertexSchema = Type.Object(
  {
    id: VectorGeometryIdSchema,
    x: Type.Number(),
    y: Type.Number(),
    handleMode: Type.Optional(VectorPointModeSchema),
  },
  { additionalProperties: false },
);

export const VectorSegmentSchema = Type.Object(
  {
    id: VectorGeometryIdSchema,
    startVertexId: VectorGeometryIdSchema,
    endVertexId: VectorGeometryIdSchema,
    tangentStart: Type.Optional(PointSchema),
    tangentEnd: Type.Optional(PointSchema),
  },
  { additionalProperties: false },
);

export const VectorSegmentReferenceSchema = Type.Object(
  {
    segmentId: VectorGeometryIdSchema,
    reversed: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const VectorPathRunSchema = Type.Object(
  {
    id: VectorGeometryIdSchema,
    closed: Type.Boolean(),
    segments: Type.Array(VectorSegmentReferenceSchema, {
      minItems: 1,
      maxItems: 16_384,
    }),
  },
  { additionalProperties: false },
);

export const VectorRegionSchema = Type.Object(
  {
    id: VectorGeometryIdSchema,
    windingRule: Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]),
    loops: Type.Array(
      Type.Object(
        {
          pathId: VectorGeometryIdSchema,
          reversed: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: 1_024 },
    ),
  },
  { additionalProperties: false },
);

export const VectorNetworkSchema = Type.Object(
  {
    vertices: Type.Array(VectorVertexSchema, {
      minItems: 2,
      maxItems: 16_384,
    }),
    segments: Type.Array(VectorSegmentSchema, {
      minItems: 1,
      maxItems: 16_384,
    }),
    paths: Type.Array(VectorPathRunSchema, {
      minItems: 1,
      maxItems: 16_384,
    }),
    regions: Type.Array(VectorRegionSchema, { maxItems: 16_384 }),
  },
  { additionalProperties: false },
);

export const PathDataPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    path: PathDataSchema,
    fillRule: Type.Optional(
      Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]),
    ),
  },
  { additionalProperties: false },
);

export const VectorNetworkPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    network: VectorNetworkSchema,
    fillRule: Type.Optional(
      Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]),
    ),
  },
  { additionalProperties: false },
);

export const PathPropertiesSchema = Type.Union([
  PathDataPropertiesSchema,
  VectorNetworkPropertiesSchema,
]);

export const BooleanOperationSchema = Type.Union([
  Type.Literal("union"),
  Type.Literal("subtract"),
  Type.Literal("intersect"),
  Type.Literal("exclude"),
]);

export const BooleanPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    operation: BooleanOperationSchema,
    fillRule: Type.Optional(
      Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]),
    ),
  },
  { additionalProperties: false },
);

export const ComponentOverridePatchSchema = Type.Object(
  {
    name: Type.Optional(Type.String()),
    visible: Type.Optional(Type.Boolean()),
    locked: Type.Optional(Type.Boolean()),
    opacity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    blendMode: Type.Optional(BlendModeSchema),
    effects: Type.Optional(Type.Array(EffectSchema)),
    maskMode: Type.Optional(MaskModeSchema),
    properties: Type.Optional(JsonObjectSchema),
  },
  { additionalProperties: false },
);

export const ComponentOverrideSchema = Type.Object(
  {
    sourcePath: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      maxItems: 64,
    }),
    patch: ComponentOverridePatchSchema,
  },
  { additionalProperties: false },
);

export const InstancePropertiesSchema = Type.Object(
  {
    componentId: Type.String({ minLength: 1 }),
    componentProperties: ComponentPropertyAssignmentsSchema,
    overrides: Type.Array(ComponentOverrideSchema, { maxItems: 4_096 }),
  },
  { additionalProperties: false },
);

export const ComponentDefinitionSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    rootNodeId: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    componentPropertyOrder: Type.Array(
      Type.String({ minLength: 1, maxLength: 512 }),
      { maxItems: 4_096, uniqueItems: true },
    ),
    componentPropertyDefinitions: ComponentPropertyDefinitionsSchema,
    variantSetId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    variantProperties: VariantPropertiesSchema,
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

const NodeBaseProperties = {
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  childIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  visible: Type.Boolean(),
  locked: Type.Boolean(),
  transform: TransformSchema,
  size: SizeSchema,
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  constraints: Type.Optional(layout.LayoutConstraintsSchema),
  layoutPositioning: Type.Optional(layout.LayoutPositioningSchema),
  layoutSizing: Type.Optional(layout.LayoutSizingSchema),
  layoutLimits: Type.Optional(layout.LayoutLimitsSchema),
  gridPlacement: Type.Optional(layout.GridChildPlacementSchema),
  componentPropertyReferences: Type.Optional(
    Type.Union([ComponentPropertyReferencesSchema, Type.Null()]),
  ),
  blendMode: Type.Optional(BlendModeSchema),
  effects: Type.Optional(Type.Array(EffectSchema)),
  maskMode: Type.Optional(MaskModeSchema),
  explicitVariableModes: Type.Optional(variables.ExplicitVariableModesSchema),
  boundVariables: Type.Optional(variables.NodeBoundVariablesSchema),
  ...styles.NodeStyleReferenceProperties,
  exportSettings: exportSettings.ExportSettingsSchema,
  extensions: JsonObjectSchema,
};

export const FrameNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("frame"),
    properties: FramePropertiesSchema,
  },
  { additionalProperties: false },
);

export const SlotPropertiesSchema = Type.Object(
  {
    ...ShapeProperties,
    cornerRadius: Type.Number({ minimum: 0 }),
    clipsContent: Type.Boolean(),
    autoLayout: Type.Optional(layout.AutoLayoutSchema),
    sourceSlotId: Type.Union([
      Type.String({ minLength: 1, maxLength: 256 }),
      Type.Null(),
    ]),
  },
  { additionalProperties: false },
);

export const SlotNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("slot"),
    properties: SlotPropertiesSchema,
  },
  { additionalProperties: false },
);

export const GroupNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("group"),
    properties: GroupPropertiesSchema,
  },
  { additionalProperties: false },
);

export const BooleanNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("boolean"),
    properties: BooleanPropertiesSchema,
  },
  { additionalProperties: false },
);

export const RectangleNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("rectangle"),
    properties: RectanglePropertiesSchema,
  },
  { additionalProperties: false },
);

export const EllipseNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("ellipse"),
    properties: EllipsePropertiesSchema,
  },
  { additionalProperties: false },
);

export const LineNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("line"),
    properties: LinePropertiesSchema,
  },
  { additionalProperties: false },
);

export const PolygonNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("polygon"),
    properties: PolygonPropertiesSchema,
  },
  { additionalProperties: false },
);

export const StarNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("star"),
    properties: StarPropertiesSchema,
  },
  { additionalProperties: false },
);

export const TextNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("text"),
    properties: TextPropertiesSchema,
  },
  { additionalProperties: false },
);

export const ImageNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("image"),
    properties: ImagePropertiesSchema,
  },
  { additionalProperties: false },
);

export const VectorNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("vector"),
    properties: PathPropertiesSchema,
  },
  { additionalProperties: false },
);

export const PathNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    kind: Type.Literal("path"),
    properties: PathPropertiesSchema,
  },
  { additionalProperties: false },
);

export const InstanceNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    childIds: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
      maxItems: 4_096,
    }),
    kind: Type.Literal("instance"),
    properties: InstancePropertiesSchema,
  },
  { additionalProperties: false },
);

export const SlicePropertiesSchema = Type.Object(
  {},
  { additionalProperties: false },
);

export const SliceNodeSchema = Type.Object(
  {
    ...NodeBaseProperties,
    childIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 0 }),
    kind: Type.Literal("slice"),
    properties: SlicePropertiesSchema,
  },
  { additionalProperties: false },
);

export const DesignNodeSchema: TUnion<
  [
    typeof FrameNodeSchema,
    typeof SlotNodeSchema,
    typeof GroupNodeSchema,
    typeof BooleanNodeSchema,
    typeof RectangleNodeSchema,
    typeof EllipseNodeSchema,
    typeof LineNodeSchema,
    typeof PolygonNodeSchema,
    typeof StarNodeSchema,
    typeof TextNodeSchema,
    typeof ImageNodeSchema,
    typeof VectorNodeSchema,
    typeof PathNodeSchema,
    typeof InstanceNodeSchema,
    typeof SliceNodeSchema,
  ]
> = Type.Union([
  FrameNodeSchema,
  SlotNodeSchema,
  GroupNodeSchema,
  BooleanNodeSchema,
  RectangleNodeSchema,
  EllipseNodeSchema,
  LineNodeSchema,
  PolygonNodeSchema,
  StarNodeSchema,
  TextNodeSchema,
  ImageNodeSchema,
  VectorNodeSchema,
  PathNodeSchema,
  InstanceNodeSchema,
  SliceNodeSchema,
]);

export const DesignPageSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String(),
    rootNodeIds: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
    explicitVariableModes: Type.Optional(variables.ExplicitVariableModesSchema),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const DesignAssetSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    kind: Type.Union([
      Type.Literal("image"),
      Type.Literal("font"),
      Type.Literal("binary"),
    ]),
    name: Type.String(),
    mimeType: Type.String({ minLength: 1 }),
    source: Type.Object(
      {
        type: Type.Union([
          Type.Literal("uri"),
          Type.Literal("data"),
          Type.Literal("external"),
        ]),
        value: Type.String(),
      },
      { additionalProperties: false },
    ),
    size: Type.Optional(SizeSchema),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const ImageAssetDerivationOperationSchema = Type.Union([
  Type.Literal("replacement"),
  Type.Literal("remove-background"),
  Type.Literal("replace-background"),
  Type.Literal("erase-object"),
  Type.Literal("isolate-object"),
  Type.Literal("expand"),
  Type.Literal("upscale"),
  Type.Literal("prompt-edit"),
  Type.Literal("relight"),
  Type.Literal("style-harmonize"),
]);

export const ImageAssetDerivationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    sourceAssetId: Type.String({ minLength: 1 }),
    resultAssetId: Type.String({ minLength: 1 }),
    operation: ImageAssetDerivationOperationSchema,
    prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 32_000 })),
    maskAssetId: Type.Optional(Type.String({ minLength: 1 })),
    referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
      maxItems: 16,
      uniqueItems: true,
    }),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

const LibraryReleaseIdentityProperties = {
  libraryId: Type.String({ minLength: 1, maxLength: 256 }),
  releaseId: Type.String({ minLength: 1, maxLength: 256 }),
  sourceProjectId: Type.String({ minLength: 1, maxLength: 256 }),
  sourceDesignFileId: Type.String({ minLength: 1, maxLength: 256 }),
  sourceDocumentId: Type.String({ minLength: 1, maxLength: 256 }),
};

export const LibraryReleaseIdentitySchema = Type.Object(
  LibraryReleaseIdentityProperties,
  { additionalProperties: false },
);

export const LibraryComponentSourceSchema = Type.Object(
  {
    source: Type.Object(
      {
        ...LibraryReleaseIdentityProperties,
        sourceComponentId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    component: ComponentDefinitionSchema,
    nodesById: Type.Record(Type.String(), DesignNodeSchema),
    assetsById: Type.Record(Type.String(), DesignAssetSchema),
    dependencyComponentIds: Type.Array(
      Type.String({ minLength: 1, maxLength: 256 }),
      { maxItems: 4_096, uniqueItems: true },
    ),
  },
  { additionalProperties: false },
);

export const LibraryVariantSetSourceSchema = Type.Object(
  {
    source: Type.Object(
      {
        ...LibraryReleaseIdentityProperties,
        sourceVariantSetId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    variantSet: VariantSetDefinitionSchema,
  },
  { additionalProperties: false },
);

export const LibraryStyleSourceSchema = Type.Object(
  {
    source: Type.Object(
      {
        ...LibraryReleaseIdentityProperties,
        sourceStyleId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    style: SharedStyleDefinitionSchema,
  },
  { additionalProperties: false },
);

export const LibraryVariableCollectionSourceSchema = Type.Object(
  {
    source: Type.Object(
      {
        ...LibraryReleaseIdentityProperties,
        sourceVariableCollectionId: Type.String({
          minLength: 1,
          maxLength: 256,
        }),
      },
      { additionalProperties: false },
    ),
    collection: variables.VariableCollectionDefinitionSchema,
  },
  { additionalProperties: false },
);

export const LibraryVariableSourceSchema = Type.Object(
  {
    source: Type.Object(
      {
        ...LibraryReleaseIdentityProperties,
        sourceVariableId: Type.String({ minLength: 1, maxLength: 256 }),
      },
      { additionalProperties: false },
    ),
    variable: variables.VariableDefinitionSchema,
  },
  { additionalProperties: false },
);

export const LibraryReleaseSnapshotSchema = Type.Object(
  {
    version: Type.Literal(3),
    libraryId: Type.String({ minLength: 1, maxLength: 256 }),
    releaseId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceProjectId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceDesignFileId: Type.String({ minLength: 1, maxLength: 256 }),
    sourceDocumentId: Type.String({ minLength: 1, maxLength: 256 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
    publishedAt: Type.String({ minLength: 1, maxLength: 64 }),
    componentsById: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      LibraryComponentSourceSchema,
    ),
    variantSetsById: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      LibraryVariantSetSourceSchema,
    ),
    stylesById: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      LibraryStyleSourceSchema,
    ),
    variableCollectionsById: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      LibraryVariableCollectionSourceSchema,
    ),
    variablesById: Type.Record(
      Type.String({ minLength: 1, maxLength: 256 }),
      LibraryVariableSourceSchema,
    ),
  },
  { additionalProperties: false },
);

const DesignDocumentIdentityProperties = {
  format: Type.Literal(DESIGN_FORMAT),
  schemaVersion: Type.Literal(versions.DESIGN_SCHEMA_VERSION),
  documentId: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 0 }),
  pageOrder: Type.Array(Type.String({ minLength: 1 }), {
    minItems: 1,
    uniqueItems: true,
  }),
  pagesById: Type.Record(Type.String(), DesignPageSchema),
  nodesById: Type.Record(Type.String(), DesignNodeSchema),
};

const DesignDocumentResourceProperties = {
  componentsById: Type.Record(Type.String(), ComponentDefinitionSchema),
  variantSetsById: Type.Record(Type.String(), VariantSetDefinitionSchema),
  libraryComponentsById: Type.Record(
    Type.String(),
    LibraryComponentSourceSchema,
  ),
  libraryVariantSetsById: Type.Record(
    Type.String(),
    LibraryVariantSetSourceSchema,
  ),
  libraryStylesById: Type.Record(Type.String(), LibraryStyleSourceSchema),
  libraryVariableCollectionsById: Type.Record(
    Type.String(),
    LibraryVariableCollectionSourceSchema,
  ),
  libraryVariablesById: Type.Record(Type.String(), LibraryVariableSourceSchema),
  styleOrderByType: StyleOrderByTypeSchema,
  stylesById: Type.Record(Type.String(), SharedStyleDefinitionSchema),
  interactionsById: Type.Record(Type.String(), JsonValueSchema),
  assetsById: Type.Record(Type.String(), DesignAssetSchema),
  imageAssetDerivationOrder: Type.Array(
    Type.String({ minLength: 1, maxLength: 256 }),
    { maxItems: 65_536, uniqueItems: true },
  ),
  imageAssetDerivationsById: Type.Record(
    Type.String(),
    ImageAssetDerivationSchema,
  ),
  extensions: JsonObjectSchema,
};

type DesignDocumentProperties = typeof DesignDocumentIdentityProperties &
  typeof DesignDocumentResourceProperties &
  typeof variables.VariableDocumentProperties;

export const DesignDocumentSchema: TObject<DesignDocumentProperties> =
  Type.Object(
    {
      ...DesignDocumentIdentityProperties,
      ...DesignDocumentResourceProperties,
      ...variables.VariableDocumentProperties,
    },
    { additionalProperties: false },
  );

const OperationBaseProperties = {
  commandId: Type.String({ minLength: 1 }),
};

export const InsertElementCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("insert_element"),
    pageId: Type.String({ minLength: 1 }),
    parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    index: Type.Integer({ minimum: 0 }),
    node: DesignNodeSchema,
  },
  { additionalProperties: false },
);

export const UpdatePropertiesCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("update_properties"),
    nodeId: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    visible: Type.Optional(Type.Boolean()),
    locked: Type.Optional(Type.Boolean()),
    transform: Type.Optional(TransformSchema),
    size: Type.Optional(SizeSchema),
    opacity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    constraints: Type.Optional(
      Type.Union([layout.LayoutConstraintsSchema, Type.Null()]),
    ),
    layoutPositioning: Type.Optional(
      Type.Union([layout.LayoutPositioningSchema, Type.Null()]),
    ),
    layoutSizing: Type.Optional(
      Type.Union([layout.LayoutSizingSchema, Type.Null()]),
    ),
    layoutLimits: Type.Optional(
      Type.Union([layout.LayoutLimitsSchema, Type.Null()]),
    ),
    gridPlacement: Type.Optional(
      Type.Union([layout.GridChildPlacementSchema, Type.Null()]),
    ),
    componentPropertyReferences: Type.Optional(
      Type.Union([ComponentPropertyReferencesSchema, Type.Null()]),
    ),
    blendMode: Type.Optional(BlendModeSchema),
    effects: Type.Optional(Type.Array(EffectSchema)),
    maskMode: Type.Optional(MaskModeSchema),
    exportSettings: Type.Optional(exportSettings.ExportSettingsSchema),
    properties: Type.Optional(JsonObjectSchema),
    extensions: Type.Optional(JsonObjectSchema),
  },
  { additionalProperties: false },
);

export const MoveElementCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("move_element"),
    nodeId: Type.String({ minLength: 1 }),
    pageId: Type.String({ minLength: 1 }),
    parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    index: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const DeleteElementCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_element"),
    nodeId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const ReplaceSubtreeCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("replace_subtree"),
    rootNodeId: Type.String({ minLength: 1 }),
    nodes: Type.Array(DesignNodeSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export const TextFontDescriptorSchema = Type.Object(
  styles.FontFaceIdentityProperties,
  { additionalProperties: false },
);

export const ReflowTextCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("reflow_text"),
    nodeIds: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 1_000,
      uniqueItems: true,
    }),
    expectedFont: TextFontDescriptorSchema,
    replacementFont: Type.Optional(TextFontDescriptorSchema),
  },
  { additionalProperties: false },
);

export const UpdateTextRangeStyleCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("update_text_range_style"),
    nodeId: Type.String({ minLength: 1, maxLength: 256 }),
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    style: Type.Object(
      {
        fontFamily: Type.Optional(
          Type.String({ minLength: 1, maxLength: 4_096 }),
        ),
        fontStyleName: Type.Optional(
          Type.Union([
            Type.String({ minLength: 1, maxLength: 512 }),
            Type.Null(),
          ]),
        ),
        fontSize: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        fontWeight: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_000 })),
        fontSlant: Type.Optional(
          Type.Union([Type.Literal("normal"), Type.Literal("italic")]),
        ),
        letterSpacing: Type.Optional(Type.Number()),
        lineHeight: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
        textCase: Type.Optional(
          Type.Union([
            Type.Literal("original"),
            Type.Literal("uppercase"),
            Type.Literal("lowercase"),
            Type.Literal("title-case"),
            Type.Literal("small-caps"),
          ]),
        ),
        textDecoration: Type.Optional(
          Type.Union([
            Type.Literal("none"),
            Type.Literal("underline"),
            Type.Literal("strikethrough"),
          ]),
        ),
        paragraphIndent: Type.Optional(Type.Number({ minimum: 0 })),
        paragraphSpacing: Type.Optional(Type.Number({ minimum: 0 })),
        listOptions: Type.Optional(
          Type.Object(
            {
              type: Type.Union([
                Type.Literal("none"),
                Type.Literal("ordered"),
                Type.Literal("unordered"),
              ]),
            },
            { additionalProperties: false },
          ),
        ),
        indentation: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
        listSpacing: Type.Optional(Type.Number({ minimum: 0 })),
        fills: Type.Optional(Type.Array(PaintSchema, { maxItems: 64 })),
        textStyleId: Type.Optional(
          Type.Union([
            Type.String({ minLength: 1, maxLength: 512 }),
            Type.Null(),
          ]),
        ),
        fillStyleId: Type.Optional(
          Type.Union([
            Type.String({ minLength: 1, maxLength: 512 }),
            Type.Null(),
          ]),
        ),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);

export const CommitTextEditParagraphPatchSchema = Type.Object(
  {
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 1 }),
    style: Type.Object(
      {
        paragraphIndent: Type.Optional(Type.Number({ minimum: 0 })),
        paragraphSpacing: Type.Optional(Type.Number({ minimum: 0 })),
        listOptions: Type.Optional(
          Type.Object(
            {
              type: Type.Union([
                Type.Literal("none"),
                Type.Literal("ordered"),
                Type.Literal("unordered"),
              ]),
            },
            { additionalProperties: false },
          ),
        ),
        indentation: Type.Optional(Type.Integer({ minimum: 0, maximum: 5 })),
        listSpacing: Type.Optional(Type.Number({ minimum: 0 })),
      },
      { additionalProperties: false, minProperties: 1 },
    ),
  },
  { additionalProperties: false },
);

export const CommitTextEditCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("commit_text_edit"),
    nodeId: Type.String({ minLength: 1, maxLength: 256 }),
    content: Type.String(),
    paragraphPatches: Type.Array(CommitTextEditParagraphPatchSchema, {
      maxItems: 16_384,
    }),
    runs: TextSharedProperties.runs,
  },
  { additionalProperties: false },
);

export const PutAssetCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_asset"),
    asset: DesignAssetSchema,
  },
  { additionalProperties: false },
);

export const DeleteAssetCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_asset"),
    assetId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const PutImageAssetDerivationCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_image_asset_derivation"),
    derivation: ImageAssetDerivationSchema,
  },
  { additionalProperties: false },
);

export const DeleteImageAssetDerivationCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_image_asset_derivation"),
    derivationId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);

export const PutComponentCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_component"),
    component: ComponentDefinitionSchema,
  },
  { additionalProperties: false },
);
export const DeleteComponentCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_component"),
    componentId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export const PutLibraryComponentSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_library_component_source"),
    source: LibraryComponentSourceSchema,
  },
  { additionalProperties: false },
);
export const DeleteLibraryComponentSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_library_component_source"),
    componentId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const PutLibraryVariantSetSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_library_variant_set_source"),
    source: LibraryVariantSetSourceSchema,
  },
  { additionalProperties: false },
);
export const DeleteLibraryVariantSetSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_library_variant_set_source"),
    variantSetId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const PutLibraryStyleSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_library_style_source"),
    source: LibraryStyleSourceSchema,
  },
  { additionalProperties: false },
);
export const DeleteLibraryStyleSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_library_style_source"),
    styleId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const PutLibraryVariableCollectionSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_library_variable_collection_source"),
    source: LibraryVariableCollectionSourceSchema,
  },
  { additionalProperties: false },
);
export const DeleteLibraryVariableCollectionSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_library_variable_collection_source"),
    collectionId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const PutLibraryVariableSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("put_library_variable_source"),
    source: LibraryVariableSourceSchema,
  },
  { additionalProperties: false },
);
export const DeleteLibraryVariableSourceCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_library_variable_source"),
    variableId: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const InsertPageCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("insert_page"),
    index: Type.Integer({ minimum: 0 }),
    page: DesignPageSchema,
    nodes: Type.Array(DesignNodeSchema, {
      maxItems: limits.MAX_PAGE_TRANSACTION_NODES,
    }),
  },
  { additionalProperties: false },
);
export const UpdatePageCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("update_page"),
    pageId: Type.String({ minLength: 1 }),
    name: Type.String({ minLength: 1, maxLength: 256 }),
  },
  { additionalProperties: false },
);
export const MovePageCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("move_page"),
    pageId: Type.String({ minLength: 1 }),
    index: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const DeletePageCommandSchema = Type.Object(
  {
    ...OperationBaseProperties,
    type: Type.Literal("delete_page"),
    pageId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export const NodeDesignOperationSchema: TUnion<
  [
    typeof InsertElementCommandSchema,
    typeof UpdatePropertiesCommandSchema,
    typeof MoveElementCommandSchema,
    typeof DeleteElementCommandSchema,
    typeof ReplaceSubtreeCommandSchema,
    typeof ReflowTextCommandSchema,
    typeof UpdateTextRangeStyleCommandSchema,
    typeof CommitTextEditCommandSchema,
  ]
> = Type.Union([
  InsertElementCommandSchema,
  UpdatePropertiesCommandSchema,
  MoveElementCommandSchema,
  DeleteElementCommandSchema,
  ReplaceSubtreeCommandSchema,
  ReflowTextCommandSchema,
  UpdateTextRangeStyleCommandSchema,
  CommitTextEditCommandSchema,
]);

export const DesignOperationSchema: TUnion<
  [
    typeof NodeDesignOperationSchema,
    typeof PutAssetCommandSchema,
    typeof DeleteAssetCommandSchema,
    typeof PutImageAssetDerivationCommandSchema,
    typeof DeleteImageAssetDerivationCommandSchema,
    typeof PutComponentCommandSchema,
    typeof DeleteComponentCommandSchema,
    typeof PutLibraryComponentSourceCommandSchema,
    typeof DeleteLibraryComponentSourceCommandSchema,
    typeof PutLibraryVariantSetSourceCommandSchema,
    typeof DeleteLibraryVariantSetSourceCommandSchema,
    typeof PutLibraryStyleSourceCommandSchema,
    typeof DeleteLibraryStyleSourceCommandSchema,
    typeof PutLibraryVariableCollectionSourceCommandSchema,
    typeof DeleteLibraryVariableCollectionSourceCommandSchema,
    typeof PutLibraryVariableSourceCommandSchema,
    typeof DeleteLibraryVariableSourceCommandSchema,
    typeof variables.PutVariableCollectionCommandSchema,
    typeof variables.DeleteVariableCollectionCommandSchema,
    typeof variables.MoveVariableCollectionCommandSchema,
    typeof variables.PutVariableCommandSchema,
    typeof variables.DeleteVariableCommandSchema,
    typeof variables.SetExplicitVariableModesCommandSchema,
    typeof variables.SetVariableBindingCommandSchema,
    typeof PutStyleCommandSchema,
    typeof DeleteStyleCommandSchema,
    typeof MoveStyleCommandSchema,
    typeof SetStyleReferenceCommandSchema,
    typeof PutVariantSetCommandSchema,
    typeof DeleteVariantSetCommandSchema,
    typeof InsertPageCommandSchema,
    typeof UpdatePageCommandSchema,
    typeof MovePageCommandSchema,
    typeof DeletePageCommandSchema,
  ]
> = Type.Union([
  NodeDesignOperationSchema,
  PutAssetCommandSchema,
  DeleteAssetCommandSchema,
  PutImageAssetDerivationCommandSchema,
  DeleteImageAssetDerivationCommandSchema,
  PutComponentCommandSchema,
  DeleteComponentCommandSchema,
  PutLibraryComponentSourceCommandSchema,
  DeleteLibraryComponentSourceCommandSchema,
  PutLibraryVariantSetSourceCommandSchema,
  DeleteLibraryVariantSetSourceCommandSchema,
  PutLibraryStyleSourceCommandSchema,
  DeleteLibraryStyleSourceCommandSchema,
  PutLibraryVariableCollectionSourceCommandSchema,
  DeleteLibraryVariableCollectionSourceCommandSchema,
  PutLibraryVariableSourceCommandSchema,
  DeleteLibraryVariableSourceCommandSchema,
  variables.PutVariableCollectionCommandSchema,
  variables.DeleteVariableCollectionCommandSchema,
  variables.MoveVariableCollectionCommandSchema,
  variables.PutVariableCommandSchema,
  variables.DeleteVariableCommandSchema,
  variables.SetExplicitVariableModesCommandSchema,
  variables.SetVariableBindingCommandSchema,
  PutStyleCommandSchema,
  DeleteStyleCommandSchema,
  MoveStyleCommandSchema,
  SetStyleReferenceCommandSchema,
  PutVariantSetCommandSchema,
  DeleteVariantSetCommandSchema,
  InsertPageCommandSchema,
  UpdatePageCommandSchema,
  MovePageCommandSchema,
  DeletePageCommandSchema,
]);

export const DesignActorSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("user"),
      Type.Literal("agent"),
      Type.Literal("system"),
      Type.Literal("plugin"),
    ]),
    id: Type.String({ minLength: 1 }),
    displayName: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

type DesignTransactionValue = {
  transactionId: string;
  documentId: string;
  baseRevision: number;
  actor: Static<typeof DesignActorSchema>;
  label?: string;
  summary?: string;
  commands: Array<Static<typeof DesignOperationSchema>>;
  extensions?: Static<typeof JsonObjectSchema>;
};

export const DesignTransactionSchema: TSchema & {
  static: DesignTransactionValue;
} = Type.Object(
  {
    transactionId: Type.String({ minLength: 1 }),
    documentId: Type.String({ minLength: 1 }),
    baseRevision: Type.Integer({ minimum: 0 }),
    actor: DesignActorSchema,
    label: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    commands: Type.Array(DesignOperationSchema, {
      minItems: 1,
      maxItems: limits.MAX_TRANSACTION_COMMANDS,
    }),
    extensions: Type.Optional(JsonObjectSchema),
  },
  { additionalProperties: false },
);

export const DesignErrorCodeSchema = Type.Union([
  Type.Literal("unsupported"),
  Type.Literal("conflict"),
  Type.Literal("invalid"),
  Type.Literal("permission-denied"),
  Type.Literal("cancelled"),
  Type.Literal("not-found"),
  Type.Literal("duplicate"),
  Type.Literal("engine-failure"),
]);

export const DesignErrorSchema = Type.Object(
  {
    code: DesignErrorCodeSchema,
    message: Type.String({ minLength: 1 }),
    commandId: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String()),
    retryable: Type.Boolean(),
    details: Type.Optional(JsonValueSchema),
  },
  { additionalProperties: false },
);

export const RevisionSchema = Type.Object(
  {
    revision: Type.Integer({ minimum: 0 }),
    createdAt: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String()),
    transactionId: Type.Optional(Type.String({ minLength: 1 })),
    actor: Type.Optional(DesignActorSchema),
  },
  { additionalProperties: false },
);

type NodeChangeValue = {
  type: "added" | "updated" | "moved" | "removed";
  nodeId: string;
  before?: Static<typeof DesignNodeSchema>;
  after?: Static<typeof DesignNodeSchema>;
  changedFields: string[];
};

export const NodeChangeSchema: TSchema & { static: NodeChangeValue } =
  Type.Object(
    {
      type: Type.Union([
        Type.Literal("added"),
        Type.Literal("updated"),
        Type.Literal("moved"),
        Type.Literal("removed"),
      ]),
      nodeId: Type.String({ minLength: 1 }),
      before: Type.Optional(DesignNodeSchema),
      after: Type.Optional(DesignNodeSchema),
      changedFields: Type.Array(Type.String(), { uniqueItems: true }),
    },
    { additionalProperties: false },
  );

export const PageChangeSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("moved"),
      Type.Literal("removed"),
    ]),
    pageId: Type.String({ minLength: 1 }),
    before: Type.Optional(DesignPageSchema),
    after: Type.Optional(DesignPageSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

export const ComponentChangeSchema = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    componentId: Type.String({ minLength: 1 }),
    before: Type.Optional(ComponentDefinitionSchema),
    after: Type.Optional(ComponentDefinitionSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

type LibraryComponentSourceChangeValue = {
  type: "added" | "updated" | "removed";
  componentId: string;
  before?: Static<typeof LibraryComponentSourceSchema>;
  after?: Static<typeof LibraryComponentSourceSchema>;
  changedFields: string[];
};

export const LibraryComponentSourceChangeSchema: TSchema & {
  static: LibraryComponentSourceChangeValue;
} = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    componentId: Type.String({ minLength: 1 }),
    before: Type.Optional(LibraryComponentSourceSchema),
    after: Type.Optional(LibraryComponentSourceSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

type LibraryVariantSetSourceChangeValue = {
  type: "added" | "updated" | "removed";
  variantSetId: string;
  before?: Static<typeof LibraryVariantSetSourceSchema>;
  after?: Static<typeof LibraryVariantSetSourceSchema>;
  changedFields: string[];
};

export const LibraryVariantSetSourceChangeSchema: TSchema & {
  static: LibraryVariantSetSourceChangeValue;
} = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    variantSetId: Type.String({ minLength: 1 }),
    before: Type.Optional(LibraryVariantSetSourceSchema),
    after: Type.Optional(LibraryVariantSetSourceSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

type LibraryStyleSourceChangeValue = {
  type: "added" | "updated" | "removed";
  styleId: string;
  before?: Static<typeof LibraryStyleSourceSchema>;
  after?: Static<typeof LibraryStyleSourceSchema>;
  changedFields: string[];
};

export const LibraryStyleSourceChangeSchema: TSchema & {
  static: LibraryStyleSourceChangeValue;
} = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    styleId: Type.String({ minLength: 1 }),
    before: Type.Optional(LibraryStyleSourceSchema),
    after: Type.Optional(LibraryStyleSourceSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

type LibraryVariableCollectionSourceChangeValue = {
  type: "added" | "updated" | "removed";
  collectionId: string;
  before?: Static<typeof LibraryVariableCollectionSourceSchema>;
  after?: Static<typeof LibraryVariableCollectionSourceSchema>;
  changedFields: string[];
};

export const LibraryVariableCollectionSourceChangeSchema: TSchema & {
  static: LibraryVariableCollectionSourceChangeValue;
} = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    collectionId: Type.String({ minLength: 1 }),
    before: Type.Optional(LibraryVariableCollectionSourceSchema),
    after: Type.Optional(LibraryVariableCollectionSourceSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

type LibraryVariableSourceChangeValue = {
  type: "added" | "updated" | "removed";
  variableId: string;
  before?: Static<typeof LibraryVariableSourceSchema>;
  after?: Static<typeof LibraryVariableSourceSchema>;
  changedFields: string[];
};

export const LibraryVariableSourceChangeSchema: TSchema & {
  static: LibraryVariableSourceChangeValue;
} = Type.Object(
  {
    type: Type.Union([
      Type.Literal("added"),
      Type.Literal("updated"),
      Type.Literal("removed"),
    ]),
    variableId: Type.String({ minLength: 1 }),
    before: Type.Optional(LibraryVariableSourceSchema),
    after: Type.Optional(LibraryVariableSourceSchema),
    changedFields: Type.Array(Type.String(), { uniqueItems: true }),
  },
  { additionalProperties: false },
);

const DesignChangeSetCoreProperties = {
  documentId: Type.String({ minLength: 1 }),
  fromRevision: Type.Integer({ minimum: 0 }),
  toRevision: Type.Integer({ minimum: 0 }),
  addedNodeIds: Type.Array(Type.String(), { uniqueItems: true }),
  changedNodeIds: Type.Array(Type.String(), { uniqueItems: true }),
  removedNodeIds: Type.Array(Type.String(), { uniqueItems: true }),
  addedAssetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedAssetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedAssetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedImageAssetDerivationIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedImageAssetDerivationIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedImageAssetDerivationIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedPageIds: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  changedPageIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedPageIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedLibraryComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedLibraryComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedLibraryComponentIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedLibraryVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedLibraryVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedLibraryVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  addedVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedVariantSetIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
};

const DesignChangeSetDetailProperties = {
  pageChanges: Type.Optional(Type.Array(PageChangeSchema)),
  componentChanges: Type.Optional(Type.Array(ComponentChangeSchema)),
  libraryComponentChanges: Type.Optional(
    Type.Array(LibraryComponentSourceChangeSchema),
  ),
  libraryVariantSetChanges: Type.Optional(
    Type.Array(LibraryVariantSetSourceChangeSchema),
  ),
  addedLibraryStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedLibraryStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedLibraryStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  libraryStyleChanges: Type.Optional(
    Type.Array(LibraryStyleSourceChangeSchema),
  ),
  addedLibraryVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedLibraryVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedLibraryVariableCollectionIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  libraryVariableCollectionChanges: Type.Optional(
    Type.Array(LibraryVariableCollectionSourceChangeSchema),
  ),
  addedLibraryVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedLibraryVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedLibraryVariableIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  libraryVariableChanges: Type.Optional(
    Type.Array(LibraryVariableSourceChangeSchema),
  ),
  variantSetChanges: Type.Optional(Type.Array(VariantSetChangeSchema)),
  addedStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  changedStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  removedStyleIds: Type.Optional(
    Type.Array(Type.String(), { uniqueItems: true }),
  ),
  styleChanges: Type.Optional(Type.Array(SharedStyleChangeSchema)),
  changes: Type.Array(NodeChangeSchema),
};

type DesignChangeSetProperties = typeof DesignChangeSetCoreProperties &
  typeof DesignChangeSetDetailProperties &
  typeof variables.VariableChangeSetProperties;

export const DesignChangeSetSchema: TObject<DesignChangeSetProperties> =
  Type.Object(
    {
      ...DesignChangeSetCoreProperties,
      ...DesignChangeSetDetailProperties,
      ...variables.VariableChangeSetProperties,
    },
    { additionalProperties: false },
  );

export const FidelityWarningSchema = Type.Object(
  {
    nodeId: Type.Optional(Type.String({ minLength: 1 })),
    feature: Type.String({ minLength: 1 }),
    fallback: Type.String(),
    message: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export const TransactionModeSchema = Type.Union([
  Type.Literal("preview"),
  Type.Literal("apply"),
  Type.Literal("undo"),
  Type.Literal("redo"),
]);

export const DesignTransactionSuccessSchema = Type.Object(
  {
    ok: Type.Literal(true),
    mode: TransactionModeSchema,
    transactionId: Type.String({ minLength: 1 }),
    documentId: Type.String({ minLength: 1 }),
    baseRevision: Type.Integer({ minimum: 0 }),
    revision: RevisionSchema,
    changes: DesignChangeSetSchema,
    warnings: Type.Array(FidelityWarningSchema),
  },
  { additionalProperties: false },
);

export const DesignTransactionFailureSchema = Type.Object(
  {
    ok: Type.Literal(false),
    mode: TransactionModeSchema,
    transactionId: Type.String({ minLength: 1 }),
    documentId: Type.String({ minLength: 1 }),
    baseRevision: Type.Integer({ minimum: 0 }),
    revision: RevisionSchema,
    error: DesignErrorSchema,
  },
  { additionalProperties: false },
);

type DesignTransactionResultValue =
  | Static<typeof DesignTransactionSuccessSchema>
  | Static<typeof DesignTransactionFailureSchema>;

export const DesignTransactionResultSchema: TSchema & {
  static: DesignTransactionResultValue;
} = Type.Union([
  DesignTransactionSuccessSchema,
  DesignTransactionFailureSchema,
]);

export const HistoryEntrySchema = Type.Object(
  {
    transactionId: Type.String({ minLength: 1 }),
    label: Type.String(),
    actor: DesignActorSchema,
    revision: RevisionSchema,
    changes: DesignChangeSetSchema,
  },
  { additionalProperties: false },
);

export const HistoryStateSchema: TSchema = Type.Object(
  {
    canUndo: Type.Boolean(),
    canRedo: Type.Boolean(),
    undo: Type.Array(HistoryEntrySchema),
    redo: Type.Array(HistoryEntrySchema),
  },
  { additionalProperties: false },
);

export const ComponentSelectionTargetSchema = Type.Object(
  {
    instanceId: Type.String({ minLength: 1, maxLength: 256 }),
    sourcePath: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), {
      minItems: 1,
      maxItems: 64,
    }),
  },
  { additionalProperties: false },
);

export const SelectionStateSchema = Type.Object(
  {
    nodeIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    anchorNodeId: Type.Optional(Type.String({ minLength: 1 })),
    componentTarget: Type.Optional(ComponentSelectionTargetSchema),
  },
  { additionalProperties: false },
);

export const ViewportStateSchema = Type.Object(
  {
    panX: Type.Number(),
    panY: Type.Number(),
    zoom: Type.Number({ exclusiveMinimum: 0 }),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const EditorStateSchema: TSchema = Type.Object(
  {
    documentId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
    selection: SelectionStateSchema,
    tool: Type.String({ minLength: 1 }),
    viewport: ViewportStateSchema,
    dirty: Type.Boolean(),
    checkpointRevision: Type.Integer({ minimum: 0 }),
    history: HistoryStateSchema,
  },
  { additionalProperties: false },
);

const EditorEventBaseProperties = {
  eventId: Type.String({ minLength: 1 }),
  sequence: Type.Integer({ minimum: 1 }),
  occurredAt: Type.String({ minLength: 1 }),
  documentId: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 0 }),
};

export const EditorEventSchema: TSchema = Type.Union([
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("document.changed"),
      result: DesignTransactionSuccessSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("selection.changed"),
      selection: SelectionStateSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("tool.changed"),
      tool: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("viewport.changed"),
      viewport: ViewportStateSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("history.changed"),
      history: HistoryStateSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("dirty.changed"),
      dirty: Type.Boolean(),
      checkpointRevision: Type.Integer({ minimum: 0 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("checkpoint.created"),
      checkpointRevision: Type.Integer({ minimum: 0 }),
      label: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...EditorEventBaseProperties,
      type: Type.Literal("runtime.error"),
      error: DesignErrorSchema,
    },
    { additionalProperties: false },
  ),
]);

export const DesignCapabilitiesSchema = Type.Object(
  {
    schemaVersion: Type.Literal(versions.DESIGN_SCHEMA_VERSION),
    nodeKinds: Type.Array(NodeKindSchema, { uniqueItems: true }),
    operations: Type.Array(
      Type.Union([
        Type.Literal("insert_element"),
        Type.Literal("update_properties"),
        Type.Literal("move_element"),
        Type.Literal("delete_element"),
        Type.Literal("replace_subtree"),
        Type.Literal("reflow_text"),
        Type.Literal("update_text_range_style"),
        Type.Literal("put_asset"),
        Type.Literal("delete_asset"),
        Type.Literal("put_image_asset_derivation"),
        Type.Literal("delete_image_asset_derivation"),
      ]),
      { uniqueItems: true },
    ),
    limits: Type.Object(
      {
        maxCommandsPerTransaction: Type.Integer({ minimum: 1 }),
        maxDocumentNodes: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
    features: Type.Object(
      {
        preview: Type.Boolean(),
        atomicTransactions: Type.Boolean(),
        undoRedo: Type.Boolean(),
        hitTesting: Type.Boolean(),
        displayList: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    importFormats: Type.Array(Type.String()),
    exportFormats: Type.Array(Type.String()),
    extensions: JsonObjectSchema,
  },
  { additionalProperties: false },
);

export const ExportArtifactSchema = Type.Object(
  {
    artifactId: Type.String({ minLength: 1 }),
    mimeType: Type.String({ minLength: 1 }),
    path: Type.String({ minLength: 1 }),
    fidelity: Type.Object(
      {
        status: Type.Union([
          Type.Literal("exact"),
          Type.Literal("degraded"),
          Type.Literal("unsupported"),
        ]),
        warnings: Type.Array(FidelityWarningSchema),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

export const AtomicChildCommandSchema: typeof DesignOperationSchema =
  DesignOperationSchema;
export const DesignCommandSchema: typeof DesignOperationSchema =
  DesignOperationSchema;
export const RunAtomicDesignBatchCommandSchema: typeof DesignTransactionSchema =
  DesignTransactionSchema;

export type NodeKind = Static<typeof NodeKindSchema>;
export type Rect = Static<typeof RectSchema>;
export type BlendMode = Static<typeof BlendModeSchema>;
export type SolidPaint = Static<typeof SolidPaintSchema>;
export type GradientStop = Static<typeof GradientStopSchema>;
export type LinearGradientPaint = Static<typeof LinearGradientPaintSchema>;
export type RadialGradientPaint = Static<typeof RadialGradientPaintSchema>;
export type AngularGradientPaint = Static<typeof AngularGradientPaintSchema>;
export type ImagePaint = Static<typeof ImagePaintSchema>;
export type ImagePlacement = Static<typeof ImagePlacementSchema>;
export type Paint = Static<typeof PaintSchema>;
export type Effect = Static<typeof EffectSchema>;
export type SharedStyleType = Static<typeof styles.SharedStyleTypeSchema>;
export type TextStyleProperties = Static<
  typeof styles.TextStylePropertiesSchema
>;
export type PaintStyleDefinition = Static<typeof PaintStyleDefinitionSchema>;
export type TextStyleDefinition = Static<typeof TextStyleDefinitionSchema>;
export type EffectStyleDefinition = Static<typeof EffectStyleDefinitionSchema>;
export type GridStyleDefinition = Static<typeof GridStyleDefinitionSchema>;
export type SharedStyleDefinition = Static<typeof SharedStyleDefinitionSchema>;
export type StyleOrderByType = Static<typeof StyleOrderByTypeSchema>;
export type StyleReferenceTarget = Static<typeof StyleReferenceTargetSchema>;
export type SharedStyleChange = Static<typeof SharedStyleChangeSchema>;
export type MaskMode = Static<typeof MaskModeSchema>;
export type LineEndpoint = Static<typeof LineEndpointSchema>;
export type BooleanOperation = Static<typeof BooleanOperationSchema>;
export type VectorVertex = Static<typeof VectorVertexSchema>;
export type VectorPointMode = Static<typeof VectorPointModeSchema>;
export type VectorSegment = Static<typeof VectorSegmentSchema>;
export type VectorSegmentReference = Static<
  typeof VectorSegmentReferenceSchema
>;
export type VectorPathRun = Static<typeof VectorPathRunSchema>;
export type VectorRegion = Static<typeof VectorRegionSchema>;
export type VectorNetwork = Static<typeof VectorNetworkSchema>;
export type PathDataProperties = Static<typeof PathDataPropertiesSchema>;
export type VectorNetworkProperties = Static<
  typeof VectorNetworkPropertiesSchema
>;
export type FrameNode = Static<typeof FrameNodeSchema>;
export type SliceNode = Static<typeof SliceNodeSchema>;
export type SlotNode = Static<typeof SlotNodeSchema>;
export type GroupNode = Static<typeof GroupNodeSchema>;
export type BooleanNode = Static<typeof BooleanNodeSchema>;
export type RectangleNode = Static<typeof RectangleNodeSchema>;
export type EllipseNode = Static<typeof EllipseNodeSchema>;
export type LineNode = Static<typeof LineNodeSchema>;
export type PolygonNode = Static<typeof PolygonNodeSchema>;
export type StarNode = Static<typeof StarNodeSchema>;
export type TextNode = Static<typeof TextNodeSchema>;
export type TextRun = NonNullable<TextNode["properties"]["runs"]>[number];
export type TextRunStyle = TextRun["style"];
export type TextParagraphRun = NonNullable<
  TextNode["properties"]["paragraphRuns"]
>[number];
export type TextParagraphStyle = TextParagraphRun["style"];
export type ImageNode = Static<typeof ImageNodeSchema>;
export type VectorNode = Static<typeof VectorNodeSchema>;
export type PathNode = Static<typeof PathNodeSchema>;
export type InstanceNode = Static<typeof InstanceNodeSchema>;
export type ComponentDefinition = Static<typeof ComponentDefinitionSchema>;
export type LibraryReleaseIdentity = Static<
  typeof LibraryReleaseIdentitySchema
>;
export type LibraryComponentSource = Static<
  typeof LibraryComponentSourceSchema
>;
export type LibraryVariantSetSource = Static<
  typeof LibraryVariantSetSourceSchema
>;
export type LibraryStyleSource = Static<typeof LibraryStyleSourceSchema>;
export type LibraryVariableCollectionSource = Static<
  typeof LibraryVariableCollectionSourceSchema
>;
export type LibraryVariableSource = Static<typeof LibraryVariableSourceSchema>;
export type LibraryReleaseSnapshot = Static<
  typeof LibraryReleaseSnapshotSchema
>;
export type ComponentOverride = Static<typeof ComponentOverrideSchema>;
export type ComponentOverridePatch = Static<
  typeof ComponentOverridePatchSchema
>;
export type DesignNode = Static<typeof DesignNodeSchema>;
export type FrameLikeNode = FrameNode | SlotNode;
export function isFrameLikeNode(
  node: DesignNode | undefined,
): node is FrameLikeNode {
  return node?.kind === "frame" || node?.kind === "slot";
}
export type DesignPage = Static<typeof DesignPageSchema>;
export type DesignAsset = Static<typeof DesignAssetSchema>;
export type ImageAssetDerivationOperation = Static<
  typeof ImageAssetDerivationOperationSchema
>;
export type ImageAssetDerivation = Static<typeof ImageAssetDerivationSchema>;
export type DesignDocument = Static<typeof DesignDocumentSchema>;
export type InsertElementCommand = Static<typeof InsertElementCommandSchema>;
export type UpdatePropertiesCommand = Static<
  typeof UpdatePropertiesCommandSchema
>;
export type MoveElementCommand = Static<typeof MoveElementCommandSchema>;
export type DeleteElementCommand = Static<typeof DeleteElementCommandSchema>;
export type ReplaceSubtreeCommand = Static<typeof ReplaceSubtreeCommandSchema>;
export type TextFontDescriptor = Static<typeof TextFontDescriptorSchema>;
export type ReflowTextCommand = Static<typeof ReflowTextCommandSchema>;
export type CommitTextEditParagraphPatch = Static<
  typeof CommitTextEditParagraphPatchSchema
>;
export type CommitTextEditCommand = Static<typeof CommitTextEditCommandSchema>;
export type PutAssetCommand = Static<typeof PutAssetCommandSchema>;
export type DeleteAssetCommand = Static<typeof DeleteAssetCommandSchema>;
export type PutImageAssetDerivationCommand = Static<
  typeof PutImageAssetDerivationCommandSchema
>;
export type DeleteImageAssetDerivationCommand = Static<
  typeof DeleteImageAssetDerivationCommandSchema
>;
export type PutComponentCommand = Static<typeof PutComponentCommandSchema>;
export type DeleteComponentCommand = Static<
  typeof DeleteComponentCommandSchema
>;
export type PutLibraryComponentSourceCommand = Static<
  typeof PutLibraryComponentSourceCommandSchema
>;
export type DeleteLibraryComponentSourceCommand = Static<
  typeof DeleteLibraryComponentSourceCommandSchema
>;
export type PutLibraryVariantSetSourceCommand = Static<
  typeof PutLibraryVariantSetSourceCommandSchema
>;
export type DeleteLibraryVariantSetSourceCommand = Static<
  typeof DeleteLibraryVariantSetSourceCommandSchema
>;
export type PutLibraryStyleSourceCommand = Static<
  typeof PutLibraryStyleSourceCommandSchema
>;
export type DeleteLibraryStyleSourceCommand = Static<
  typeof DeleteLibraryStyleSourceCommandSchema
>;
export type PutLibraryVariableCollectionSourceCommand = Static<
  typeof PutLibraryVariableCollectionSourceCommandSchema
>;
export type DeleteLibraryVariableCollectionSourceCommand = Static<
  typeof DeleteLibraryVariableCollectionSourceCommandSchema
>;
export type PutLibraryVariableSourceCommand = Static<
  typeof PutLibraryVariableSourceCommandSchema
>;
export type DeleteLibraryVariableSourceCommand = Static<
  typeof DeleteLibraryVariableSourceCommandSchema
>;
export type InsertPageCommand = Static<typeof InsertPageCommandSchema>;
export type UpdatePageCommand = Static<typeof UpdatePageCommandSchema>;
export type MovePageCommand = Static<typeof MovePageCommandSchema>;
export type DeletePageCommand = Static<typeof DeletePageCommandSchema>;
export type DesignOperation = Static<typeof DesignOperationSchema>;
export type DesignActor = Static<typeof DesignActorSchema>;
export type DesignTransaction = Static<typeof DesignTransactionSchema>;
export type DesignErrorCode = Static<typeof DesignErrorCodeSchema>;
export type DesignError = Static<typeof DesignErrorSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type NodeChange = Static<typeof NodeChangeSchema>;
export type PageChange = Static<typeof PageChangeSchema>;
export type ComponentChange = Static<typeof ComponentChangeSchema>;
export type LibraryComponentSourceChange = Static<
  typeof LibraryComponentSourceChangeSchema
>;
export type LibraryVariantSetSourceChange = Static<
  typeof LibraryVariantSetSourceChangeSchema
>;
export type LibraryStyleSourceChange = Static<
  typeof LibraryStyleSourceChangeSchema
>;
export type LibraryVariableCollectionSourceChange = Static<
  typeof LibraryVariableCollectionSourceChangeSchema
>;
export type LibraryVariableSourceChange = Static<
  typeof LibraryVariableSourceChangeSchema
>;
export type DesignChangeSet = Static<typeof DesignChangeSetSchema>;
export type DesignDiff = DesignChangeSet;
export type FidelityWarning = Static<typeof FidelityWarningSchema>;
export type TransactionMode = Static<typeof TransactionModeSchema>;
export type DesignTransactionSuccess = Static<
  typeof DesignTransactionSuccessSchema
>;
export type DesignTransactionFailure = Static<
  typeof DesignTransactionFailureSchema
>;
export type DesignTransactionResult = Static<
  typeof DesignTransactionResultSchema
>;
export type CommandResult = DesignTransactionResult;
export type HistoryEntry = Static<typeof HistoryEntrySchema>;
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}
export type ComponentSelectionTarget = Static<
  typeof ComponentSelectionTargetSchema
>;
export type SelectionState = Static<typeof SelectionStateSchema>;
export type ViewportState = Static<typeof ViewportStateSchema>;
export interface EditorState {
  documentId: string;
  revision: number;
  selection: SelectionState;
  tool: string;
  viewport: ViewportState;
  dirty: boolean;
  checkpointRevision: number;
  history: HistoryState;
}
type EditorEventBase = {
  eventId: string;
  sequence: number;
  occurredAt: string;
  documentId: string;
  revision: number;
};
export type EditorEvent = EditorEventBase &
  (
    | { type: "document.changed"; result: DesignTransactionSuccess }
    | { type: "selection.changed"; selection: SelectionState }
    | { type: "tool.changed"; tool: string }
    | { type: "viewport.changed"; viewport: ViewportState }
    | { type: "history.changed"; history: HistoryState }
    | {
        type: "dirty.changed";
        dirty: boolean;
        checkpointRevision: number;
      }
    | {
        type: "checkpoint.created";
        checkpointRevision: number;
        label?: string;
      }
    | { type: "runtime.error"; error: DesignError }
  );
export type DesignCapabilities = Static<typeof DesignCapabilitiesSchema>;
export type ExportArtifact = Static<typeof ExportArtifactSchema>;
export type AtomicChildCommand = DesignOperation;
export type DesignCommand = DesignOperation;
export type RunAtomicDesignBatchCommand = DesignTransaction;

export interface SchemaValidationIssue {
  path: string;
  message: string;
}

export function schemaValidationIssues(
  schema: TSchema,
  value: unknown,
): SchemaValidationIssue[] {
  try {
    return [...Value.Errors(schema, value)].flatMap((error) =>
      actionableSchemaErrors(error).map((actionable) => ({
        path: actionable.path,
        message: actionable.message,
      })),
    );
  } catch {
    return [
      { path: "", message: "Value contains an unsupported cyclic structure" },
    ];
  }
}

type NestedSchemaError = {
  path: string;
  message: string;
  schema: TSchema;
  value: unknown;
  errors: Iterable<Iterable<NestedSchemaError>>;
};

function actionableSchemaErrors(error: NestedSchemaError): NestedSchemaError[] {
  const branches = [...error.errors].map((branch) =>
    [...branch].flatMap(actionableSchemaErrors),
  );
  if (branches.length === 0) return [error];

  const variants = Array.isArray((error.schema as { anyOf?: unknown }).anyOf)
    ? ((error.schema as unknown as { anyOf: TSchema[] }).anyOf ?? [])
    : [];
  const discriminatedBranch = variants.findIndex((variant) =>
    schemaDiscriminatorMatches(variant, error),
  );
  if (discriminatedBranch >= 0) {
    return branches[discriminatedBranch] ?? [error];
  }

  if (
    typeof error.value === "object" &&
    error.value !== null &&
    !Array.isArray(error.value)
  ) {
    return (
      branches
        .filter((branch) => branch.length > 0)
        .sort(compareSchemaErrorBranches)[0] ?? [error]
    );
  }
  return [error];
}

function schemaDiscriminatorMatches(
  schema: TSchema,
  error: NestedSchemaError,
): boolean {
  const value = error.value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const properties = (schema as { properties?: Record<string, unknown> })
    .properties;
  if (!properties) return false;
  return Object.entries(properties).some(([key, property]) => {
    const expected = (property as { const?: unknown } | undefined)?.const;
    return (
      expected !== undefined &&
      Object.prototype.hasOwnProperty.call(value, key) &&
      (value as Record<string, unknown>)[key] === expected
    );
  });
}

function compareSchemaErrorBranches(
  left: readonly NestedSchemaError[],
  right: readonly NestedSchemaError[],
): number {
  if (left.length !== right.length) return left.length - right.length;
  const leftDepth = left.reduce((sum, issue) => sum + issue.path.length, 0);
  const rightDepth = right.reduce((sum, issue) => sum + issue.path.length, 0);
  return rightDepth - leftDepth;
}

export function isDesignDocument(value: unknown): value is DesignDocument {
  return (
    checkSchema(DesignDocumentSchema, value) &&
    designDocumentHasValidLayoutLimits(value as DesignDocument) &&
    designDocumentHasValidTextRuns(value as DesignDocument) &&
    designDocumentHasValidParagraphRuns(value as DesignDocument)
  );
}

export function isDesignAsset(value: unknown): value is DesignAsset {
  return checkSchema(DesignAssetSchema, value);
}

export function isImageAssetDerivation(
  value: unknown,
): value is ImageAssetDerivation {
  return checkSchema(ImageAssetDerivationSchema, value);
}

export function isLibraryReleaseSnapshot(
  value: unknown,
): value is LibraryReleaseSnapshot {
  if (!checkSchema(LibraryReleaseSnapshotSchema, value)) return false;
  const release = value as LibraryReleaseSnapshot;
  const identityMatches = (
    source: LibraryReleaseIdentity,
    sourceEntityId: string,
    entityId: string,
  ) =>
    source.libraryId === release.libraryId &&
    source.releaseId === release.releaseId &&
    source.sourceProjectId === release.sourceProjectId &&
    source.sourceDesignFileId === release.sourceDesignFileId &&
    source.sourceDocumentId === release.sourceDocumentId &&
    sourceEntityId === entityId;
  return (
    Object.entries(release.componentsById).every(
      ([componentId, component]) =>
        component.component.id === componentId &&
        identityMatches(
          component.source,
          component.source.sourceComponentId,
          componentId,
        ),
    ) &&
    Object.entries(release.variantSetsById).every(
      ([variantSetId, variantSet]) =>
        variantSet.variantSet.id === variantSetId &&
        identityMatches(
          variantSet.source,
          variantSet.source.sourceVariantSetId,
          variantSetId,
        ),
    ) &&
    Object.entries(release.stylesById).every(
      ([styleId, style]) =>
        style.style.id === styleId &&
        identityMatches(style.source, style.source.sourceStyleId, styleId),
    ) &&
    Object.entries(release.variableCollectionsById).every(
      ([collectionId, source]) =>
        source.collection.id === collectionId &&
        identityMatches(
          source.source,
          source.source.sourceVariableCollectionId,
          collectionId,
        ) &&
        source.collection.variableIds.every(
          (variableId) =>
            release.variablesById[variableId]?.variable.variableCollectionId ===
            collectionId,
        ),
    ) &&
    Object.entries(release.variablesById).every(
      ([variableId, source]) =>
        source.variable.id === variableId &&
        identityMatches(
          source.source,
          source.source.sourceVariableId,
          variableId,
        ) &&
        Boolean(
          release.variableCollectionsById[
            source.variable.variableCollectionId
          ]?.collection.variableIds.includes(variableId),
        ) &&
        Object.values(source.variable.valuesByMode).every(
          (value) =>
            !variables.isVariableAliasValue(value) ||
            release.variablesById[value.id]?.variable.resolvedType ===
              source.variable.resolvedType,
        ),
    )
  );
}

export function migrateLibraryReleaseSnapshot(
  value: unknown,
): LibraryReleaseSnapshot | null {
  if (isLibraryReleaseSnapshot(value)) return structuredClone(value);
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (value as { version?: unknown }).version !== 2
  ) {
    return null;
  }
  const migrated = structuredClone(value) as Record<string, unknown>;
  migrated.version = 3;
  migrated.variableCollectionsById = {};
  migrated.variablesById = {};
  return isLibraryReleaseSnapshot(migrated) ? migrated : null;
}

export function isImagePlacement(value: unknown): value is ImagePlacement {
  return checkSchema(ImagePlacementSchema, value);
}
export function isImageFilters(value: unknown): value is ImageFilters {
  return checkSchema(ImageFiltersSchema, value);
}
export function isImagePaint(value: unknown): value is ImagePaint {
  return checkSchema(ImagePaintSchema, value);
}
export function migrateDesignDocument(value: unknown): DesignDocument | null {
  if (checkSchema(DesignDocumentSchema, value)) {
    const normalized = structuredClone(value) as Record<string, unknown>;
    migrateTextNodes(normalized);
    return isDesignDocument(normalized) ? normalized : null;
  }
  const schemaVersion =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (schemaVersion !== versions.DESIGN_SCHEMA_VERSION &&
      !versions.MIGRATABLE_DESIGN_SCHEMA_VERSIONS.includes(
        String(schemaVersion),
      ))
  ) {
    return null;
  }
  if (schemaVersion === versions.DESIGN_SCHEMA_VERSION) {
    const normalized = structuredClone(value) as Record<string, unknown>;
    normalized.libraryComponentsById ??= {};
    normalized.libraryVariantSetsById ??= {};
    normalized.libraryStylesById ??= {};
    normalized.libraryVariableCollectionsById ??= {};
    normalized.libraryVariablesById ??= {};
    normalized.imageAssetDerivationOrder ??= [];
    normalized.imageAssetDerivationsById ??= {};
    return isDesignDocument(normalized) ? normalized : null;
  }
  try {
    const migrated = structuredClone(value) as Record<string, unknown>;
    migrated.schemaVersion = versions.DESIGN_SCHEMA_VERSION;
    migrated.libraryComponentsById ??= {};
    migrated.libraryVariantSetsById ??= {};
    migrated.libraryStylesById ??= {};
    migrated.libraryVariableCollectionsById ??= {};
    migrated.libraryVariablesById ??= {};
    migrated.imageAssetDerivationOrder ??= [];
    migrated.imageAssetDerivationsById ??= {};
    if (
      schemaVersion === versions.ADVANCED_VECTOR_CUT_DESIGN_SCHEMA_VERSION &&
      hasLegacyInstanceNodes(migrated)
    ) {
      return null;
    }
    if (
      schemaVersion === versions.LEGACY_DESIGN_SCHEMA_VERSION ||
      schemaVersion === versions.APPEARANCE_DESIGN_SCHEMA_VERSION
    ) {
      migratePathNodes(migrated, schemaVersion);
    }
    migrateImageNodes(migrated, String(schemaVersion));
    migrateTextNodes(migrated);
    migrateFigmaComponentProperties(migrated);
    migrateVariantSets(migrated);
    if (!variables.migrateFigmaVariables(migrated)) return null;
    styles.migrateSharedStyles(migrated);
    exportSettings.migrateExportSettings(migrated);
    return isDesignDocument(migrated) ? migrated : null;
  } catch {
    return null;
  }
}

function hasLegacyInstanceNodes(document: Record<string, unknown>): boolean {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return false;
  return Object.values(nodes).some(
    (node) =>
      node !== null &&
      typeof node === "object" &&
      !Array.isArray(node) &&
      (node as { kind?: unknown }).kind === "instance",
  );
}

function migrateTextNodes(document: Record<string, unknown>): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "text") continue;
    const properties = node.properties;
    if (
      !properties ||
      typeof properties !== "object" ||
      Array.isArray(properties)
    ) {
      continue;
    }
    const textProperties = properties as Record<string, unknown>;
    textProperties.fontStyleName ??= null;
    textProperties.fontSlant ??= "normal";
    textProperties.textWrap ??= "character";
    if (textProperties.textOverflow === "ellipsis") {
      textProperties.textOverflow = "clip";
      textProperties.textTruncation = "ending";
    } else {
      textProperties.textOverflow ??= "visible";
      textProperties.textTruncation ??= "disabled";
    }
    textProperties.maxLines ??= null;
    textProperties.textResize ??= "fixed";
    textProperties.paragraphIndent ??= 0;
    textProperties.paragraphSpacing ??= 0;
    textProperties.listSpacing ??= 0;
    textProperties.hangingList ??= false;
    textProperties.textCase ??= "original";
    textProperties.textDecoration ??= "none";
    textProperties.runs ??= [];
    textProperties.paragraphRuns ??= [];
    if (Array.isArray(textProperties.runs)) {
      const merged: unknown[] = [];
      for (const value of textProperties.runs) {
        const run = isRecordValue(value) ? value : null;
        const previous = merged.at(-1);
        if (
          run &&
          isRecordValue(previous) &&
          previous.end === run.start &&
          JSON.stringify(previous.style) === JSON.stringify(run.style)
        ) {
          previous.end = run.end;
        } else {
          merged.push(value);
        }
      }
      textProperties.runs = merged;
    }
    if (Array.isArray(textProperties.paragraphRuns)) {
      const merged: unknown[] = [];
      for (const value of textProperties.paragraphRuns) {
        const run = isRecordValue(value) ? value : null;
        if (run && isRecordValue(run.style)) {
          run.style.listOptions ??= { type: "none" };
          run.style.indentation ??= 0;
          run.style.listSpacing ??= textProperties.listSpacing;
        }
        const previous = merged.at(-1);
        if (
          run &&
          isRecordValue(previous) &&
          previous.end === run.start &&
          JSON.stringify(previous.style) === JSON.stringify(run.style)
        ) {
          previous.end = run.end;
        } else {
          merged.push(value);
        }
      }
      textProperties.paragraphRuns = merged;
    }
  }
}

function designDocumentHasValidParagraphRuns(
  document: DesignDocument,
): boolean {
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "text") continue;
    const runs = node.properties.paragraphRuns;
    if (!runs) return false;
    if (node.properties.content.length === 0) {
      if (runs.length !== 0) return false;
      continue;
    }
    if (runs.length === 0) continue;
    let expectedStart = 0;
    let previousStyle: string | undefined;
    for (const run of runs) {
      const style = JSON.stringify(run.style);
      if (
        run.start !== expectedStart ||
        run.end <= run.start ||
        run.end > node.properties.content.length ||
        !isParagraphStart(node.properties.content, run.start) ||
        !isParagraphEnd(node.properties.content, run.end) ||
        (run.style.listOptions.type !== "none" &&
          run.style.indentation === 0) ||
        style === previousStyle
      ) {
        return false;
      }
      expectedStart = run.end;
      previousStyle = style;
    }
    if (expectedStart !== node.properties.content.length) return false;
  }
  return true;
}

function isParagraphStart(content: string, index: number): boolean {
  if (index === 0) return true;
  const previous = content.charCodeAt(index - 1);
  if (previous === 0x0a) return true;
  return previous === 0x0d && content.charCodeAt(index) !== 0x0a;
}

function isParagraphEnd(content: string, index: number): boolean {
  if (index === content.length) return true;
  const previous = content.charCodeAt(index - 1);
  if (previous === 0x0a) return true;
  return previous === 0x0d && content.charCodeAt(index) !== 0x0a;
}

function designDocumentHasValidTextRuns(document: DesignDocument): boolean {
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "text") continue;
    const runs = node.properties.runs;
    if (!runs) return false;
    if (node.properties.content.length === 0) {
      if (runs.length !== 0) return false;
      continue;
    }
    if (runs.length === 0) continue;
    let expectedStart = 0;
    let previousStyle: string | undefined;
    for (const run of runs) {
      const style = JSON.stringify(run.style);
      if (
        run.start !== expectedStart ||
        run.end <= run.start ||
        run.end > node.properties.content.length ||
        !isUtf16Boundary(node.properties.content, run.start) ||
        !isUtf16Boundary(node.properties.content, run.end) ||
        style === previousStyle ||
        (run.style.textStyleId !== undefined &&
          documentStyle(document, run.style.textStyleId)?.styleType !==
            "TEXT") ||
        (run.style.fillStyleId !== undefined &&
          documentStyle(document, run.style.fillStyleId)?.styleType !== "PAINT")
      ) {
        return false;
      }
      expectedStart = run.end;
      previousStyle = style;
    }
    if (expectedStart !== node.properties.content.length) return false;
  }
  return true;
}

function documentStyle(document: DesignDocument, styleId: string) {
  return (
    document.stylesById[styleId] ?? document.libraryStylesById[styleId]?.style
  );
}

function isUtf16Boundary(content: string, index: number): boolean {
  if (index === 0 || index === content.length) return true;
  const before = content.charCodeAt(index - 1);
  const after = content.charCodeAt(index);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateImageNodes(
  document: Record<string, unknown>,
  sourceSchemaVersion: string,
): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "image") continue;
    const properties =
      node.properties &&
      typeof node.properties === "object" &&
      !Array.isArray(node.properties)
        ? (node.properties as Record<string, unknown>)
        : null;
    if (!properties) continue;
    const legacyFit = properties.fit;
    if (
      legacyFit !== "fill" &&
      legacyFit !== "contain" &&
      legacyFit !== "cover"
    ) {
      continue;
    }
    properties.placement =
      legacyFit === "fill"
        ? { mode: "stretch" }
        : legacyFit === "contain"
          ? { mode: "fit" }
          : { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } };
    delete properties.fit;
    const extensions =
      node.extensions &&
      typeof node.extensions === "object" &&
      !Array.isArray(node.extensions)
        ? (node.extensions as Record<string, unknown>)
        : {};
    extensions["dev.opendesign.image-placement.migration"] = {
      sourceSchemaVersion,
      legacyFit,
    };
    node.extensions = extensions;
  }
}

function migratePathNodes(
  document: Record<string, unknown>,
  sourceSchemaVersion: string,
): void {
  const nodes = document.nodesById;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return;
  for (const value of Object.values(nodes)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const node = value as Record<string, unknown>;
    if (node.kind !== "path" && node.kind !== "vector") continue;
    const legacy =
      node.properties &&
      typeof node.properties === "object" &&
      !Array.isArray(node.properties)
        ? (node.properties as Record<string, unknown>)
        : {};
    const path =
      typeof legacy.path === "string" &&
      checkSchema(PathDataSchema, legacy.path)
        ? legacy.path
        : "M 0 0";
    const extensions =
      node.extensions &&
      typeof node.extensions === "object" &&
      !Array.isArray(node.extensions)
        ? (node.extensions as Record<string, unknown>)
        : {};
    extensions["dev.opendesign.path.migration"] = {
      sourceSchemaVersion,
      originalProperties: legacy,
      usedPlaceholderPath: path !== legacy.path,
    };
    node.extensions = extensions;
    node.properties = {
      path,
      fills:
        Array.isArray(legacy.fills) &&
        legacy.fills.every((paint) => checkSchema(PaintSchema, paint))
          ? legacy.fills
          : [],
      strokes:
        Array.isArray(legacy.strokes) &&
        legacy.strokes.every((paint) => checkSchema(PaintSchema, paint))
          ? legacy.strokes
          : [],
      strokeWidth:
        typeof legacy.strokeWidth === "number" &&
        Number.isFinite(legacy.strokeWidth) &&
        legacy.strokeWidth >= 0
          ? legacy.strokeWidth
          : 0,
      ...(legacy.strokeAlign === "inside" ||
      legacy.strokeAlign === "center" ||
      legacy.strokeAlign === "outside"
        ? { strokeAlign: legacy.strokeAlign }
        : {}),
      ...(legacy.strokeCap === "none" ||
      legacy.strokeCap === "round" ||
      legacy.strokeCap === "square"
        ? { strokeCap: legacy.strokeCap }
        : {}),
      ...(legacy.strokeJoin === "miter" ||
      legacy.strokeJoin === "round" ||
      legacy.strokeJoin === "bevel"
        ? { strokeJoin: legacy.strokeJoin }
        : {}),
      ...(Array.isArray(legacy.dashPattern) &&
      legacy.dashPattern.every(
        (entry) =>
          typeof entry === "number" && Number.isFinite(entry) && entry >= 0,
      )
        ? { dashPattern: legacy.dashPattern }
        : {}),
      ...(legacy.fillRule === "nonzero" || legacy.fillRule === "evenodd"
        ? { fillRule: legacy.fillRule }
        : {}),
    };
  }
}

export function isDesignOperation(value: unknown): value is DesignOperation {
  return checkSchema(DesignOperationSchema, value)
    ? designOperationHasValidLayoutLimits(value as DesignOperation)
    : false;
}

export function isDesignTransaction(
  value: unknown,
): value is DesignTransaction {
  if (!checkSchema(DesignTransactionSchema, value)) return false;
  return (value as DesignTransaction).commands.every(
    designOperationHasValidLayoutLimits,
  );
}

export function isDesignTransactionResult(
  value: unknown,
): value is DesignTransactionResult {
  return checkSchema(DesignTransactionResultSchema, value);
}

export function isEditorEvent(value: unknown): value is EditorEvent {
  return checkSchema(EditorEventSchema, value);
}
export * from "./design-quality.js";
