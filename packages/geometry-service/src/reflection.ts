import type { Rect, Size, Transform } from "@opendesign/design-contracts";

export type ReflectionAxis = "horizontal" | "vertical";

export function reflectionTransform(
  axis: ReflectionAxis,
  bounds: Rect,
): Transform {
  return axis === "horizontal"
    ? [-1, 0, 0, 1, 2 * (bounds.x + bounds.width / 2), 0]
    : [1, 0, 0, -1, 0, 2 * (bounds.y + bounds.height / 2)];
}

export function localReflectionTransform(
  axis: ReflectionAxis,
  size: Size,
): Transform {
  return axis === "horizontal"
    ? [-1, 0, 0, 1, size.width, 0]
    : [1, 0, 0, -1, 0, size.height];
}
