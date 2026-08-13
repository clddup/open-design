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
  canDeleteNodes,
  canReorderNodes,
  canGroupNodes,
  canUngroupNode,
  planGroupNodes,
  planReparentNodes,
  planReorderNodes,
  planUngroupNode,
  type LayerOrderAction,
  type LayerOperationFailureCode,
  type LayerOperationPlan,
} from "./layer-operations.js";
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
export { planSetNodeLayoutLimits } from "./auto-layout-limits-operations.js";
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
  resolveBooleanEditScope,
  type BooleanEditScope,
  type BooleanSelectionDirection,
} from "./selection-navigation.js";
export {
  planDeleteVectorNode,
  planVectorNetworkUpdate,
  planVectorLayersLineCut,
  planVectorSemanticEdit,
  resolveVectorEditCollectionScope,
  resolveVectorEditScope,
  type VectorEditCollectionScope,
  type VectorEditScope,
  type VectorOperationFailureCode,
  type VectorOperationPlan,
  type VectorSemanticEdit,
  type VectorLayerLineCutTarget,
} from "./vector-operations.js";
export {
  componentMainNodeId,
  planCreateComponent,
  planCreateInstance,
  planDetachComponentInstance,
  planResetComponentOverrides,
  planRemoveComponent,
  planSetComponentOverride,
  type ComponentOperationFailureCode,
  type ComponentOperationPlan,
} from "./component-operations.js";
export {
  nodeReferencesAsset,
  planDeleteImageAsset,
  planImageNodeUpdate,
  planPlaceImageAsset,
  planReplaceImageAsset,
  type ImageAssetOperationFailureCode,
  type ImageAssetOperationPlan,
  type ImageUpdateFailureCode,
  type ImageUpdateOperation,
  type ImageUpdatePlan,
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
  EditorRuntime,
  diffDocuments,
  type EditorRuntimeListener,
  type EditorRuntimeOptions,
  type EditorSnapshot,
} from "./runtime.js";
export {
  normalizePageName,
  planCreatePage,
  planDeletePage,
  planDuplicatePage,
  planRenamePage,
  planReorderPage,
  type CreatePageInput,
  type DeletePageInput,
  type DuplicatePageInput,
  type PageOperationFailureCode,
  type PageOperationPlan,
  type RenamePageInput,
  type ReorderPageInput,
} from "./page-operations.js";
