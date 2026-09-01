import type { Static } from "@sinclair/typebox";
import type * as schema from "./schema-registry.js";

export type NodeKind = Static<typeof schema.NodeKindSchema>;
export type Rect = Static<typeof schema.RectSchema>;
export type BlendMode = Static<typeof schema.BlendModeSchema>;
export type SolidPaint = Static<typeof schema.SolidPaintSchema>;
export type GradientStop = Static<typeof schema.GradientStopSchema>;
export type LinearGradientPaint = Static<
  typeof schema.LinearGradientPaintSchema
>;
export type RadialGradientPaint = Static<
  typeof schema.RadialGradientPaintSchema
>;
export type AngularGradientPaint = Static<
  typeof schema.AngularGradientPaintSchema
>;
export type ImagePaint = Static<typeof schema.ImagePaintSchema>;
export type ImagePlacement = Static<typeof schema.ImagePlacementSchema>;
export type Paint = Static<typeof schema.PaintSchema>;
export type Effect = Static<typeof schema.EffectSchema>;
export type SharedStyleType = Static<typeof schema.SharedStyleTypeSchema>;
export type TextStyleProperties = Static<
  typeof schema.TextStylePropertiesSchema
>;
export type TextDecoration = Static<typeof schema.TextDecorationSchema>;
export type TextDecorationStyle = Static<
  typeof schema.TextDecorationStyleSchema
>;
export type TextDecorationMetric = Static<
  typeof schema.TextDecorationMetricSchema
>;
export type TextDecorationColor = Static<
  typeof schema.TextDecorationColorSchema
>;
export type PaintStyleDefinition = Static<
  typeof schema.PaintStyleDefinitionSchema
>;
export type TextStyleDefinition = Static<
  typeof schema.TextStyleDefinitionSchema
>;
export type EffectStyleDefinition = Static<
  typeof schema.EffectStyleDefinitionSchema
>;
export type GridStyleDefinition = Static<
  typeof schema.GridStyleDefinitionSchema
>;
export type SharedStyleDefinition = Static<
  typeof schema.SharedStyleDefinitionSchema
>;
export type StyleOrderByType = Static<typeof schema.StyleOrderByTypeSchema>;
export type StyleReferenceTarget = Static<
  typeof schema.StyleReferenceTargetSchema
>;
export type SharedStyleChange = Static<typeof schema.SharedStyleChangeSchema>;
export type MaskMode = Static<typeof schema.MaskModeSchema>;
export type LineEndpoint = Static<typeof schema.LineEndpointSchema>;
export type BooleanOperation = Static<typeof schema.BooleanOperationSchema>;
export type VectorVertex = Static<typeof schema.VectorVertexSchema>;
export type VectorPointMode = Static<typeof schema.VectorPointModeSchema>;
export type VectorVertexStrokeCap = Static<
  typeof schema.VectorVertexStrokeCapSchema
>;
export type VectorVertexStrokeJoin = Static<
  typeof schema.VectorVertexStrokeJoinSchema
>;
export type VectorSegment = Static<typeof schema.VectorSegmentSchema>;
export type VectorSegmentReference = Static<
  typeof schema.VectorSegmentReferenceSchema
>;
export type VectorPathRun = Static<typeof schema.VectorPathRunSchema>;
export type VectorRegion = Static<typeof schema.VectorRegionSchema>;
export type VectorNetwork = Static<typeof schema.VectorNetworkSchema>;
export type PathDataProperties = Static<typeof schema.PathDataPropertiesSchema>;
export type VectorNetworkProperties = Static<
  typeof schema.VectorNetworkPropertiesSchema
>;
export type FrameNode = Static<typeof schema.FrameNodeSchema>;
export type SliceNode = Static<typeof schema.SliceNodeSchema>;
export type SlotNode = Static<typeof schema.SlotNodeSchema>;
export type GroupNode = Static<typeof schema.GroupNodeSchema>;
export type BooleanNode = Static<typeof schema.BooleanNodeSchema>;
export type RectangleNode = Static<typeof schema.RectangleNodeSchema>;
export type EllipseNode = Static<typeof schema.EllipseNodeSchema>;
export type LineNode = Static<typeof schema.LineNodeSchema>;
export type PolygonNode = Static<typeof schema.PolygonNodeSchema>;
export type StarNode = Static<typeof schema.StarNodeSchema>;
export type TextNode = Static<typeof schema.TextNodeSchema>;
export type TextRun = NonNullable<TextNode["properties"]["runs"]>[number];
export type TextRunStyle = TextRun["style"];
export type TextParagraphRun = NonNullable<
  TextNode["properties"]["paragraphRuns"]
