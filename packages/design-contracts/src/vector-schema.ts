import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface VectorSchemaDependencies {
  paintSchema: TSchema;
  shapeProperties: TProperties;
  pointSchema: TSchema;
  pathDataSchema: TSchema;
}

export function createVectorSchemas<
  const TDependencies extends VectorSchemaDependencies,
>(dependencies: TDependencies) {
  const shapeProperties = dependency(dependencies, "shapeProperties");
  const paintSchema = dependency(dependencies, "paintSchema");
  const pointSchema = dependency(dependencies, "pointSchema");
  const pathDataSchema = dependency(dependencies, "pathDataSchema");
  const VectorGeometryIdSchema = Type.String({
    minLength: 1,
    maxLength: 128,
    pattern: "^[A-Za-z][A-Za-z0-9._:-]*$",
  });
  const VectorPointModeSchema = Type.Union([
    Type.Literal("corner"),
    Type.Literal("smooth"),
    Type.Literal("mirrored"),
    Type.Literal("independent"),
  ]);
  const VectorVertexStrokeCapSchema = Type.Union([
    Type.Literal("none"),
    Type.Literal("round"),
    Type.Literal("square"),
  ]);
  const VectorVertexStrokeJoinSchema = Type.Union([
    Type.Literal("miter"),
    Type.Literal("round"),
    Type.Literal("bevel"),
  ]);
  const VectorVertexSchema = Type.Object(
    {
      id: VectorGeometryIdSchema,
      x: Type.Number(),
      y: Type.Number(),
      handleMode: Type.Optional(VectorPointModeSchema),
      strokeCap: Type.Optional(VectorVertexStrokeCapSchema),
      strokeJoin: Type.Optional(VectorVertexStrokeJoinSchema),
      cornerRadius: Type.Optional(Type.Number({ minimum: 0 })),
    },
    { additionalProperties: false },
  );
  const VectorSegmentSchema = Type.Object(
    {
      id: VectorGeometryIdSchema,
      startVertexId: VectorGeometryIdSchema,
      endVertexId: VectorGeometryIdSchema,
      tangentStart: Type.Optional(pointSchema),
      tangentEnd: Type.Optional(pointSchema),
    },
    { additionalProperties: false },
  );
  const VectorSegmentReferenceSchema = Type.Object(
    { segmentId: VectorGeometryIdSchema, reversed: Type.Boolean() },
    { additionalProperties: false },
  );
  const VectorPathRunSchema = Type.Object(
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
  const VectorRegionSchema = Type.Object(
    {
      id: VectorGeometryIdSchema,
      windingRule: fillRuleSchema(),
      fills: Type.Optional(Type.Array(paintSchema, { maxItems: 4_096 })),
      fillStyleId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
      loops: Type.Array(
        Type.Object(
          { pathId: VectorGeometryIdSchema, reversed: Type.Boolean() },
          { additionalProperties: false },
        ),
        { minItems: 1, maxItems: 1_024 },
      ),
    },
    { additionalProperties: false },
  );
  const VariableWidthPointSchema = Type.Object(
    {
      position: Type.Number({ minimum: 0, maximum: 1 }),
      width: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  const VariableWidthStrokePropertiesSchema = Type.Union([
    Type.Object(
      {
        widthProfile: Type.Union([
          Type.Literal("UNIFORM"),
          Type.Literal("WEDGE"),
          Type.Literal("TAPER"),
          Type.Literal("QUARTER_TAPER"),
          Type.Literal("EYE"),
          Type.Literal("MIRRORED_TAPER"),
        ]),
      },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        widthProfile: Type.Literal("CUSTOM"),
        variableWidthPoints: Type.Array(VariableWidthPointSchema, {
          minItems: 2,
          maxItems: 256,
        }),
      },
      { additionalProperties: false },
    ),
  ]);
  const VectorNetworkSchema = Type.Object(
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
  const PathDataPropertiesSchema = Type.Object(
    {
      ...shapeProperties,
      path: pathDataSchema,
      fillRule: Type.Optional(fillRuleSchema()),
    },
    { additionalProperties: false },
  );
  const VectorNetworkPropertiesSchema = Type.Object(
    {
      ...shapeProperties,
      network: VectorNetworkSchema,
      fillRule: Type.Optional(fillRuleSchema()),
      cornerRadius: Type.Optional(Type.Number({ minimum: 0 })),
      cornerSmoothing: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      variableWidthStrokeProperties: Type.Optional(
        VariableWidthStrokePropertiesSchema,
      ),
    },
    { additionalProperties: false },
  );
  const PathPropertiesSchema = Type.Union([
    PathDataPropertiesSchema,
    VectorNetworkPropertiesSchema,
  ]);
  return {
    VectorGeometryIdSchema,
    VectorPointModeSchema,
    VectorVertexStrokeCapSchema,
    VectorVertexStrokeJoinSchema,
    VectorVertexSchema,
    VectorSegmentSchema,
    VectorSegmentReferenceSchema,
    VectorPathRunSchema,
    VectorRegionSchema,
    VectorNetworkSchema,
    VariableWidthPointSchema,
    VariableWidthStrokePropertiesSchema,
    PathDataPropertiesSchema,
    VectorNetworkPropertiesSchema,
    PathPropertiesSchema,
  };
}

function fillRuleSchema() {
  return Type.Union([Type.Literal("nonzero"), Type.Literal("evenodd")]);
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
