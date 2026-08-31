import { Type, type TUnion } from "@sinclair/typebox";
import * as layout from "./layout.js";
import { PathDataSchema } from "./path-schema.js";
import { createComponentSchemas } from "./component-schema.js";
import { createDocumentResourceSchemas } from "./document-resource-schema.js";
import { createLibrarySchemas } from "./library-schema.js";
import { createDesignDocumentSchema } from "./design-document-schema.js";
import { createShapeSchemas } from "./shape-schema.js";
import { createTextNodeSchemas } from "./text-node-schema.js";
import { createImageNodeSchemas } from "./image-node-schema.js";
import { createVectorSchemas } from "./vector-schema.js";
import { createNodeSchemas } from "./node-schema.js";
import * as versions from "./versions.js";
import {
  ComponentPropertyAssignmentsSchema,
  ComponentPropertyDefinitionsSchema,
  ComponentPropertyReferencesSchema,
} from "./component-properties.js";
import {
  VariantPropertiesSchema,
  VariantSetDefinitionSchema,
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
import { ImageFiltersSchema } from "./image-filters.js";
import { BlendModeSchema, EffectSchema, PaintSchema } from "./appearance.js";

export const DESIGN_FORMAT = "dev.opendesign.document" as const;
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

const shapeSchemas = createShapeSchemas({
  paintSchema: PaintSchema,
  normalizedPointSchema: NormalizedPointSchema,
  autoLayoutSchema: layout.AutoLayoutSchema,
  layoutGuideSchema: layout.LayoutGuideSchema,
});
const ShapeProperties = shapeSchemas.ShapeProperties;
export const {
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
} = shapeSchemas;

const textNodeSchemas = createTextNodeSchemas({
  fontFaceIdentityProperties: styles.FontFaceIdentityProperties,
  paintSchema: PaintSchema,
  strokeAlignSchema: ShapeProperties.strokeAlign,
  strokeCapSchema: ShapeProperties.strokeCap,
  strokeJoinSchema: ShapeProperties.strokeJoin,
  dashPatternSchema: ShapeProperties.dashPattern,
});
export const TextRunsSchema = textNodeSchemas.TextRunsSchema;
export const TextPropertiesSchema = textNodeSchemas.TextPropertiesSchema;

const imageNodeSchemas = createImageNodeSchemas({
  normalizedPointSchema: NormalizedPointSchema,
  imageFiltersSchema: ImageFiltersSchema,
});
export const { ImagePlacementSchema, ImagePropertiesSchema } = imageNodeSchemas;

export { PathDataSchema } from "./path-schema.js";
const vectorSchemas = createVectorSchemas({
  paintSchema: PaintSchema,
  shapeProperties: ShapeProperties,
  pointSchema: PointSchema,
  pathDataSchema: PathDataSchema,
});
export const {
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
} = vectorSchemas;

const componentSchemas = createComponentSchemas({
  blendModeSchema: BlendModeSchema,
  effectSchema: EffectSchema,
  maskModeSchema: MaskModeSchema,
  jsonObjectSchema: JsonObjectSchema,
  componentPropertyAssignmentsSchema: ComponentPropertyAssignmentsSchema,
  componentPropertyDefinitionsSchema: ComponentPropertyDefinitionsSchema,
  variantPropertiesSchema: VariantPropertiesSchema,
});
export const {
  ComponentOverridePatchSchema,
  ComponentOverrideSchema,
  InstancePropertiesSchema,
  ComponentDefinitionSchema,
} = componentSchemas;

const documentResourceSchemas = createDocumentResourceSchemas({
  explicitVariableModesSchema: variables.ExplicitVariableModesSchema,
  sizeSchema: SizeSchema,
  jsonObjectSchema: JsonObjectSchema,
});
export const {
  DesignPageSchema,
  DesignAssetSchema,
  ImageAssetDerivationOperationSchema,
  ImageLightingPresetSchema,
  ImageAssetDerivationSchema,
} = documentResourceSchemas;

const nodeSchemas = createNodeSchemas({
  transformSchema: TransformSchema,
  sizeSchema: SizeSchema,
  layoutConstraintsSchema: layout.LayoutConstraintsSchema,
  layoutPositioningSchema: layout.LayoutPositioningSchema,
  layoutSizingSchema: layout.LayoutSizingSchema,
  layoutLimitsSchema: layout.LayoutLimitsSchema,
  gridChildPlacementSchema: layout.GridChildPlacementSchema,
  componentPropertyReferencesSchema: ComponentPropertyReferencesSchema,
  blendModeSchema: BlendModeSchema,
  effectSchema: EffectSchema,
  maskModeSchema: MaskModeSchema,
  explicitVariableModesSchema: variables.ExplicitVariableModesSchema,
  nodeBoundVariablesSchema: variables.NodeBoundVariablesSchema,
  nodeStyleReferenceProperties: styles.NodeStyleReferenceProperties,
  exportSettingsSchema: exportSettings.ExportSettingsSchema,
  jsonObjectSchema: JsonObjectSchema,
  shapeProperties: ShapeProperties,
  autoLayoutSchema: layout.AutoLayoutSchema,
  framePropertiesSchema: FramePropertiesSchema,
  groupPropertiesSchema: GroupPropertiesSchema,
  booleanPropertiesSchema: BooleanPropertiesSchema,
  rectanglePropertiesSchema: RectanglePropertiesSchema,
  ellipsePropertiesSchema: EllipsePropertiesSchema,
  linePropertiesSchema: LinePropertiesSchema,
  polygonPropertiesSchema: PolygonPropertiesSchema,
  starPropertiesSchema: StarPropertiesSchema,
  textPropertiesSchema: TextPropertiesSchema,
  imagePropertiesSchema: ImagePropertiesSchema,
  pathPropertiesSchema: PathPropertiesSchema,
  instancePropertiesSchema: InstancePropertiesSchema,
});
export const {
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
} = nodeSchemas;
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
> = nodeSchemas.DesignNodeSchema;

const librarySchemas = createLibrarySchemas({
  componentDefinitionSchema: ComponentDefinitionSchema,
  designNodeSchema: DesignNodeSchema,
  designAssetSchema: DesignAssetSchema,
  variantSetDefinitionSchema: VariantSetDefinitionSchema,
  sharedStyleDefinitionSchema: SharedStyleDefinitionSchema,
  variableCollectionDefinitionSchema:
    variables.VariableCollectionDefinitionSchema,
  variableDefinitionSchema: variables.VariableDefinitionSchema,
});

export const {
  LibraryReleaseIdentitySchema,
  LibraryComponentSourceSchema,
  LibraryVariantSetSourceSchema,
  LibraryStyleSourceSchema,
  LibraryVariableCollectionSourceSchema,
  LibraryVariableSourceSchema,
  LibraryReleaseSnapshotSchema,
} = librarySchemas;

export const DesignDocumentSchema: ReturnType<
  typeof createDesignDocumentSchema<{
    format: typeof DESIGN_FORMAT;
    schemaVersion: typeof versions.DESIGN_SCHEMA_VERSION;
    designPageSchema: typeof DesignPageSchema;
    designNodeSchema: typeof DesignNodeSchema;
    componentDefinitionSchema: typeof ComponentDefinitionSchema;
    variantSetDefinitionSchema: typeof VariantSetDefinitionSchema;
    libraryComponentSourceSchema: typeof LibraryComponentSourceSchema;
    libraryVariantSetSourceSchema: typeof LibraryVariantSetSourceSchema;
    libraryStyleSourceSchema: typeof LibraryStyleSourceSchema;
    libraryVariableCollectionSourceSchema: typeof LibraryVariableCollectionSourceSchema;
    libraryVariableSourceSchema: typeof LibraryVariableSourceSchema;
    styleOrderByTypeSchema: typeof StyleOrderByTypeSchema;
    sharedStyleDefinitionSchema: typeof SharedStyleDefinitionSchema;
    jsonValueSchema: typeof JsonValueSchema;
    designAssetSchema: typeof DesignAssetSchema;
    imageAssetDerivationSchema: typeof ImageAssetDerivationSchema;
    jsonObjectSchema: typeof JsonObjectSchema;
    variableDocumentProperties: typeof variables.VariableDocumentProperties;
  }>
> = createDesignDocumentSchema({
  format: DESIGN_FORMAT,
  schemaVersion: versions.DESIGN_SCHEMA_VERSION,
  designPageSchema: DesignPageSchema,
  designNodeSchema: DesignNodeSchema,
  componentDefinitionSchema: ComponentDefinitionSchema,
  variantSetDefinitionSchema: VariantSetDefinitionSchema,
  libraryComponentSourceSchema: LibraryComponentSourceSchema,
  libraryVariantSetSourceSchema: LibraryVariantSetSourceSchema,
  libraryStyleSourceSchema: LibraryStyleSourceSchema,
  libraryVariableCollectionSourceSchema: LibraryVariableCollectionSourceSchema,
  libraryVariableSourceSchema: LibraryVariableSourceSchema,
  styleOrderByTypeSchema: StyleOrderByTypeSchema,
  sharedStyleDefinitionSchema: SharedStyleDefinitionSchema,
  jsonValueSchema: JsonValueSchema,
  designAssetSchema: DesignAssetSchema,
  imageAssetDerivationSchema: ImageAssetDerivationSchema,
  jsonObjectSchema: JsonObjectSchema,
  variableDocumentProperties: variables.VariableDocumentProperties,
});
