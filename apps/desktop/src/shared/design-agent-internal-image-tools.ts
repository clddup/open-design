import {
  DesignAssetSchema,
  executableJsonSchema,
  ImageAssetDerivationSchema,
  ImageFiltersSchema,
  ImagePaintSchema,
  type DesignAsset,
  type ImageAssetDerivation,
} from "@opendesign/design-contracts";
import {
  contractDiscriminatedSchemaIssues,
  contractSchemaIssues,
  type ValidationIssue,
  type ValidationIssueValue,
  type ValidationResult,
} from "./contract-validation";
import {
  DESIGN_IMAGE_PLACEMENT_SCHEMA,
  IMAGE_EXPANSION_SCHEMA,
  IMAGE_TOOL_ID_SCHEMA,
  IMAGE_TOOL_LABEL_SCHEMA,
  isBoundedEmbeddedImageAsset,
  type InternalReadImageSourceToolInput,
  type InternalUpdateImageToolInput,
} from "./design-agent-image-tools";

const POSITIVE_SIZE_SCHEMA = {
  type: "object",
  properties: {
    width: { type: "number", exclusiveMinimum: 0 },
    height: { type: "number", exclusiveMinimum: 0 },
  },
  required: ["width", "height"],
  additionalProperties: false,
} as const;

const COMMON_PROPERTIES = {
  label: IMAGE_TOOL_LABEL_SCHEMA,
  pageId: IMAGE_TOOL_ID_SCHEMA,
  nodeId: IMAGE_TOOL_ID_SCHEMA,
} as const;

const REQUIRED = ["action", "label", "pageId", "nodeId"] as const;

const SUPPORTING_ASSETS_SCHEMA = {
  type: "array",
  maxItems: 1,
  items: DesignAssetSchema,
} as const;

function branch(
  action: string,
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) {
  return {
    type: "object" as const,
    properties: {
      ...COMMON_PROPERTIES,
      action: { const: action },
      ...properties,
    },
    required: [...REQUIRED, ...required],
    additionalProperties: false,
  };
}

export const INTERNAL_READ_IMAGE_SOURCE_TOOL_INPUT_SCHEMA =
  executableJsonSchema({
    type: "object",
    description:
      "Trusted Main-to-Renderer request for one exact embedded image source. The expected asset ID is a stale-write guard, not a path or external locator.",
    properties: {
      pageId: IMAGE_TOOL_ID_SCHEMA,
      nodeId: IMAGE_TOOL_ID_SCHEMA,
      expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
    },
    required: ["pageId", "nodeId", "expectedAssetId"],
    additionalProperties: false,
  });

