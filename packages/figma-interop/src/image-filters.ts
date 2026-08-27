import { isImageFilters } from "@opendesign/design-contracts";
import type { ImageFilters as OpenDesignImageFilters } from "@opendesign/design-contracts";

export type OpenDesignImageFiltersResult =
  | { ok: true; filters: OpenDesignImageFilters }
  | { ok: false; issues: readonly string[] };

export function toFigmaImageFilters(
  filters: OpenDesignImageFilters | undefined,
): ImageFilters {
  return filters ? structuredClone(filters) : {};
}

export function fromFigmaImageFilters(
  filters: ImageFilters,
): OpenDesignImageFiltersResult {
  if (!isImageFilters(filters)) {
    return {
      ok: false,
      issues: [
        "Figma ImageFilters must contain only finite exposure, contrast, saturation, temperature, tint, highlights, and shadows values in the -1..1 range",
      ],
    };
  }
  return { ok: true, filters: structuredClone(filters) };
}
