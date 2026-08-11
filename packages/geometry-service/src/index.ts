export const GEOMETRY_SERVICE_CONTRACT_VERSION = 3 as const;

export {
  alignItems,
  distributeItems,
  MAX_ARRANGEMENT_SPACING,
  measureItemSpacing,
  setItemSpacing,
  type AlignAction,
  type ArrangeAxis,
  type ArrangementFailure,
  type ArrangementFailureCode,
  type ArrangementItem,
  type ArrangementPlacement,
  type ArrangementPlan,
  type SpacingMeasurement,
} from "./arrangement.js";
export {
  deleteVectorVertices,
  inferVectorPointMode,
  listVectorVertexHandles,
  moveVectorHandle,
  moveVectorVertices,
  setVectorPointMode,
  vectorNetworkEditability,
  type VectorDeleteResult,
  type VectorEditFailureCode,
  type VectorEditResult,
  type VectorHandleReference,
  type VectorHandleSide,
  type VectorVertexHandle,
} from "./vector-edit.js";
