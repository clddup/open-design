import "@leafer-in/filter";
import { Filter } from "@leafer-ui/draw";
import type { ImageFilters } from "@opendesign/design-contracts";
import {
  applyImageFiltersToRgba,
  normalizeImageFilters,
} from "@opendesign/image-service";

export const LEAFER_IMAGE_ADJUSTMENT_FILTER =
  "opendesign-image-adjustments" as const;

const MAX_FILTER_CHUNK_PIXELS = 1_048_576;

type LeaferImageAdjustmentFilter = ImageFilters & {
  type: typeof LEAFER_IMAGE_ADJUSTMENT_FILTER;
};

export function toLeaferImageAdjustmentFilter(
  filters: ImageFilters | undefined,
): LeaferImageAdjustmentFilter | undefined {
  const normalized = normalizeImageFilters(filters);
  return normalized
    ? { type: LEAFER_IMAGE_ADJUSTMENT_FILTER, ...normalized }
    : undefined;
}

Filter.register(LEAFER_IMAGE_ADJUSTMENT_FILTER, {
  apply(filter, _ui, worldBounds, currentCanvas) {
    const normalized = normalizeImageFilters(filter as unknown as ImageFilters);
    if (!normalized) return;

    const pixelRatio = currentCanvas.pixelRatio;
    const left = Math.max(0, Math.floor(worldBounds.x * pixelRatio));
    const top = Math.max(0, Math.floor(worldBounds.y * pixelRatio));
    const right = Math.min(
      currentCanvas.pixelWidth,
      Math.ceil((worldBounds.x + worldBounds.width) * pixelRatio),
    );
    const bottom = Math.min(
      currentCanvas.pixelHeight,
      Math.ceil((worldBounds.y + worldBounds.height) * pixelRatio),
    );
    const width = right - left;
    const height = bottom - top;
    if (width <= 0 || height <= 0) return;

    const rowsPerChunk = Math.max(
      1,
      Math.floor(MAX_FILTER_CHUNK_PIXELS / width),
    );
    for (let offset = 0; offset < height; offset += rowsPerChunk) {
      const rows = Math.min(rowsPerChunk, height - offset);
      const imageData = currentCanvas.context.getImageData(
        left,
        top + offset,
        width,
        rows,
      );
      applyImageFiltersToRgba(imageData.data, normalized);
      currentCanvas.context.putImageData(imageData, left, top + offset);
    }
  },
  getSpread() {
    return 0;
  },
});