export const INTERNAL_UPDATE_IMAGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Trusted Main-to-Renderer image mutation. Public edits and host-materialized embedded assets share closed action branches; derivation provenance is validated separately from document/revision guards.",
  properties: {
    ...COMMON_PROPERTIES,
    action: {
      enum: [
        "set-placement",
        "set-filters",
        "set-paint-filters",
        "replace-source",
        "switch-source",
        "derive-source",
        "derive-layer",
        "expand-source",
        "upscale-source",
      ],
    },
    placement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
    filters: ImageFiltersSchema,
    paintField: { enum: ["fills", "strokes"] },
    paintIndex: { type: "integer", minimum: 0, maximum: 4_095 },
    expectedPaint: ImagePaintSchema,
    expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
    assetId: IMAGE_TOOL_ID_SCHEMA,
    asset: DesignAssetSchema,
    derivation: ImageAssetDerivationSchema,
    supportingAssets: SUPPORTING_ASSETS_SCHEMA,
    resultNodeId: IMAGE_TOOL_ID_SCHEMA,
    resultNodeName: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      pattern: "\\S",
    },
    expectedPlacement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
    expectedTargetSize: POSITIVE_SIZE_SCHEMA,
    expectedSourceSize: POSITIVE_SIZE_SCHEMA,
    targetSize: POSITIVE_SIZE_SCHEMA,
    expansion: IMAGE_EXPANSION_SCHEMA,
  },
  required: REQUIRED,
  anyOf: [
    branch("set-placement", { placement: DESIGN_IMAGE_PLACEMENT_SCHEMA }, [
      "placement",
    ]),
    branch("set-filters", { filters: ImageFiltersSchema }, ["filters"]),
    branch(
      "set-paint-filters",
      {
        paintField: { enum: ["fills", "strokes"] },
        paintIndex: { type: "integer", minimum: 0, maximum: 4_095 },
        expectedPaint: ImagePaintSchema,
        filters: ImageFiltersSchema,
      },
      ["paintField", "paintIndex", "expectedPaint", "filters"],
    ),
    branch(
      "switch-source",
      {
        expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
        assetId: IMAGE_TOOL_ID_SCHEMA,
      },
      ["expectedAssetId", "assetId"],
    ),
    branch(
      "replace-source",
      {
        asset: DesignAssetSchema,
        placement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
      },
      ["asset"],
    ),
    branch(
      "derive-source",
      {
        expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
        asset: DesignAssetSchema,
        derivation: ImageAssetDerivationSchema,
        supportingAssets: SUPPORTING_ASSETS_SCHEMA,
      },
      ["expectedAssetId", "asset", "derivation"],
    ),
    branch(
      "derive-layer",
      {
        expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
        resultNodeId: IMAGE_TOOL_ID_SCHEMA,
        resultNodeName: {
          type: "string",
          minLength: 1,
          maxLength: 256,
          pattern: "\\S",
        },
        asset: DesignAssetSchema,
        derivation: ImageAssetDerivationSchema,
        supportingAssets: SUPPORTING_ASSETS_SCHEMA,
      },
      [
        "expectedAssetId",
        "resultNodeId",
        "resultNodeName",
        "asset",
        "derivation",
      ],
    ),
    branch(
      "expand-source",
      {
        expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
        expectedPlacement: DESIGN_IMAGE_PLACEMENT_SCHEMA,
        expectedTargetSize: POSITIVE_SIZE_SCHEMA,
        expansion: IMAGE_EXPANSION_SCHEMA,
        asset: DesignAssetSchema,
        derivation: ImageAssetDerivationSchema,
        supportingAssets: {
          ...SUPPORTING_ASSETS_SCHEMA,
          minItems: 1,
          maxItems: 1,
        },
      },
      [
        "expectedAssetId",
        "expectedPlacement",
        "expectedTargetSize",
        "expansion",
        "asset",
        "derivation",
        "supportingAssets",
      ],
    ),
    branch(
      "upscale-source",
      {
        expectedAssetId: IMAGE_TOOL_ID_SCHEMA,
        expectedSourceSize: POSITIVE_SIZE_SCHEMA,
        targetSize: POSITIVE_SIZE_SCHEMA,
        asset: DesignAssetSchema,
        derivation: ImageAssetDerivationSchema,
      },
      [
        "expectedAssetId",
        "expectedSourceSize",
        "targetSize",
        "asset",
        "derivation",
      ],
    ),
  ],
  additionalProperties: false,
});

