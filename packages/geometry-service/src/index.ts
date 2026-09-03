export const GEOMETRY_SERVICE_CONTRACT_VERSION = 40 as const;
export {
  LINE_ENDPOINT_MARKER_SIZE,
  LINE_ENDPOINT_MARKER_VIEW_BOX,
  LINE_ENDPOINT_STROKE_WIDTH,
  resolveLineEndpointGeometry,
  resolveLineEndpointVisiblePath,
  serializeLineEndpointPath,
  type LineEndpointGeometry,
  type LineEndpointPathCommand,
  type PaintedLineEndpoint,
} from "./line-endpoint.js";
export {
  resolveRegularShapeGeometry,
  type RegularShapeGeometryResult,
} from "./regular-shape.js";
export {
  localReflectionTransform,
  reflectionTransform,
  type ReflectionAxis,
} from "./reflection.js";

export {
  projectVectorNetworkCornerRadii,
  vectorNetworkHasCornerRadius,
  type VectorCornerRadiusProjectionResult,
} from "./vector-corner-radius.js";
export {
  alignItems,
  analyzeSmartSelection,
  distributeItems,
  MAX_ARRANGEMENT_SPACING,
  measureItemSpacing,
  rearrangeSmartSelectionGrid,
  reorderSmartSelection,
  setItemSpacing,
  setSmartSelectionSpacing,
  tidyUpItems,
  type AlignAction,
  type ArrangeAxis,
  type ArrangementFailure,
  type ArrangementFailureCode,
  type ArrangementItem,
  type ArrangementPlacement,
  type ArrangementPlan,
  type SpacingMeasurement,
  type SmartSelectionAnalysis,
  type SmartSelectionSpacingPlan,
  type TidyUpDimension,
  type TidyUpPlacement,
  type TidyUpPlan,
} from "./arrangement.js";
export {
  reflowSmartSelectionMutation,
  type SmartSelectionReflowMutation,
  type SmartSelectionReflowPlan,
} from "./smart-selection-reflow.js";
export {
  createSnapTargetIndex,
  resolveMoveSnapping,
  resolveResizeSnapping,
  type ResizeSnapResolution,
  type SnapAnchor,
  type SnapAxis,
  type SnapGuideLine,
  type SnapMatch,
  type SnapResolution,
  type SnapTarget,
  type SnapTargetIndex,
  type SnapTargetSource,
} from "./snapping.js";
export {
  createDirectionalSnapTargetIndex,
  directionalTargetFromAxis,
  resolveDirectionalMoveSnapping,
  resolveDirectionalResizeSnapping,
  type DirectionalMoveSnapResolution,
  type DirectionalResizeSnapResolution,
  type DirectionalSnapFrame,
  type DirectionalSnapMatch,
  type DirectionalSnapTarget,
  type DirectionalSnapTargetIndex,
} from "./directional-snapping.js";
export {
  resolveOrientedResizeSnapping,
  type OrientedResizeFrame,
  type OrientedResizeMatch,
  type OrientedResizeResolution,
} from "./oriented-resize-snapping.js";
export {
  createVectorSnapPathTarget,
  createVectorSnapTargetIndex,
  resolveVectorPointSnapping,
  type VectorAxisSnapMatch,
  type VectorPathSnapMatch,
  type VectorSnapMatch,
  type VectorSnapPathTarget,
  type VectorSnapPoint,
  type VectorSnapResolution,
  type VectorSnapTargetIndex,
} from "./vector-snapping.js";
export {
  formatDistanceMeasurement,
  measureGuideToRect,
  measureRectDistances,
  measureVectorAnchorDistances,
  type DistanceMeasurementId,
  type DistanceMeasurementSegment,
} from "./measurements.js";
export {
  connectVectorEndpoints,
  cutVectorNetworkByLine,
  cutVectorPath,
  deleteVectorSegments,
  deleteVectorSelection,
  deleteVectorVertices,
  disconnectVectorVertex,
  findVectorPathIdForVertex,
  inferVectorPointMode,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  nearestVectorSegmentPoint,
  reverseVectorPath,
  setVectorRegionFills,
  setVectorRegionFillStyle,
  setVectorVertexCornerRadius,
  setVectorVertexStrokeAppearance,
  setVectorPathClosed,
  setVectorPointMode,
  transformVectorVertices,
  vectorCornerRadiusEligibleVertexIds,
  vectorVertexBounds,
  vectorNetworkEditability,
  vectorNetworkPointEditability,
  type VectorCutLocation,
  type VectorCutResult,
  type VectorDeleteResult,
  type VectorEditFailureCode,
  type VectorEditResult,
  type VectorHandleReference,
  type VectorHandleSide,
  type VectorLineCutIntersection,
  type VectorLineCutResult,
  type VectorSegmentHit,
  type VectorVertexHandle,
  type VectorVertexStrokeAppearancePatch,
} from "./vector-edit.js";
export {
  appendVectorContour,
  appendVectorPoint,
  type VectorContourAppendResult,
  type VectorPointAppendResult,
} from "./vector-point-append.js";
export {
  insertVectorPoint,
  type VectorPointInsertResult,
} from "./vector-point-insert.js";
export {
  projectVectorNetworkStrokePaths,
  resolveVectorVertexStrokeAppearance,
  vectorPathTraversalSegments,
  vectorNetworkHasVertexStrokeOverrides,
  type EffectiveVectorVertexStrokeAppearance,
  type ProjectedVectorStrokePath,
  type VectorStrokeAppearanceFallback,
  type VectorStrokePathProjectionResult,
} from "./vector-stroke-appearance.js";
export {
  projectVariableWidthStrokePaths,
  variableWidthHitPosition,
  variableWidthPathLocation,
  variableWidthProfilePoints,
  variableWidthProfileIsUniform,
  type VariableWidthPathLocation,
  type VariableWidthStrokeProjectionOptions,
  type VariableWidthStrokeProjectionResult,
} from "./vector-variable-width.js";
export {
  deleteVariableWidthPoints,
  insertVariableWidthPoint,
  updateVariableWidthPoints,
  type VariableWidthPointInsertion,
} from "./vector-variable-width-edit.js";
export {
  materializeTransformedVectorNetwork,
  materializeVectorNetwork,
  mergeVectorNetworks,
  outlineVectorNetworkStroke,
  outlineVectorPath,
  type VectorMaterializationResult,
  type VectorOutlineOptions,
} from "./vector-materialization.js";
