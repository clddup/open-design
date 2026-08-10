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
  planImageNodeUpdate,
  type ImageUpdateFailureCode,
  type ImageUpdateOperation,
  type ImageUpdatePlan,
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
  EditorRuntime,
  diffDocuments,
  type EditorRuntimeListener,
  type EditorRuntimeOptions,
  type EditorSnapshot,
} from "./runtime.js";
