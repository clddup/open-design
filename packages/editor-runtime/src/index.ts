export {
  DocumentValidationError,
  createEmptyDesignDocument,
  createWelcomeDocument,
  canonicalJsonStringify,
  deepFreeze,
  documentContentFingerprint,
  normalizeDesignDocument,
  validateDocumentInvariants,
  type DocumentInvariantIssue,
} from "./document.js";
export {
  IDENTITY_TRANSFORM,
  documentToScreen,
  getNodeBounds,
  getLocalSelectionBounds,
  getSelectionBounds,
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
  screenToDocument,
  transformPoint,
} from "./geometry.js";
export {
  canToggleMaskNodes,
  canDeleteNodes,
  canReorderNodes,
  canGroupNodes,
  canUngroupNode,
  getMaskToggleAction,
  isEffectivelyLocked,
  planCreateMaskGroup,
  planGroupNodes,
  planRemoveMask,
  planReparentNodes,
  planReorderNodes,
  planSetMaskType,
  planToggleMaskNodes,
  planUngroupNode,
  type DesignMaskType,
  type LayerOrderAction,
  type LayerOperationFailureCode,
  type LayerOperationPlan,
} from "./layer-operations.js";
export {
  LAYER_RENAME_ASCENDING_NUMBER_TOKEN,
  LAYER_RENAME_CURRENT_NAME_TOKEN,
  LAYER_RENAME_DESCENDING_NUMBER_TOKEN,
  MAX_LAYER_NAME_LENGTH,
  planRenameLayers,
  previewLayerRenames,
  type LayerRenameFailureCode,
  type LayerRenameInput,
  type LayerRenameItem,
  type LayerRenamePlan,
  type LayerRenamePreview,
  type LayerRenamePreviewResult,
} from "./layer-rename-operations.js";
export {
  planDeleteNodes,
  type DeleteNodesFailureCode,
  type DeleteNodesPlan,
} from "./deletion-operations.js";
export {
  getArrangementSelectionMetrics,
  planArrangeNodes,
  type ArrangeAction,
  type ArrangeOperation,
  type ArrangeOperationFailureCode,
  type ArrangeOperationPlan,
  type ArrangementSelectionMetrics,
} from "./arrange-operations.js";
export { MAX_ARRANGEMENT_SPACING } from "@opendesign/geometry-service";
export {
  planSetFrameAutoLayout,
  resolveAutoLayoutInPlace,
  type AutoLayoutOperationFailureCode,
  type AutoLayoutOperationPlan,
  type AutoLayoutResolution,
} from "./auto-layout-operations.js";
export { planSetNodeLayoutSizing } from "./auto-layout-sizing-operations.js";
export {
  planResizeGridTrack,
  planReorderGridTracks,
  planSetGridTrack,
  planSetNodeGridPlacement,
  type GridTrackAxis,
  type GridTrackMovement,
  type GridTrackReorderPlan,
  type GridTrackResizePlan,
  type GridTrackUpdatePlan,
} from "./auto-layout-grid-operations.js";
export { planSetNodeLayoutLimits } from "./auto-layout-limits-operations.js";
export {
  planSetNodeLayoutPositioning,
  type LayoutPositioningIntent,
  type LayoutPositioningOperationPlan,
} from "./auto-layout-positioning-operations.js";
export {
  planSetFrameLayoutGuides,
  type LayoutGuideOperationPlan,
} from "./layout-guide-operations.js";
export {
  planResizeFrameWithConstraints,
  planSetNodeConstraints,
  type FrameLayoutOperationFailureCode,
  type FrameLayoutOperationPlan,
} from "./frame-layout-operations.js";
export {
  canCreateBooleanGroup,
  canUngroupBooleanGroup,
  planCreateBooleanGroup,
  planSetBooleanOperation,
  planUngroupBooleanGroup,
  type BooleanOperationFailureCode,
  type BooleanOperationPlan,
} from "./boolean-operations.js";
export {
  navigateBooleanSelection,
  navigateLayerSelection,
  resolveBooleanEditScope,
  type BooleanEditScope,
  type BooleanSelectionDirection,
  type LayerSelectionDirection,
} from "./selection-navigation.js";
export {
  planDeleteVectorNode,
  planVectorLayersLineCut,
  planVectorLayersVertexTransform,
  planVectorNetworkUpdate,
  planVectorNetworkUpdates,
  planVectorSemanticEdit,
  resolveVectorEditCollectionScope,
  resolveVectorEditScope,
  type VectorEditCollectionScope,
  type VectorEditScope,
  type VectorLayerVertexTransformTarget,
  type VectorNetworkUpdateTarget,
  type VectorOperationFailureCode,
  type VectorOperationPlan,
  type VectorSemanticEdit,
  type VectorLayerLineCutTarget,
} from "./vector-operations.js";
export {
  componentMainNodeId,
  planCreateComponent,
  planCreateInstance,
  planCreateLibraryInstance,
  planDetachComponentInstance,
  planResetComponentOverrides,
  planRemoveComponent,
  planSetComponentOverride,
  type ComponentOperationFailureCode,
  type ComponentOperationPlan,
} from "./component-operations.js";
export {
  figmaComponentPropertyName,
  planAddComponentProperty,
  planRemoveComponentProperty,
  planRenameComponentProperty,
  planResetComponentPropertyValue,
  planSetComponentPropertyValue,
  type ComponentPropertyReferenceField,
} from "./component-property-operations.js";
export { planReorderComponentProperties } from "./component-property-order-operations.js";
export {
  planAddVariableMode,
  planApplyLibraryVariable,
  planCreateVariable,
  planCreateVariableCollection,
  planDeleteVariable,
  planDeleteVariableCollection,
  planMoveVariableCollection,
  planRemoveVariableMode,
  planSetExplicitVariableMode,
  planSetVariableBinding,
  planUpdateVariable,
  planUpdateVariableCollection,
  type VariableOperationFailureCode,
  type VariableOperationPlan,
} from "./variable-operations.js";
export {
  planCreateStyle,
  planCreateStyleFromNode,
  planApplyLibraryStyle,
  planDeleteStyle,
  planMoveStyle,
  planSetStyleReference,
  planUpdateStyle,
  planUpdateStyleFromNode,
  type StyleOperationFailureCode,
  type StyleOperationPlan,
} from "./style-operations.js";
export {
  planClearComponentSlot,
  planCreateComponentSlotOverride,
  planResetComponentSlot,
  planSetComponentSlotSettings,
} from "./component-slot-operations.js";
export {
  planCombineComponentsAsVariants,
  type VariantSetOperationFailureCode,
  type VariantSetOperationPlan,
} from "./variant-set-operations.js";
export {
  planAddComponentToVariantSet,
  planDissolveVariantSet,
  planDuplicateVariant,
  planRemoveVariantFromSet,
} from "./variant-set-membership-operations.js";
export {
  planAddVariantProperty,
  planRemoveVariantProperty,
  planRenameVariantProperty,
  planRenameVariantValue,
  planReorderVariantProperties,
  planReorderVariantValues,
  planSetVariantProperties,
} from "./variant-set-property-operations.js";
export {
  nodeReferencesAsset,
  getImageAssetFamily,
  indexImageAssetFamilies,
  planDeleteImageAsset,
  planImageNodeUpdate,
  planImagePaintFilterUpdate,
  planPlaceImageAsset,
  planReplaceImageAsset,
  type ImageAssetOperationFailureCode,
  type ImageAssetOperationPlan,
  type ImageAssetFamily,
  type ImageUpdateFailureCode,
  type ImageUpdateOperation,
  type ImageUpdatePlan,
  type ImagePaintFilterUpdateOperation,
  type PlaceImageAssetOperation,
} from "./image-operations.js";
export {
  planSvgImport,
  type SvgImportOperationFailureCode,
  type SvgImportOperationPlan,
  type SvgImportPlacement,
} from "./svg-import-operations.js";
export {
  MAX_SVG_EXPORT_PADDING,
  MAX_SVG_EXPORT_TITLE_CHARACTERS,
  planSvgExportRequest,
  type SvgExportBooleanSnapshot,
  type SvgExportPlan,
  type SvgExportPlanFailureCode,
  type SvgExportPlanInput,
} from "./svg-export-operations.js";
export {
  DESIGN_DIAGNOSTIC_REPORT_VERSION,
  diagnoseDesignPages,
  type DesignDiagnostic,
  type DesignDiagnosticCode,
  type DesignDiagnosticReport,
  type DesignDiagnosticSeverity,
  type DesignFeatureSummary,
} from "./diagnostics.js";
export {
  DESIGN_LAYOUT_QUALITY_REPORT_VERSION,
  diagnoseDesignTargetLayout,
  isDesignLayoutQualityReport,
  type DesignLayoutQualityCode,
  type DesignLayoutQualityGeometry,
  type DesignLayoutQualityIssue,
  type DesignLayoutQualityReport,
  type DesignLayoutQualitySeverity,
} from "./layout-quality.js";
export {
  planRepairDeliveryOverflow,
  type DeliveryOverflowRepairPlan,
} from "./layout-overflow-repair.js";
export {
  EditorRuntime,
  type EditorRuntimeListener,
  type EditorRuntimeOptions,
  type EditorSnapshot,
} from "./runtime.js";
export { diffDocuments } from "./document-diff.js";
export type { EditorApplyOptions } from "./editor-history.js";
export {
  normalizePageName,
  planClearPage,
  planCreatePage,
  planDeletePage,
  planDuplicatePage,
  planRenamePage,
  planReorderPage,
  type ClearPageInput,
  type CreatePageInput,
  type DeletePageInput,
  type DuplicatePageInput,
  type PageOperationFailureCode,
  type PageOperationPlan,
  type RenamePageInput,
  type ReorderPageInput,
} from "./page-operations.js";
export { defaultPageName } from "./page-naming.js";
