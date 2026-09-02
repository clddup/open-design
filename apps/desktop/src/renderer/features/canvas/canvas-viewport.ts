import type { Rect, ViewportState } from "@opendesign/design-contracts";

export function fitViewportToBounds(
  viewport: ViewportState,
  bounds: Rect,
  options: { maxZoom?: number; padding?: number } = {},
): Pick<ViewportState, "panX" | "panY" | "zoom"> | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const padding = Math.max(0, options.padding ?? 64);
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.min(
    options.maxZoom ?? 8,
    Math.max(
      0.1,
      Math.min(
        availableWidth / Math.max(bounds.width, 1),
        availableHeight / Math.max(bounds.height, 1),
      ),
    ),
  );
  return {
    zoom,
    panX: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    panY: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

export function generationFitPadding(viewport: ViewportState): number {
  return Math.max(64, Math.min(viewport.width, viewport.height) * 0.08);
}
