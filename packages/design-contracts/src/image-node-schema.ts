import { Type, type TSchema } from "@sinclair/typebox";

interface ImageNodeSchemaDependencies {
  normalizedPointSchema: TSchema;
  imageFiltersSchema: TSchema;
}

export function createImageNodeSchemas<
  const TDependencies extends ImageNodeSchemaDependencies,
>(dependencies: TDependencies) {
  const normalizedPointSchema = dependency(
    dependencies,
    "normalizedPointSchema",
  );
  const imageFiltersSchema = dependency(dependencies, "imageFiltersSchema");
  const ImagePlacementSchema = Type.Union([
    Type.Object(
      { mode: Type.Literal("stretch") },
      { additionalProperties: false },
    ),
    Type.Object({ mode: Type.Literal("fit") }, { additionalProperties: false }),
    Type.Object(
      { mode: Type.Literal("fill"), focalPoint: normalizedPointSchema },
      { additionalProperties: false },
    ),
    Type.Object(
      {
        mode: Type.Literal("crop"),
        focalPoint: normalizedPointSchema,
        zoom: Type.Number({ minimum: 1, maximum: 64 }),
        rotation: Type.Number({ minimum: -360, maximum: 360 }),
        flipHorizontal: Type.Boolean(),
        flipVertical: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
  ]);
  const ImagePropertiesSchema = Type.Object(
    {
      assetId: Type.String({ minLength: 1 }),
      placement: ImagePlacementSchema,
      filters: Type.Optional(imageFiltersSchema),
      altText: Type.String(),
      cornerRadius: Type.Number({ minimum: 0 }),
    },
    { additionalProperties: false },
  );
  return { ImagePlacementSchema, ImagePropertiesSchema };
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
