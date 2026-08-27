import { Type, type TProperties, type TSchema } from "@sinclair/typebox";

interface NodeSchemaDependencies {
  transformSchema: TSchema;
  sizeSchema: TSchema;
  layoutConstraintsSchema: TSchema;
  layoutPositioningSchema: TSchema;
  layoutSizingSchema: TSchema;
  layoutLimitsSchema: TSchema;
  gridChildPlacementSchema: TSchema;
  componentPropertyReferencesSchema: TSchema;
  blendModeSchema: TSchema;
  effectSchema: TSchema;
  maskModeSchema: TSchema;
  explicitVariableModesSchema: TSchema;
  nodeBoundVariablesSchema: TSchema;
  nodeStyleReferenceProperties: TProperties;
  exportSettingsSchema: TSchema;
  jsonObjectSchema: TSchema;
  shapeProperties: TProperties;
  autoLayoutSchema: TSchema;
  framePropertiesSchema: TSchema;
  groupPropertiesSchema: TSchema;
  booleanPropertiesSchema: TSchema;
  rectanglePropertiesSchema: TSchema;
  ellipsePropertiesSchema: TSchema;
  linePropertiesSchema: TSchema;
  polygonPropertiesSchema: TSchema;
  starPropertiesSchema: TSchema;
  textPropertiesSchema: TSchema;
  imagePropertiesSchema: TSchema;
  pathPropertiesSchema: TSchema;
  instancePropertiesSchema: TSchema;
}

export function createNodeSchemas<
  const TDependencies extends NodeSchemaDependencies,
>(dependencies: TDependencies) {
  const schema = <TKey extends keyof TDependencies>(
    key: TKey,
  ): TDependencies[TKey] => dependencies[key];
  const NodeKindSchema = Type.Union([
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
  const NodeBaseProperties = {
    id: Type.String({ minLength: 1 }),
    name: Type.String(),
    parentId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
    childIds: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
    visible: Type.Boolean(),
    locked: Type.Boolean(),
    transform: schema("transformSchema"),
    size: schema("sizeSchema"),
    opacity: Type.Number({ minimum: 0, maximum: 1 }),
    constraints: Type.Optional(schema("layoutConstraintsSchema")),
    layoutPositioning: Type.Optional(schema("layoutPositioningSchema")),
    layoutSizing: Type.Optional(schema("layoutSizingSchema")),
    layoutLimits: Type.Optional(schema("layoutLimitsSchema")),
    gridPlacement: Type.Optional(schema("gridChildPlacementSchema")),
    componentPropertyReferences: Type.Optional(
      Type.Union([schema("componentPropertyReferencesSchema"), Type.Null()]),
    ),
    blendMode: Type.Optional(schema("blendModeSchema")),
    effects: Type.Optional(Type.Array(schema("effectSchema"))),
    maskMode: Type.Optional(schema("maskModeSchema")),
    explicitVariableModes: Type.Optional(schema("explicitVariableModesSchema")),
    boundVariables: Type.Optional(schema("nodeBoundVariablesSchema")),
    ...schema("nodeStyleReferenceProperties"),
    exportSettings: schema("exportSettingsSchema"),
    extensions: schema("jsonObjectSchema"),
  };
  const FrameNodeSchema = nodeSchema(
    NodeBaseProperties,
    "frame",
    schema("framePropertiesSchema"),
  );
  const SlotPropertiesSchema = Type.Object(
    {
      ...schema("shapeProperties"),
      cornerRadius: Type.Number({ minimum: 0 }),
      clipsContent: Type.Boolean(),
      autoLayout: Type.Optional(schema("autoLayoutSchema")),
      sourceSlotId: Type.Union([
        Type.String({ minLength: 1, maxLength: 256 }),
        Type.Null(),
      ]),
    },
    { additionalProperties: false },
  );
  const SlotNodeSchema = nodeSchema(
    NodeBaseProperties,
    "slot",
    SlotPropertiesSchema,
  );
  const GroupNodeSchema = nodeSchema(
    NodeBaseProperties,
    "group",
    schema("groupPropertiesSchema"),
  );
  const BooleanNodeSchema = nodeSchema(
    NodeBaseProperties,
    "boolean",
    schema("booleanPropertiesSchema"),
  );
  const RectangleNodeSchema = nodeSchema(
    NodeBaseProperties,
    "rectangle",
    schema("rectanglePropertiesSchema"),
  );
  const EllipseNodeSchema = nodeSchema(
    NodeBaseProperties,
    "ellipse",
    schema("ellipsePropertiesSchema"),
  );
  const LineNodeSchema = nodeSchema(
    NodeBaseProperties,
    "line",
    schema("linePropertiesSchema"),
  );
  const PolygonNodeSchema = nodeSchema(
    NodeBaseProperties,
    "polygon",
    schema("polygonPropertiesSchema"),
  );
  const StarNodeSchema = nodeSchema(
    NodeBaseProperties,
    "star",
    schema("starPropertiesSchema"),
  );
  const TextNodeSchema = nodeSchema(
    NodeBaseProperties,
    "text",
    schema("textPropertiesSchema"),
  );
  const ImageNodeSchema = nodeSchema(
    NodeBaseProperties,
    "image",
    schema("imagePropertiesSchema"),
  );
  const VectorNodeSchema = nodeSchema(
    NodeBaseProperties,
    "vector",
    schema("pathPropertiesSchema"),
  );
  const PathNodeSchema = nodeSchema(
    NodeBaseProperties,
    "path",
    schema("pathPropertiesSchema"),
  );
  const InstanceNodeSchema = Type.Object(
    {
      ...NodeBaseProperties,
      childIds: Type.Array(Type.String({ minLength: 1 }), {
        uniqueItems: true,
        maxItems: 4_096,
      }),
      kind: Type.Literal("instance"),
      properties: schema("instancePropertiesSchema"),
    },
    { additionalProperties: false },
  );
  const SlicePropertiesSchema = Type.Object(
    {},
    { additionalProperties: false },
  );
  const SliceNodeSchema = Type.Object(
    {
      ...NodeBaseProperties,
      childIds: Type.Array(Type.String({ minLength: 1 }), { maxItems: 0 }),
      kind: Type.Literal("slice"),
      properties: SlicePropertiesSchema,
    },
    { additionalProperties: false },
  );
  const DesignNodeSchema = Type.Union([
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
  return {
    NodeKindSchema,
    FrameNodeSchema,
    SlotPropertiesSchema,
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
    SlicePropertiesSchema,
    SliceNodeSchema,
    DesignNodeSchema,
  };
}

function nodeSchema<
  TBase extends TProperties,
  const TKind extends string,
  TPropertiesSchema extends TSchema,
>(base: TBase, kind: TKind, properties: TPropertiesSchema) {
  return Type.Object(
    { ...base, kind: Type.Literal(kind), properties },
    { additionalProperties: false },
  );
}
