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
