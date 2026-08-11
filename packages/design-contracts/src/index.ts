import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

export const DESIGN_SCHEMA_VERSION = "1.8.0" as const;
export const EDITABLE_VECTOR_DESIGN_SCHEMA_VERSION = "1.7.0" as const;
export const REGULAR_SHAPE_DESIGN_SCHEMA_VERSION = "1.6.0" as const;
export const LINE_DESIGN_SCHEMA_VERSION = "1.5.0" as const;
export const MASK_DESIGN_SCHEMA_VERSION = "1.4.0" as const;
export const IMAGE_PLACEMENT_DESIGN_SCHEMA_VERSION = "1.3.0" as const;
export const PATH_DESIGN_SCHEMA_VERSION = "1.2.0" as const;
export const APPEARANCE_DESIGN_SCHEMA_VERSION = "1.1.0" as const;
export const LEGACY_DESIGN_SCHEMA_VERSION = "1.0.0" as const;
export const DESIGN_FORMAT = "dev.opendesign.document" as const;
export const MAX_TRANSACTION_COMMANDS = 500;

export const JsonValueSchema = Type.Recursive((Self) =>
  Type.Union([
    Type.String(),
    Type.Number(),
    Type.Boolean(),
    Type.Null(),
    Type.Array(Self),
    Type.Record(Type.String(), Self),
  ]),
);

export const JsonObjectSchema = Type.Record(Type.String(), JsonValueSchema);

export const NodeKindSchema = Type.Union([
  Type.Literal("frame"),
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
]);

export const TransformSchema = Type.Tuple([
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
]);

export const SizeSchema = Type.Object(
  {
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const PointSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
  },
  { additionalProperties: false },
);

