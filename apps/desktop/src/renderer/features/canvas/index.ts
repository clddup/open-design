export { Canvas } from "./components/Canvas";
export { useCanvasSnapSettings } from "./use-canvas-snap-settings";
export { CanvasSelectionActions } from "./components/CanvasSelectionActions";
export { useCanvasWorkspaceController } from "./use-canvas-workspace-controller";
export type { LayerHoverTarget } from "./layer-hover-target";
export {
  DEFAULT_VECTOR_ERASER_SETTINGS,
  VECTOR_ERASER_MAX_WEIGHT,
  VECTOR_ERASER_MIN_WEIGHT,
  type VectorEraserSettings,
} from "./vector-eraser-settings";
export {
  EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
  clearGenerationPlanPresentationRun,
  generationActivityFromAcceptedPlan,
  generationActivityMessageKey,
  projectGenerationPlanPresentationEvent,
} from "./generation-presentation";
