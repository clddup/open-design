import {
  Type,
  type Static,
  type TSchema,
  type TUnion,
} from "@sinclair/typebox";
export {
  schemaValidationIssues,
  type SchemaValidationIssue,
} from "@opendesign/contract-runtime";
export { Type, type Static, type TSchema };
import { checkSchema } from "./schema-check.js";
export { executableJsonSchema } from "./schema-check.js";
import * as layout from "./layout.js";
import { createDesignDocumentContract } from "./document-contract.js";
export { designDocumentDomainIssues } from "./document-domain.js";
import { migrateDesignDocumentValue } from "./document-migration.js";
import { PathDataSchema } from "./path-schema.js";
import {
  createDesignOperationContract,
  createDesignTransactionContract,
} from "./operation-contract.js";
import { createDesignTransactionResultContract } from "./transaction-result-contract.js";
import { createEditorWireSchemas } from "./editor-wire-schema.js";
import { createChangeSetSchemas } from "./change-set-schema.js";
import { createTransactionWireSchemas } from "./transaction-wire-schema.js";
import { createNodeOperationSchemas } from "./node-operation-schema.js";
import { createResourceOperationSchemas } from "./resource-operation-schema.js";
import { createDesignOperationSchema } from "./operation-schema.js";
import { createComponentSchemas } from "./component-schema.js";
import { createDocumentResourceSchemas } from "./document-resource-schema.js";
import { createLibrarySchemas } from "./library-schema.js";
import { createDesignDocumentSchema } from "./design-document-schema.js";
import { createShapeSchemas } from "./shape-schema.js";
import { createTextNodeSchemas } from "./text-node-schema.js";
import { createImageNodeSchemas } from "./image-node-schema.js";
import { createVectorSchemas } from "./vector-schema.js";
import { createNodeSchemas } from "./node-schema.js";
import * as limits from "./limits.js";
import * as versions from "./versions.js";
import {
  ComponentPropertyAssignmentsSchema,
  ComponentPropertyDefinitionsSchema,
  ComponentPropertyReferencesSchema,
} from "./component-properties.js";
import {
  DeleteVariantSetCommandSchema,
  PutVariantSetCommandSchema,
  VariantPropertiesSchema,
  VariantSetChangeSchema,
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
export {
  designCommandListDomainIssues,
  designOperationDomainIssues,
  designTransactionDomainIssues,
} from "./operation-domain.js";
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
const TextSharedProperties = textNodeSchemas.TextSharedProperties;
export const TextPropertiesSchema = textNodeSchemas.TextPropertiesSchema;

const imageNodeSchemas = createImageNodeSchemas({
  normalizedPointSchema: NormalizedPointSchema,
  imageFiltersSchema: ImageFiltersSchema,
});
export const { ImagePlacementSchema, ImagePropertiesSchema } = imageNodeSchemas;

export { PathDataSchema } from "./path-schema.js";
const vectorSchemas = createVectorSchemas({
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

const nodeOperationSchemas = createNodeOperationSchemas({
  designNodeSchema: DesignNodeSchema,
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
  exportSettingsSchema: exportSettings.ExportSettingsSchema,
  jsonObjectSchema: JsonObjectSchema,
  fontFaceIdentityProperties: styles.FontFaceIdentityProperties,
  paintSchema: PaintSchema,
  textRunsSchema: TextSharedProperties.runs,
});

export const {
  InsertElementCommandSchema,
  UpdatePropertiesCommandSchema,
  MoveElementCommandSchema,
  DeleteElementCommandSchema,
  ReplaceSubtreeCommandSchema,
  TextFontDescriptorSchema,
  ReflowTextCommandSchema,
  UpdateTextRangeStyleCommandSchema,
  CommitTextEditParagraphPatchSchema,
  CommitTextEditCommandSchema,
} = nodeOperationSchemas;
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
> = nodeOperationSchemas.NodeDesignOperationSchema;

const resourceOperationSchemas = createResourceOperationSchemas({
  designAssetSchema: DesignAssetSchema,
  imageAssetDerivationSchema: ImageAssetDerivationSchema,
  componentDefinitionSchema: ComponentDefinitionSchema,
  libraryComponentSourceSchema: LibraryComponentSourceSchema,
  libraryVariantSetSourceSchema: LibraryVariantSetSourceSchema,
  libraryStyleSourceSchema: LibraryStyleSourceSchema,
  libraryVariableCollectionSourceSchema: LibraryVariableCollectionSourceSchema,
  libraryVariableSourceSchema: LibraryVariableSourceSchema,
  designPageSchema: DesignPageSchema,
  designNodeSchema: DesignNodeSchema,
  maxPageTransactionNodes: limits.MAX_PAGE_TRANSACTION_NODES,
});

export const {
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
  InsertPageCommandSchema,
  UpdatePageCommandSchema,
  MovePageCommandSchema,
  DeletePageCommandSchema,
} = resourceOperationSchemas;

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
> = createDesignOperationSchema(NodeDesignOperationSchema, [
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

const changeSetSchemas: ReturnType<
  typeof createChangeSetSchemas<
    typeof DesignNodeSchema,
    typeof DesignPageSchema,
    typeof ComponentDefinitionSchema,
    typeof LibraryComponentSourceSchema,
    typeof LibraryVariantSetSourceSchema,
    typeof LibraryStyleSourceSchema,
    typeof LibraryVariableCollectionSourceSchema,
    typeof LibraryVariableSourceSchema,
    typeof VariantSetChangeSchema,
    typeof SharedStyleChangeSchema,
    typeof variables.VariableChangeSetProperties
  >
> = createChangeSetSchemas({
  designNodeSchema: DesignNodeSchema,
  designPageSchema: DesignPageSchema,
  componentDefinitionSchema: ComponentDefinitionSchema,
  libraryComponentSourceSchema: LibraryComponentSourceSchema,
  libraryVariantSetSourceSchema: LibraryVariantSetSourceSchema,
  libraryStyleSourceSchema: LibraryStyleSourceSchema,
  libraryVariableCollectionSourceSchema: LibraryVariableCollectionSourceSchema,
  libraryVariableSourceSchema: LibraryVariableSourceSchema,
  variantSetChangeSchema: VariantSetChangeSchema,
  sharedStyleChangeSchema: SharedStyleChangeSchema,
  variableChangeSetProperties: variables.VariableChangeSetProperties,
});
export const NodeChangeSchema: (typeof changeSetSchemas)["NodeChangeSchema"] =
  changeSetSchemas.NodeChangeSchema;
export const PageChangeSchema: (typeof changeSetSchemas)["PageChangeSchema"] =
  changeSetSchemas.PageChangeSchema;
export const ComponentChangeSchema: (typeof changeSetSchemas)["ComponentChangeSchema"] =
  changeSetSchemas.ComponentChangeSchema;
export const LibraryComponentSourceChangeSchema: (typeof changeSetSchemas)["LibraryComponentSourceChangeSchema"] =
  changeSetSchemas.LibraryComponentSourceChangeSchema;
export const LibraryVariantSetSourceChangeSchema: (typeof changeSetSchemas)["LibraryVariantSetSourceChangeSchema"] =
  changeSetSchemas.LibraryVariantSetSourceChangeSchema;
export const LibraryStyleSourceChangeSchema: (typeof changeSetSchemas)["LibraryStyleSourceChangeSchema"] =
  changeSetSchemas.LibraryStyleSourceChangeSchema;
export const LibraryVariableCollectionSourceChangeSchema: (typeof changeSetSchemas)["LibraryVariableCollectionSourceChangeSchema"] =
  changeSetSchemas.LibraryVariableCollectionSourceChangeSchema;
export const LibraryVariableSourceChangeSchema: (typeof changeSetSchemas)["LibraryVariableSourceChangeSchema"] =
  changeSetSchemas.LibraryVariableSourceChangeSchema;
export const DesignChangeSetSchema: (typeof changeSetSchemas)["DesignChangeSetSchema"] =
  changeSetSchemas.DesignChangeSetSchema;

const transactionWireSchemas: ReturnType<
  typeof createTransactionWireSchemas<
    typeof DesignOperationSchema,
    typeof JsonObjectSchema,
    typeof JsonValueSchema,
    typeof DesignChangeSetSchema
  >
> = createTransactionWireSchemas({
  designOperationSchema: DesignOperationSchema,
  jsonObjectSchema: JsonObjectSchema,
  jsonValueSchema: JsonValueSchema,
  designChangeSetSchema: DesignChangeSetSchema,
  maxTransactionCommands: limits.MAX_TRANSACTION_COMMANDS,
});
export const DesignActorSchema: (typeof transactionWireSchemas)["DesignActorSchema"] =
  transactionWireSchemas.DesignActorSchema;
export const DesignTransactionSchema: (typeof transactionWireSchemas)["DesignTransactionSchema"] =
  transactionWireSchemas.DesignTransactionSchema;
export const DesignErrorCodeSchema: (typeof transactionWireSchemas)["DesignErrorCodeSchema"] =
  transactionWireSchemas.DesignErrorCodeSchema;
export const DesignIssueSchema: (typeof transactionWireSchemas)["DesignIssueSchema"] =
  transactionWireSchemas.DesignIssueSchema;
export const DesignErrorSchema: (typeof transactionWireSchemas)["DesignErrorSchema"] =
  transactionWireSchemas.DesignErrorSchema;
export const RevisionSchema: (typeof transactionWireSchemas)["RevisionSchema"] =
  transactionWireSchemas.RevisionSchema;
export const FidelityWarningSchema: (typeof transactionWireSchemas)["FidelityWarningSchema"] =
  transactionWireSchemas.FidelityWarningSchema;
export const TransactionModeSchema: (typeof transactionWireSchemas)["TransactionModeSchema"] =
  transactionWireSchemas.TransactionModeSchema;
export const DesignTransactionSuccessSchema: (typeof transactionWireSchemas)["DesignTransactionSuccessSchema"] =
  transactionWireSchemas.DesignTransactionSuccessSchema;
export const DesignTransactionFailureSchema: (typeof transactionWireSchemas)["DesignTransactionFailureSchema"] =
  transactionWireSchemas.DesignTransactionFailureSchema;
export const DesignTransactionResultSchema: (typeof transactionWireSchemas)["DesignTransactionResultSchema"] =
  transactionWireSchemas.DesignTransactionResultSchema;
export const HistoryEntrySchema: (typeof transactionWireSchemas)["HistoryEntrySchema"] =
  transactionWireSchemas.HistoryEntrySchema;

export const {
  HistoryStateSchema,
  ComponentSelectionTargetSchema,
  SelectionStateSchema,
  ViewportStateSchema,
  EditorStateSchema,
  EditorEventSchema,
  DesignCapabilitiesSchema,
  ExportArtifactSchema,
} = createEditorWireSchemas({
  historyEntrySchema: HistoryEntrySchema,
  designTransactionSuccessSchema: DesignTransactionSuccessSchema,
  designErrorSchema: DesignErrorSchema,
  schemaVersion: versions.DESIGN_SCHEMA_VERSION,
  nodeKindSchema: NodeKindSchema,
  jsonObjectSchema: JsonObjectSchema,
  fidelityWarningSchema: FidelityWarningSchema,
});

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
export type ImageLightingPreset = Static<typeof ImageLightingPresetSchema>;
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
export type DesignIssue = Static<typeof DesignIssueSchema>;
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

export function isDesignDocument(value: unknown): value is DesignDocument {
  return DesignDocumentContract.parse(value).ok;
}

export const DesignDocumentContract =
  createDesignDocumentContract(DesignDocumentSchema);

export function isDesignAsset(value: unknown): value is DesignAsset {
  return checkSchema(DesignAssetSchema, value);
}

export function isImageAssetDerivation(
  value: unknown,
): value is ImageAssetDerivation {
  return checkSchema(ImageAssetDerivationSchema, value);
}

export function isImageLightingPreset(
  value: unknown,
): value is ImageLightingPreset {
  return checkSchema(ImageLightingPresetSchema, value);
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
  return migrateDesignDocumentValue(value, (candidate) => {
    const parsed = DesignDocumentContract.parse(candidate);
    return parsed.ok ? parsed.value : null;
  });
}

export function isDesignOperation(value: unknown): value is DesignOperation {
  return DesignOperationContract.parse(value).ok;
}

export const DesignOperationContract = createDesignOperationContract(
  DesignOperationSchema,
);

export function isDesignTransaction(
  value: unknown,
): value is DesignTransaction {
  return DesignTransactionContract.parse(value).ok;
}

export const DesignTransactionContract = createDesignTransactionContract(
  DesignTransactionSchema,
);

export function isDesignTransactionResult(
  value: unknown,
): value is DesignTransactionResult {
  return DesignTransactionResultContract.parse(value).ok;
}

export const DesignTransactionResultContract =
  createDesignTransactionResultContract(DesignTransactionResultSchema);

export function isEditorEvent(value: unknown): value is EditorEvent {
  return checkSchema(EditorEventSchema, value);
}
export * from "./design-quality.js";