>[number];
export type TextParagraphStyle = TextParagraphRun["style"];
export type ImageNode = Static<typeof schema.ImageNodeSchema>;
export type VectorNode = Static<typeof schema.VectorNodeSchema>;
export type PathNode = Static<typeof schema.PathNodeSchema>;
export type InstanceNode = Static<typeof schema.InstanceNodeSchema>;
export type ComponentDefinition = Static<
  typeof schema.ComponentDefinitionSchema
>;
export type LibraryReleaseIdentity = Static<
  typeof schema.LibraryReleaseIdentitySchema
>;
export type LibraryComponentSource = Static<
  typeof schema.LibraryComponentSourceSchema
>;
export type LibraryVariantSetSource = Static<
  typeof schema.LibraryVariantSetSourceSchema
>;
export type LibraryStyleSource = Static<typeof schema.LibraryStyleSourceSchema>;
export type LibraryVariableCollectionSource = Static<
  typeof schema.LibraryVariableCollectionSourceSchema
>;
export type LibraryVariableSource = Static<
  typeof schema.LibraryVariableSourceSchema
>;
export type LibraryReleaseSnapshot = Static<
  typeof schema.LibraryReleaseSnapshotSchema
>;
export type ComponentOverride = Static<typeof schema.ComponentOverrideSchema>;
export type ComponentOverridePatch = Static<
  typeof schema.ComponentOverridePatchSchema
>;
export type DesignNode = Static<typeof schema.DesignNodeSchema>;
export type FrameLikeNode = FrameNode | SlotNode;
export function isFrameLikeNode(
  node: DesignNode | undefined,
): node is FrameLikeNode {
  return node?.kind === "frame" || node?.kind === "slot";
}
export type DesignPage = Static<typeof schema.DesignPageSchema>;
export type DesignAsset = Static<typeof schema.DesignAssetSchema>;
export type ImageAssetDerivationOperation = Static<
  typeof schema.ImageAssetDerivationOperationSchema
>;
export type ImageLightingPreset = Static<
  typeof schema.ImageLightingPresetSchema
>;
export type ImageAssetDerivation = Static<
  typeof schema.ImageAssetDerivationSchema
>;
export type DesignDocument = Static<typeof schema.DesignDocumentSchema>;
export type InsertElementCommand = Static<
  typeof schema.InsertElementCommandSchema
>;
export type UpdatePropertiesCommand = Static<
  typeof schema.UpdatePropertiesCommandSchema
>;
export type MoveElementCommand = Static<typeof schema.MoveElementCommandSchema>;
export type DeleteElementCommand = Static<
  typeof schema.DeleteElementCommandSchema
>;
export type ReplaceSubtreeCommand = Static<
  typeof schema.ReplaceSubtreeCommandSchema
>;
export type TextFontDescriptor = Static<typeof schema.TextFontDescriptorSchema>;
export type ReflowTextCommand = Static<typeof schema.ReflowTextCommandSchema>;
export type CommitTextEditParagraphPatch = Static<
  typeof schema.CommitTextEditParagraphPatchSchema
>;
export type CommitTextEditCommand = Static<
  typeof schema.CommitTextEditCommandSchema
>;
export type PutAssetCommand = Static<typeof schema.PutAssetCommandSchema>;
export type DeleteAssetCommand = Static<typeof schema.DeleteAssetCommandSchema>;
export type PutImageAssetDerivationCommand = Static<
  typeof schema.PutImageAssetDerivationCommandSchema
>;
export type DeleteImageAssetDerivationCommand = Static<
  typeof schema.DeleteImageAssetDerivationCommandSchema
>;
export type PutComponentCommand = Static<
  typeof schema.PutComponentCommandSchema
>;
export type DeleteComponentCommand = Static<
  typeof schema.DeleteComponentCommandSchema
>;
export type PutLibraryComponentSourceCommand = Static<
  typeof schema.PutLibraryComponentSourceCommandSchema
