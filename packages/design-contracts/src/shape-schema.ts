import { Type, type TSchema } from "@sinclair/typebox";

interface ShapeSchemaDependencies {
  paintSchema: TSchema;
  normalizedPointSchema: TSchema;
  autoLayoutSchema: TSchema;
  layoutGuideSchema: TSchema;
}

export function createShapeSchemas<
  const TDependencies extends ShapeSchemaDependencies,
>(dependencies: TDependencies) {
  const paintSchema = dependency(dependencies, "paintSchema");
  const normalizedPointSchema = dependency(
    dependencies,
    "normalizedPointSchema",
  );
  const autoLayoutSchema = dependency(dependencies, "autoLayoutSchema");
  const layoutGuideSchema = dependency(dependencies, "layoutGuideSchema");
  const ShapeProperties = {
    fills: Type.Array(paintSchema),
    strokes: Type.Array(paintSchema),
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
  const MaskModeSchema = Type.Union([
    Type.Literal("none"),
    Type.Literal("alpha"),
    Type.Literal("luminance"),
    Type.Literal("clipping"),
    Type.Literal("outline"),
  ]);
  const FramePropertiesSchema = Type.Object(
    {
      ...ShapeProperties,
      cornerRadius: Type.Number({ minimum: 0 }),
      clipsContent: Type.Boolean(),
      autoLayout: Type.Optional(autoLayoutSchema),
      layoutGuides: Type.Optional(
        Type.Array(layoutGuideSchema, { maxItems: 8 }),
      ),
    },
    { additionalProperties: false },
  );
  const GroupPropertiesSchema = Type.Object(
    {},
    { additionalProperties: false },
  );
  const RectanglePropertiesSchema = Type.Object(
    {
      ...ShapeProperties,
      cornerRadius: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  const EllipsePropertiesSchema = Type.Object(ShapeProperties, {
    additionalProperties: false,
  });
  const LineEndpointSchema = Type.Union([
    Type.Literal("none"),
    Type.Literal("line-arrow"),
    Type.Literal("triangle-arrow"),
    Type.Literal("reversed-triangle-arrow"),
    Type.Literal("circle"),
    Type.Literal("diamond"),
  ]);
  const LinePropertiesSchema = Type.Object(
    {
      fills: Type.Array(paintSchema, { maxItems: 0 }),
      strokes: ShapeProperties.strokes,
      strokeWidth: ShapeProperties.strokeWidth,
      strokeAlign: Type.Optional(Type.Literal("center")),
      strokeCap: ShapeProperties.strokeCap,
      strokeJoin: ShapeProperties.strokeJoin,
      dashPattern: ShapeProperties.dashPattern,
      start: normalizedPointSchema,
      end: normalizedPointSchema,
      startEndpoint: LineEndpointSchema,
      endEndpoint: LineEndpointSchema,
    },
    { additionalProperties: false },
  );
  const PolygonPropertiesSchema = Type.Object(
    {
      ...ShapeProperties,
      pointCount: Type.Integer({ minimum: 3, maximum: 60 }),
      cornerRadius: Type.Number({ minimum: 0 }),
      cornerSmoothing: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    },
    { additionalProperties: false },
  );
  const StarPropertiesSchema = Type.Object(
    {
      ...ShapeProperties,
      pointCount: Type.Integer({ minimum: 3, maximum: 60 }),
      innerRadius: Type.Number({ minimum: 0, maximum: 1 }),
      cornerRadius: Type.Number({ minimum: 0 }),
      cornerSmoothing: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    },
    { additionalProperties: false },
  );
  const BooleanOperationSchema = Type.Union([
    Type.Literal("union"),
    Type.Literal("subtract"),
    Type.Literal("intersect"),
    Type.Literal("exclude"),
  ]);
  const BooleanPropertiesSchema = Type.Object(
    {
      ...ShapeProperties,
      operation: BooleanOperationSchema,
      fillRule: Type.Optional(
        Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]),
      ),
    },
    { additionalProperties: false },
  );
  return {
    ShapeProperties,
    MaskModeSchema,
    FramePropertiesSchema,
    GroupPropertiesSchema,
    RectanglePropertiesSchema,
    EllipsePropertiesSchema,
    LineEndpointSchema,
    LinePropertiesSchema,
    PolygonPropertiesSchema,
    StarPropertiesSchema,
    BooleanOperationSchema,
    BooleanPropertiesSchema,
  };
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