function parseRead(
  input: unknown,
): ValidationResult<InternalReadImageSourceToolInput> {
  const issues = contractSchemaIssues(
    INTERNAL_READ_IMAGE_SOURCE_TOOL_INPUT_SCHEMA,
    input,
    {
      code: "internal_read_image_source.schema_invalid",
      subject: "internal image source",
      maximum: 12,
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        value: structuredClone(input as InternalReadImageSourceToolInput),
      };
}

export const InternalReadImageSourceContract = {
  schema: INTERNAL_READ_IMAGE_SOURCE_TOOL_INPUT_SCHEMA,
  parse: parseRead,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseRead(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function parseUpdate(
  input: unknown,
): ValidationResult<InternalUpdateImageToolInput> {
  const structureIssues = contractDiscriminatedSchemaIssues(
    INTERNAL_UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
    input,
    "action",
    {
      code: "internal_update_image.schema_invalid",
      subject: "internal image update",
      maximum: 32,
    },
  );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }
  const value = input as InternalUpdateImageToolInput;
  const domainIssues = refineUpdate(value);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : { ok: true, value };
}

export const InternalUpdateImageContract = {
  schema: INTERNAL_UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
  parse: parseUpdate,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseUpdate(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function refineUpdate(input: InternalUpdateImageToolInput): ValidationIssue[] {
  if (
    input.action === "set-placement" ||
    input.action === "set-filters" ||
    input.action === "set-paint-filters" ||
    input.action === "switch-source"
  ) {
    return [];
  }
  const assetIssue = embeddedAssetIssue(input.asset, "/asset");
  if (assetIssue) return [assetIssue];
  if (input.action === "replace-source") return [];

  const { derivation } = input;
  if (derivation.sourceAssetId !== input.expectedAssetId) {
    return [
      issue(
        "/derivation/sourceAssetId",
        "Derivation source must match the stale-guarded current image asset",
        input.expectedAssetId,
        derivation.sourceAssetId,
      ),
    ];
  }
  if (derivation.resultAssetId !== input.asset.id) {
    return [
      issue(
        "/derivation/resultAssetId",
        "Derivation result must match the embedded replacement asset",
        input.asset.id,
        derivation.resultAssetId,
      ),
    ];
  }
  if (input.action === "upscale-source") {
    return refineUpscale(input, derivation);
  }
  if (input.action === "expand-source") {
    return refineExpansion(input, derivation);
  }
  if (
    (input.action === "derive-layer" &&
      derivation.operation !== "isolate-object") ||
    (input.action === "derive-source" &&
      derivation.operation === "isolate-object")
  ) {
    return [
      issue(
        "/derivation/operation",
        input.action === "derive-layer"
          ? "A derived layer is reserved for isolated-object results"
          : "An isolated-object result must create a derived layer",
        input.action === "derive-layer"
          ? "isolate-object"
          : "a source-replacement operation",
        derivation.operation,
      ),
    ];
  }
  return refineSourceDerivation(input, derivation);
}

function refineUpscale(
  input: Extract<InternalUpdateImageToolInput, { action: "upscale-source" }>,
  derivation: ImageAssetDerivation,
): ValidationIssue[] {
  if (input.asset.mimeType !== "image/png") {
    return [
      issue(
        "/asset/mimeType",
        "Upscale results must be embedded PNG assets",
        "image/png",
        input.asset.mimeType,
      ),
    ];
  }
  return derivation.operation === "upscale" &&
    derivation.prompt === undefined &&
    derivation.maskAssetId === undefined &&
    derivation.referenceAssetIds.length === 0
    ? []
    : [
        issue(
          "/derivation",
          "Upscale provenance must contain only the exact source/result relation",
          "operation=upscale; no prompt, mask, or references",
          derivation.operation,
        ),
      ];
}

function refineExpansion(
  input: Extract<InternalUpdateImageToolInput, { action: "expand-source" }>,
  derivation: ImageAssetDerivation,
): ValidationIssue[] {
  if (!Object.values(input.expansion).some((edge) => edge > 0)) {
    return [
      issue(
        "/expansion",
        "At least one expansion edge must be greater than zero",
        "top, right, bottom, or left > 0",
        input.expansion,
      ),
    ];
  }
  const mask = input.supportingAssets[0];
  const maskIssue = embeddedAssetIssue(mask, "/supportingAssets/0");
  if (maskIssue) return [maskIssue];
  return derivation.operation === "expand" &&
    derivation.maskAssetId !== undefined &&
    derivation.referenceAssetIds.length === 0 &&
    mask?.mimeType === "image/png" &&
    mask.id === derivation.maskAssetId
    ? []
    : [
        issue(
          "/supportingAssets",
          "Expansion requires one embedded PNG mask matching derivation.maskAssetId and no reference assets",
          { count: 1, mimeType: "image/png", operation: "expand" },
          input.supportingAssets.map(
            (asset) => `${asset.id}:${asset.mimeType}`,
          ),
        ),
      ];
}

function refineSourceDerivation(
  input: Extract<
    InternalUpdateImageToolInput,
    { action: "derive-source" | "derive-layer" }
  >,
  derivation: ImageAssetDerivation,
): ValidationIssue[] {
  const supportingAssets = input.supportingAssets ?? [];
  for (const [index, asset] of supportingAssets.entries()) {
    const assetIssue = embeddedAssetIssue(asset, `/supportingAssets/${index}`);
    if (assetIssue) return [assetIssue];
  }
  const expectedIds = [
    ...derivation.referenceAssetIds,
    ...(derivation.maskAssetId ? [derivation.maskAssetId] : []),
  ];
  if (
    supportingAssets.some((asset) => asset.mimeType === "image/gif") ||
    supportingAssets.length !== expectedIds.length ||
    supportingAssets.some(
      (asset, index) =>
        asset.id !== expectedIds[index] ||
        asset.id === input.expectedAssetId ||
        asset.id === input.asset.id,
    )
  ) {
    return [
      issue(
        "/supportingAssets",
        "Supporting assets must exactly and safely materialize referenceAssetIds followed by maskAssetId",
        expectedIds,
        supportingAssets.map((asset) => asset.id),
      ),
    ];
  }
  const operationIssue = refineOperation(derivation, supportingAssets);
  return operationIssue ? [operationIssue] : [];
}

function refineOperation(
  derivation: ImageAssetDerivation,
  supportingAssets: readonly DesignAsset[],
): ValidationIssue | undefined {
  if (
    derivation.operation !== "relight" &&
    derivation.lightingPreset !== undefined
  ) {
    return issue(
      "/derivation/lightingPreset",
      "lightingPreset is valid only for relight provenance",
      undefined,
      derivation.lightingPreset,
    );
  }
  if (derivation.operation === "remove-background") {
    return derivation.prompt === undefined &&
      derivation.maskAssetId === undefined &&
      supportingAssets.length === 0
      ? undefined
      : issue(
          "/derivation",
          "Background removal does not accept prompts, masks, or references",
        );
  }
  if (derivation.operation === "prompt-edit") {
    return derivation.prompt?.trim() && derivation.maskAssetId === undefined
      ? undefined
      : issue(
          "/derivation/prompt",
          "Prompt edit requires a non-empty prompt and no mask",
        );
  }
  if (derivation.operation === "replace-background") {
    return derivation.prompt?.trim() &&
      derivation.maskAssetId === undefined &&
      derivation.referenceAssetIds.length === 0 &&
      supportingAssets.length === 0
      ? undefined
      : issue(
          "/derivation",
          "Background replacement requires one prompt and no mask or references",
        );
  }
  if (derivation.operation === "relight") {
    return derivation.lightingPreset !== undefined &&
      derivation.prompt === undefined &&
      derivation.maskAssetId === undefined &&
      derivation.referenceAssetIds.length === 0 &&
      supportingAssets.length === 0
      ? undefined
      : issue(
          "/derivation",
          "Relighting requires one semantic lighting preset and no prompt, mask, or references",
        );
  }
  if (
    derivation.operation === "erase-object" ||
    derivation.operation === "isolate-object"
  ) {
    return derivation.prompt?.trim() &&
      derivation.referenceAssetIds.length === 0 &&
      derivation.maskAssetId !== undefined &&
      supportingAssets.length === 1 &&
      supportingAssets[0]?.mimeType === "image/png"
      ? undefined
      : issue(
          "/derivation",
          "Area edits require a non-empty prompt and one exact embedded PNG mask",
        );
  }
  return issue(
    "/derivation/operation",
    "This internal source derivation action is not supported",
    [
      "remove-background",
      "replace-background",
      "relight",
      "prompt-edit",
      "erase-object",
      "isolate-object",
    ],
    derivation.operation,
  );
}

function embeddedAssetIssue(
  value: unknown,
  path: string,
): ValidationIssue | undefined {
  return isBoundedEmbeddedImageAsset(value)
    ? undefined
    : issue(
        path,
        "Image materialization must be a bounded content-addressed embedded PNG, JPEG, WebP, or GIF asset with positive dimensions",
      );
}

function issue(
  path: string,
  message: string,
  expected?: ValidationIssueValue,
  actual?: ValidationIssueValue,
): ValidationIssue {
  return {
    code: "internal_update_image.provenance_invalid",
    path,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    recovery:
      "Rebuild the trusted materialization from the current source and submit one revised internal bridge request.",
  };
}