>;
export type DeleteLibraryComponentSourceCommand = Static<
  typeof schema.DeleteLibraryComponentSourceCommandSchema
>;
export type PutLibraryVariantSetSourceCommand = Static<
  typeof schema.PutLibraryVariantSetSourceCommandSchema
>;
export type DeleteLibraryVariantSetSourceCommand = Static<
  typeof schema.DeleteLibraryVariantSetSourceCommandSchema
>;
export type PutLibraryStyleSourceCommand = Static<
  typeof schema.PutLibraryStyleSourceCommandSchema
>;
export type DeleteLibraryStyleSourceCommand = Static<
  typeof schema.DeleteLibraryStyleSourceCommandSchema
>;
export type PutLibraryVariableCollectionSourceCommand = Static<
  typeof schema.PutLibraryVariableCollectionSourceCommandSchema
>;
export type DeleteLibraryVariableCollectionSourceCommand = Static<
  typeof schema.DeleteLibraryVariableCollectionSourceCommandSchema
>;
export type PutLibraryVariableSourceCommand = Static<
  typeof schema.PutLibraryVariableSourceCommandSchema
>;
export type DeleteLibraryVariableSourceCommand = Static<
  typeof schema.DeleteLibraryVariableSourceCommandSchema
>;
export type InsertPageCommand = Static<typeof schema.InsertPageCommandSchema>;
export type UpdatePageCommand = Static<typeof schema.UpdatePageCommandSchema>;
export type MovePageCommand = Static<typeof schema.MovePageCommandSchema>;
export type DeletePageCommand = Static<typeof schema.DeletePageCommandSchema>;
export type DesignOperation = Static<typeof schema.DesignOperationSchema>;
export type DesignActor = Static<typeof schema.DesignActorSchema>;
export type DesignTransaction = Static<typeof schema.DesignTransactionSchema>;
export type DesignErrorCode = Static<typeof schema.DesignErrorCodeSchema>;
export type DesignError = Static<typeof schema.DesignErrorSchema>;
export type DesignIssue = Static<typeof schema.DesignIssueSchema>;
export type Revision = Static<typeof schema.RevisionSchema>;
export type NodeChange = Static<typeof schema.NodeChangeSchema>;
export type PageChange = Static<typeof schema.PageChangeSchema>;
export type ComponentChange = Static<typeof schema.ComponentChangeSchema>;
export type LibraryComponentSourceChange = Static<
  typeof schema.LibraryComponentSourceChangeSchema
>;
export type LibraryVariantSetSourceChange = Static<
  typeof schema.LibraryVariantSetSourceChangeSchema
>;
export type LibraryStyleSourceChange = Static<
  typeof schema.LibraryStyleSourceChangeSchema
>;
export type LibraryVariableCollectionSourceChange = Static<
  typeof schema.LibraryVariableCollectionSourceChangeSchema
>;
export type LibraryVariableSourceChange = Static<
  typeof schema.LibraryVariableSourceChangeSchema
>;
export type DesignChangeSet = Static<typeof schema.DesignChangeSetSchema>;
export type DesignDiff = DesignChangeSet;
export type FidelityWarning = Static<typeof schema.FidelityWarningSchema>;
export type TransactionMode = Static<typeof schema.TransactionModeSchema>;
export type DesignTransactionSuccess = Static<
  typeof schema.DesignTransactionSuccessSchema
>;
export type DesignTransactionFailure = Static<
  typeof schema.DesignTransactionFailureSchema
>;
export type DesignTransactionResult = Static<
  typeof schema.DesignTransactionResultSchema
>;
export type CommandResult = DesignTransactionResult;
export type HistoryEntry = Static<typeof schema.HistoryEntrySchema>;
export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}
export type ComponentSelectionTarget = Static<
  typeof schema.ComponentSelectionTargetSchema
>;
export type SelectionState = Static<typeof schema.SelectionStateSchema>;
export type ViewportState = Static<typeof schema.ViewportStateSchema>;
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
export type DesignCapabilities = Static<typeof schema.DesignCapabilitiesSchema>;
export type ExportArtifact = Static<typeof schema.ExportArtifactSchema>;
export type AtomicChildCommand = DesignOperation;
export type DesignCommand = DesignOperation;
export type RunAtomicDesignBatchCommand = DesignTransaction;
