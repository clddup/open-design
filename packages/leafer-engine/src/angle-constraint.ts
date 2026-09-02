import type { Point } from "@opendesign/design-contracts";

const OCTANT_ANGLE = Math.PI / 4;

/** Preserves distance while constraining a pointer to 45-degree increments. */
export function constrainPointToOctant(origin: Point, point: Point): Point {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  if (x === 0 && y === 0) return { ...point };
  const distance = Math.hypot(x, y);
  const angle = Math.round(Math.atan2(y, x) / OCTANT_ANGLE) * OCTANT_ANGLE;
  return {
    x: origin.x + Math.cos(angle) * distance,
    y: origin.y + Math.sin(angle) * distance,
  };
}
