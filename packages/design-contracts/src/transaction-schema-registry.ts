import type { TUnion } from "@sinclair/typebox";
import { createEditorWireSchemas } from "./editor-wire-schema.js";
import { createChangeSetSchemas } from "./change-set-schema.js";
import { createTransactionWireSchemas } from "./transaction-wire-schema.js";
import { createNodeOperationSchemas } from "./node-operation-schema.js";
import { createResourceOperationSchemas } from "./resource-operation-schema.js";
import { createDesignOperationSchema } from "./operation-schema.js";
import * as layout from "./layout.js";
import * as limits from "./limits.js";
import * as versions from "./versions.js";
import { ComponentPropertyReferencesSchema } from "./component-properties.js";
import {
  DeleteVariantSetCommandSchema,
  PutVariantSetCommandSchema,
  VariantSetChangeSchema,
} from "./variant-sets.js";
import {
  JsonObjectSchema,
  JsonValueSchema,
  RelativePointSchema,
  SizeSchema,
  TransformSchema,
} from "./primitives.js";
import * as variables from "./variables.js";
import * as styles from "./styles.js";
import * as exportSettings from "./export-settings.js";
import { BlendModeSchema, EffectSchema, PaintSchema } from "./appearance.js";
import {
  ComponentDefinitionSchema,
  DesignAssetSchema,
  DesignNodeSchema,
  DesignPageSchema,
  GuideCollectionSchema,
  ImageAssetDerivationSchema,
  LibraryComponentSourceSchema,
  LibraryStyleSourceSchema,
  LibraryVariableCollectionSourceSchema,
  LibraryVariableSourceSchema,
  LibraryVariantSetSourceSchema,
  MaskModeSchema,
  NodeKindSchema,
  PutStyleCommandSchema,
  DeleteStyleCommandSchema,
  MoveStyleCommandSchema,
  SetStyleReferenceCommandSchema,
  SharedStyleChangeSchema,
  TextRunsSchema,
} from "./node-schema-registry.js";

const nodeOperationSchemas = createNodeOperationSchemas({
  designNodeSchema: DesignNodeSchema,
  transformSchema: TransformSchema,
  sizeSchema: SizeSchema,
  relativePointSchema: RelativePointSchema,
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
  textRunsSchema: TextRunsSchema,
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
  guideCollectionSchema: GuideCollectionSchema,
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
