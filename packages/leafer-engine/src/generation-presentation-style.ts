import type { LeaferGenerationSkeleton } from "./types.js";

export function generationSkeletonFill(
  role: LeaferGenerationSkeleton["regions"][number]["role"],
  defaultFill: string,
): string {
  return role === "media" || role === "graphic"
    ? "rgba(124, 110, 230, 0.12)"
    : defaultFill;
}

export function generationActivityBadgeWidth(label: string): number {
  let width = 28;
  for (const character of label) {
    width += character.codePointAt(0)! > 0xff ? 11 : 6.3;
  }
  return Math.min(220, Math.max(104, Math.ceil(width)));
}
