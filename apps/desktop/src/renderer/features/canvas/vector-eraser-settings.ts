import type { VectorEraserShape } from "@opendesign/geometry-service/vector-eraser";

export const VECTOR_ERASER_MIN_WEIGHT = 0.1;
export const VECTOR_ERASER_MAX_WEIGHT = 10_000;

export type VectorEraserSettings = {
  shape: VectorEraserShape;
  weight: number;
};

export const DEFAULT_VECTOR_ERASER_SETTINGS: VectorEraserSettings = {
  shape: "round",
  weight: 24,
};
