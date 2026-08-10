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
  getSelectionBounds,
  getWorldTransform,
  invertTransform,
  multiplyTransforms,
  screenToDocument,
  transformPoint,
} from "./geometry.js";
export {
  canGroupNodes,
  canUngroupNode,
  planGroupNodes,
  planUngroupNode,
  type LayerOperationFailureCode,
  type LayerOperationPlan,
} from "./layer-operations.js";
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