export const NormalizedPointSchema = Type.Object(
  {
    x: Type.Number({ minimum: 0, maximum: 1 }),
    y: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

export const RectSchema = Type.Object(
  {
    x: Type.Number(),
    y: Type.Number(),
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const BlendModeSchema = Type.Union([
  Type.Literal("pass-through"),
  Type.Literal("normal"),
  Type.Literal("multiply"),
  Type.Literal("screen"),
  Type.Literal("overlay"),
  Type.Literal("darken"),
  Type.Literal("lighten"),
  Type.Literal("color-dodge"),
  Type.Literal("color-burn"),
  Type.Literal("hard-light"),
  Type.Literal("soft-light"),
  Type.Literal("difference"),
  Type.Literal("exclusion"),
  Type.Literal("hue"),
  Type.Literal("saturation"),
  Type.Literal("color"),
  Type.Literal("luminosity"),
]);

const PaintBaseProperties = {
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};

export const SolidPaintSchema = Type.Object(
  {
    type: Type.Literal("solid"),
    color: Type.String({ minLength: 1 }),
    ...PaintBaseProperties,
  },
  { additionalProperties: false },
);

export const GradientStopSchema = Type.Object(
  {
    offset: Type.Number({ minimum: 0, maximum: 1 }),
    color: Type.String({ minLength: 1 }),
    opacity: Type.Number({ minimum: 0, maximum: 1 }),
  },
  { additionalProperties: false },
);

const GradientPaintProperties = {
  ...PaintBaseProperties,
  stops: Type.Array(GradientStopSchema, { minItems: 2 }),
  from: Type.Optional(PointSchema),
  to: Type.Optional(PointSchema),
  rotation: Type.Optional(Type.Number()),
  stretch: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
};

export const LinearGradientPaintSchema = Type.Object(
  {
    type: Type.Literal("linear-gradient"),
    ...GradientPaintProperties,
  },
  { additionalProperties: false },
);

export const RadialGradientPaintSchema = Type.Object(
  {
    type: Type.Literal("radial-gradient"),
    ...GradientPaintProperties,
  },
  { additionalProperties: false },
);

export const AngularGradientPaintSchema = Type.Object(
  {
    type: Type.Literal("angular-gradient"),
    ...GradientPaintProperties,
  },
  { additionalProperties: false },
);

export const ImagePaintSchema = Type.Object(
  {
    type: Type.Literal("image"),
    assetId: Type.String({ minLength: 1 }),
    fit: Type.Union([
      Type.Literal("fill"),
      Type.Literal("contain"),
      Type.Literal("cover"),
      Type.Literal("tile"),
    ]),
    ...PaintBaseProperties,
    rotation: Type.Optional(Type.Number()),
    scale: Type.Optional(PointSchema),
    offset: Type.Optional(PointSchema),
  },
  { additionalProperties: false },
);

export const PaintSchema = Type.Union([
  SolidPaintSchema,
  LinearGradientPaintSchema,
  RadialGradientPaintSchema,
  AngularGradientPaintSchema,
  ImagePaintSchema,
]);

const ShadowEffectProperties = {
  color: Type.String({ minLength: 1 }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  offset: PointSchema,
  blur: Type.Number({ minimum: 0 }),
  spread: Type.Number(),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};

export const DropShadowEffectSchema = Type.Object(
  {
    type: Type.Literal("drop-shadow"),
    ...ShadowEffectProperties,
  },
  { additionalProperties: false },
);

export const InnerShadowEffectSchema = Type.Object(
  {
    type: Type.Literal("inner-shadow"),
    ...ShadowEffectProperties,
  },
  { additionalProperties: false },
);

const GlowEffectProperties = {
  color: Type.String({ minLength: 1 }),
  opacity: Type.Number({ minimum: 0, maximum: 1 }),
  radius: Type.Number({ minimum: 0 }),
  spread: Type.Number(),
  visible: Type.Optional(Type.Boolean()),
  blendMode: Type.Optional(BlendModeSchema),
};

export const OuterGlowEffectSchema = Type.Object(
  {
    type: Type.Literal("outer-glow"),
    ...GlowEffectProperties,
  },
  { additionalProperties: false },
);

export const InnerGlowEffectSchema = Type.Object(
  {
    type: Type.Literal("inner-glow"),
    ...GlowEffectProperties,
  },
  { additionalProperties: false },
);

const BlurEffectProperties = {
  radius: Type.Number({ minimum: 0 }),
  visible: Type.Optional(Type.Boolean()),
};

export const LayerBlurEffectSchema = Type.Object(
  { type: Type.Literal("layer-blur"), ...BlurEffectProperties },
  { additionalProperties: false },
);

export const BackgroundBlurEffectSchema = Type.Object(
  { type: Type.Literal("background-blur"), ...BlurEffectProperties },
  { additionalProperties: false },
);

export const GrayscaleEffectSchema = Type.Object(
  {
    type: Type.Literal("grayscale"),
    amount: Type.Number({ minimum: 0, maximum: 1 }),
    visible: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const EffectSchema = Type.Union([
  DropShadowEffectSchema,
  InnerShadowEffectSchema,
  OuterGlowEffectSchema,
  InnerGlowEffectSchema,
  LayerBlurEffectSchema,
  BackgroundBlurEffectSchema,
  GrayscaleEffectSchema,
]);

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

export const TextPropertiesSchema = Type.Object(
  {
    content: Type.String(),
    fontFamily: Type.String({ minLength: 1 }),
    fontSize: Type.Number({ exclusiveMinimum: 0 }),
    fontWeight: Type.Integer({ minimum: 1, maximum: 1000 }),
    lineHeight: Type.Number({ exclusiveMinimum: 0 }),
    letterSpacing: Type.Number(),
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
  },
  { additionalProperties: false },
);

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
  blendMode: Type.Optional(BlendModeSchema),
  effects: Type.Optional(Type.Array(EffectSchema)),
  maskMode: Type.Optional(MaskModeSchema),
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

const FutureNodeProperties = {
  ...NodeBaseProperties,
  properties: JsonObjectSchema,
};

export const FutureNodeSchema = Type.Union([
  Type.Object(
    { ...FutureNodeProperties, kind: Type.Literal("instance") },
    { additionalProperties: false },
  ),
]);

export const DesignNodeSchema = Type.Union([
  FrameNodeSchema,
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
  FutureNodeSchema,
]);

export const DesignPageSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    name: Type.String(),
    rootNodeIds: Type.Array(Type.String({ minLength: 1 }), {
      uniqueItems: true,
    }),
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

export const DesignDocumentSchema = Type.Object(
  {
    format: Type.Literal(DESIGN_FORMAT),
    schemaVersion: Type.Literal(DESIGN_SCHEMA_VERSION),
    documentId: Type.String({ minLength: 1 }),
    revision: Type.Integer({ minimum: 0 }),
    pageOrder: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      uniqueItems: true,
    }),
    pagesById: Type.Record(Type.String(), DesignPageSchema),
    nodesById: Type.Record(Type.String(), DesignNodeSchema),
    componentsById: Type.Record(Type.String(), JsonValueSchema),
    variantSetsById: Type.Record(Type.String(), JsonValueSchema),
    tokenCollectionsById: Type.Record(Type.String(), JsonValueSchema),
    tokensById: Type.Record(Type.String(), JsonValueSchema),
    interactionsById: Type.Record(Type.String(), JsonValueSchema),
    assetsById: Type.Record(Type.String(), DesignAssetSchema),
    extensions: JsonObjectSchema,
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
    blendMode: Type.Optional(BlendModeSchema),
    effects: Type.Optional(Type.Array(EffectSchema)),
    maskMode: Type.Optional(MaskModeSchema),
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

export const NodeDesignOperationSchema = Type.Union([
  InsertElementCommandSchema,
  UpdatePropertiesCommandSchema,
  MoveElementCommandSchema,
  DeleteElementCommandSchema,
  ReplaceSubtreeCommandSchema,
]);

export const DesignOperationSchema = Type.Union([
  NodeDesignOperationSchema,
  PutAssetCommandSchema,
  DeleteAssetCommandSchema,
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

export const DesignTransactionSchema = Type.Object(
  {
    transactionId: Type.String({ minLength: 1 }),
    documentId: Type.String({ minLength: 1 }),
    baseRevision: Type.Integer({ minimum: 0 }),
    actor: DesignActorSchema,
    label: Type.Optional(Type.String()),
    summary: Type.Optional(Type.String()),
    commands: Type.Array(DesignOperationSchema, {
      minItems: 1,
      maxItems: MAX_TRANSACTION_COMMANDS,
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

export const NodeChangeSchema = Type.Object(
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

export const DesignChangeSetSchema = Type.Object(
  {
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
    changes: Type.Array(NodeChangeSchema),
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

export const DesignTransactionResultSchema = Type.Union([
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

export const SelectionStateSchema = Type.Object(
  {
    nodeIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    anchorNodeId: Type.Optional(Type.String({ minLength: 1 })),
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
    schemaVersion: Type.Literal(DESIGN_SCHEMA_VERSION),
    nodeKinds: Type.Array(NodeKindSchema, { uniqueItems: true }),
    operations: Type.Array(
      Type.Union([
        Type.Literal("insert_element"),
        Type.Literal("update_properties"),
        Type.Literal("move_element"),
        Type.Literal("delete_element"),
        Type.Literal("replace_subtree"),
        Type.Literal("put_asset"),
        Type.Literal("delete_asset"),
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

export const AtomicChildCommandSchema = DesignOperationSchema;
export const DesignCommandSchema = DesignOperationSchema;
export const RunAtomicDesignBatchCommandSchema = DesignTransactionSchema;

export type JsonValue = Static<typeof JsonValueSchema>;
export type JsonObject = Static<typeof JsonObjectSchema>;
export type NodeKind = Static<typeof NodeKindSchema>;
export type Transform = Static<typeof TransformSchema>;
export type Size = Static<typeof SizeSchema>;
export type Point = Static<typeof PointSchema>;
export type NormalizedPoint = Static<typeof NormalizedPointSchema>;
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
export type GroupNode = Static<typeof GroupNodeSchema>;
export type BooleanNode = Static<typeof BooleanNodeSchema>;
export type RectangleNode = Static<typeof RectangleNodeSchema>;
export type EllipseNode = Static<typeof EllipseNodeSchema>;
export type LineNode = Static<typeof LineNodeSchema>;
export type PolygonNode = Static<typeof PolygonNodeSchema>;
export type StarNode = Static<typeof StarNodeSchema>;
export type TextNode = Static<typeof TextNodeSchema>;
export type ImageNode = Static<typeof ImageNodeSchema>;
export type VectorNode = Static<typeof VectorNodeSchema>;
export type PathNode = Static<typeof PathNodeSchema>;
export type DesignNode = Static<typeof DesignNodeSchema>;
export type DesignPage = Static<typeof DesignPageSchema>;
export type DesignAsset = Static<typeof DesignAssetSchema>;
export type DesignDocument = Static<typeof DesignDocumentSchema>;
export type InsertElementCommand = Static<typeof InsertElementCommandSchema>;
export type UpdatePropertiesCommand = Static<
  typeof UpdatePropertiesCommandSchema
>;
export type MoveElementCommand = Static<typeof MoveElementCommandSchema>;
export type DeleteElementCommand = Static<typeof DeleteElementCommandSchema>;
export type ReplaceSubtreeCommand = Static<typeof ReplaceSubtreeCommandSchema>;
export type PutAssetCommand = Static<typeof PutAssetCommandSchema>;
export type DeleteAssetCommand = Static<typeof DeleteAssetCommandSchema>;
export type DesignOperation = Static<typeof DesignOperationSchema>;
export type DesignActor = Static<typeof DesignActorSchema>;
export type DesignTransaction = Static<typeof DesignTransactionSchema>;
export type DesignErrorCode = Static<typeof DesignErrorCodeSchema>;
export type DesignError = Static<typeof DesignErrorSchema>;
export type Revision = Static<typeof RevisionSchema>;
export type NodeChange = Static<typeof NodeChangeSchema>;
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
    return [...Value.Errors(schema, value)].map((error) => ({
      path: error.path,
      message: error.message,
    }));
  } catch {
    return [
      { path: "", message: "Value contains an unsupported cyclic structure" },
    ];
  }
}

export function isDesignDocument(value: unknown): value is DesignDocument {
  return checkSchema(DesignDocumentSchema, value);
}

export function isDesignAsset(value: unknown): value is DesignAsset {
  return checkSchema(DesignAssetSchema, value);
}

export function isImagePlacement(value: unknown): value is ImagePlacement {
  return checkSchema(ImagePlacementSchema, value);
}

export function migrateDesignDocument(value: unknown): DesignDocument | null {
  if (isDesignDocument(value)) return structuredClone(value);
  const schemaVersion =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (schemaVersion !== LEGACY_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== APPEARANCE_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== PATH_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== IMAGE_PLACEMENT_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== MASK_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== LINE_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== REGULAR_SHAPE_DESIGN_SCHEMA_VERSION &&
      schemaVersion !== EDITABLE_VECTOR_DESIGN_SCHEMA_VERSION)
  ) {
    return null;
  }
  try {
    const migrated = structuredClone(value) as Record<string, unknown>;
    migrated.schemaVersion = DESIGN_SCHEMA_VERSION;
    if (
      schemaVersion === LEGACY_DESIGN_SCHEMA_VERSION ||
      schemaVersion === APPEARANCE_DESIGN_SCHEMA_VERSION
    ) {
      migratePathNodes(migrated, schemaVersion);
    }
    migrateImageNodes(migrated, schemaVersion);
    return isDesignDocument(migrated) ? migrated : null;
  } catch {
    return null;
  }
}

export function resolveLineEndpointPoint(
  size: Size,
  endpoint: NormalizedPoint,
): Point {
  return { x: size.width * endpoint.x, y: size.height * endpoint.y };
}

export function normalizeLineEndpoints(
  start: Point,
  end: Point,
): {
  bounds: Rect;
  start: NormalizedPoint;
  end: NormalizedPoint;
} {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  const normalize = (point: Point): NormalizedPoint => ({
    x: width === 0 ? 0.5 : (point.x - x) / width,
    y: height === 0 ? 0.5 : (point.y - y) / height,
  });
  return {
    bounds: { x, y, width, height },
    start: normalize(start),
    end: normalize(end),
  };
}

export function resolveRegularPolygonPoints(
  size: Size,
  pointCount: number,
): Point[] {
  assertRegularPointCount(pointCount);
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (index * Math.PI * 2) / pointCount - Math.PI / 2;
    return {
      x: centerX + centerX * Math.cos(angle),
      y: centerY + centerY * Math.sin(angle),
    };
  });
}

export function resolveStarPoints(
  size: Size,
  pointCount: number,
  innerRadius: number,
): Point[] {
  assertRegularPointCount(pointCount);
  if (!Number.isFinite(innerRadius) || innerRadius < 0 || innerRadius > 1) {
    throw new RangeError("Star innerRadius must be between 0 and 1");
  }
  const centerX = size.width / 2;
  const centerY = size.height / 2;
  return Array.from({ length: pointCount * 2 }, (_, index) => {
    const radius = index % 2 === 0 ? 1 : innerRadius;
    const angle = (index * Math.PI) / pointCount - Math.PI / 2;
    return {
      x: centerX + centerX * radius * Math.cos(angle),
      y: centerY + centerY * radius * Math.sin(angle),
    };
  });
}

function assertRegularPointCount(pointCount: number): void {
  if (!Number.isInteger(pointCount) || pointCount < 3 || pointCount > 60) {
    throw new RangeError("Polygon and Star pointCount must be from 3 to 60");
  }
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
  return checkSchema(DesignOperationSchema, value);
}

export function isDesignTransaction(
  value: unknown,
): value is DesignTransaction {
  return checkSchema(DesignTransactionSchema, value);
}

export function isDesignTransactionResult(
  value: unknown,
): value is DesignTransactionResult {
  return checkSchema(DesignTransactionResultSchema, value);
}

export function isEditorEvent(value: unknown): value is EditorEvent {
  return checkSchema(EditorEventSchema, value);
}

function checkSchema(schema: TSchema, value: unknown): boolean {
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}
