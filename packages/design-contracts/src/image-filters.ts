import { Type, type Static } from "@sinclair/typebox";

export const IMAGE_FILTER_KEYS = [
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "highlights",
  "shadows",
] as const;

const ImageFilterValueSchema = Type.Number({ minimum: -1, maximum: 1 });

/**
 * Figma-compatible non-destructive image adjustment fields. Missing values
 * are neutral and therefore equivalent to zero.
 */
export const ImageFiltersSchema = Type.Object(
  {
    exposure: Type.Optional(ImageFilterValueSchema),
    contrast: Type.Optional(ImageFilterValueSchema),
    saturation: Type.Optional(ImageFilterValueSchema),
    temperature: Type.Optional(ImageFilterValueSchema),
    tint: Type.Optional(ImageFilterValueSchema),
    highlights: Type.Optional(ImageFilterValueSchema),
    shadows: Type.Optional(ImageFilterValueSchema),
  },
  { additionalProperties: false },
);

export type ImageFilterKey = (typeof IMAGE_FILTER_KEYS)[number];
export type ImageFilters = Static<typeof ImageFiltersSchema>;
