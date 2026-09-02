import { Type, type TSchema } from "@sinclair/typebox";

interface DocumentResourceSchemaDependencies {
  explicitVariableModesSchema: TSchema;
  guideCollectionSchema: TSchema;
  sizeSchema: TSchema;
  jsonObjectSchema: TSchema;
}

export function createDocumentResourceSchemas<
  const TDependencies extends DocumentResourceSchemaDependencies,
>(dependencies: TDependencies) {
  const explicitVariableModesSchema = dependency(
    dependencies,
    "explicitVariableModesSchema",
  );
  const guideCollectionSchema = dependency(
    dependencies,
    "guideCollectionSchema",
  );
  const sizeSchema = dependency(dependencies, "sizeSchema");
  const jsonObjectSchema = dependency(dependencies, "jsonObjectSchema");
  const DesignPageSchema = Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      name: Type.String(),
      rootNodeIds: Type.Array(Type.String({ minLength: 1 }), {
        uniqueItems: true,
      }),
      guides: Type.Optional(guideCollectionSchema),
      explicitVariableModes: Type.Optional(explicitVariableModesSchema),
      extensions: jsonObjectSchema,
    },
    { additionalProperties: false },
  );
  const DesignAssetSchema = Type.Object(
    {
      id: Type.String({ minLength: 1 }),
      kind: Type.Union([
        Type.Literal("image"),
        Type.Literal("font"),
        Type.Literal("binary"),
      ]),
      name: Type.String(),
      mimeType: Type.String({ minLength: 1 }),
      source: Type.Object(
        {
          type: Type.Union([
            Type.Literal("uri"),
            Type.Literal("data"),
            Type.Literal("external"),
          ]),
          value: Type.String(),
        },
        { additionalProperties: false },
      ),
      size: Type.Optional(sizeSchema),
      extensions: jsonObjectSchema,
    },
    { additionalProperties: false },
  );
  const ImageAssetDerivationOperationSchema = Type.Union([
    Type.Literal("replacement"),
    Type.Literal("remove-background"),
    Type.Literal("replace-background"),
    Type.Literal("erase-object"),
    Type.Literal("isolate-object"),
    Type.Literal("expand"),
    Type.Literal("upscale"),
    Type.Literal("prompt-edit"),
    Type.Literal("relight"),
    Type.Literal("style-harmonize"),
  ]);
  const ImageLightingPresetSchema = Type.Union([
    Type.Literal("natural-soft"),
    Type.Literal("studio-softbox"),
    Type.Literal("golden-hour"),
    Type.Literal("moonlight"),
    Type.Literal("neon"),
  ]);
  const ImageAssetDerivationSchema = Type.Object(
    {
      id: Type.String({ minLength: 1, maxLength: 256 }),
      sourceAssetId: Type.String({ minLength: 1 }),
      resultAssetId: Type.String({ minLength: 1 }),
      operation: ImageAssetDerivationOperationSchema,
      prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 32_000 })),
      lightingPreset: Type.Optional(ImageLightingPresetSchema),
      maskAssetId: Type.Optional(Type.String({ minLength: 1 })),
      referenceAssetIds: Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 16,
        uniqueItems: true,
      }),
      extensions: jsonObjectSchema,
    },
    { additionalProperties: false },
  );
  return {
    DesignPageSchema,
    DesignAssetSchema,
    ImageAssetDerivationOperationSchema,
    ImageLightingPresetSchema,
    ImageAssetDerivationSchema,
  };
}

function dependency<T extends object, TKey extends keyof T>(
  dependencies: T,
  key: TKey,
): T[TKey] {
  return dependencies[key];
}
