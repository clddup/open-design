import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface VectorSchemaDependencies {
  shapeProperties: TProperties;
  pointSchema: TSchema;
  pathDataSchema: TSchema;
}

export function createVectorSchemas<
  const TDependencies extends VectorSchemaDependencies,
>(dependencies: TDependencies) {
  const shapeProperties = dependency(dependencies, "shapeProperties");
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
  const VectorVertexSchema = Type.Object(
    {
      id: VectorGeometryIdSchema,
      x: Type.Number(),
      y: Type.Number(),
      handleMode: Type.Optional(VectorPointModeSchema),
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
    VectorVertexSchema,
    VectorSegmentSchema,
    VectorSegmentReferenceSchema,
    VectorPathRunSchema,
    VectorRegionSchema,
    VectorNetworkSchema,
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
