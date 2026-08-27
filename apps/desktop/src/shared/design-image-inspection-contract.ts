import { Type, type Static } from "@sinclair/typebox";
import {
  DesignAssetSchema,
  ImageAssetDerivationOperationSchema,
} from "@opendesign/design-contracts";
import { defineContract, type ValidationIssue } from "./contract-validation";

const MAX_IMAGE_INSPECTION_ISSUES = 64;

const ImageAssetIdSchema = Type.String({ minLength: 1, maxLength: 512 });
const InspectedImageAssetSchema = Type.Object(
  {
    id: ImageAssetIdSchema,
    kind: Type.Literal("image"),
    name: DesignAssetSchema.properties.name,
    mimeType: DesignAssetSchema.properties.mimeType,
    sourceType: DesignAssetSchema.properties.source.properties.type,
    size: DesignAssetSchema.properties.size,
    extensionKeys: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), {
      maxItems: 1_024,
      uniqueItems: true,
    }),
    availability: Type.Optional(Type.Literal("design-file")),
    generated: Type.Optional(Type.Literal(true)),
    designRole: Type.Optional(Type.String({ minLength: 1, maxLength: 512 })),
  },
  { additionalProperties: false },
);

const InspectedImageAssetDerivationSchema = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 256 }),
    sourceAssetId: ImageAssetIdSchema,
    resultAssetId: ImageAssetIdSchema,
    operation: ImageAssetDerivationOperationSchema,
    maskAssetId: Type.Optional(ImageAssetIdSchema),
    referenceAssetIds: Type.Array(ImageAssetIdSchema, {
      maxItems: 16,
      uniqueItems: true,
    }),
    promptPresent: Type.Boolean(),
  },
  { additionalProperties: false },
);

export const DesignImageInspectionSchema = Type.Object(
  {
    assetsById: Type.Record(ImageAssetIdSchema, InspectedImageAssetSchema, {
      maxProperties: 100_000,
    }),
    imageAssetDerivations: Type.Array(InspectedImageAssetDerivationSchema, {
      maxItems: 64,
    }),
    imageAssetDerivationsTruncated: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type DesignImageInspection = Static<typeof DesignImageInspectionSchema>;

export const DesignImageInspectionContract = defineContract<
  DesignImageInspection,
  DesignImageInspection
>({
  schema: DesignImageInspectionSchema,
  code: "design_image_inspection.schema_invalid",
  subject: "design image inspection",
  maximum: MAX_IMAGE_INSPECTION_ISSUES,
  clone: false,
  refine: imageInspectionIssues,
});

function imageInspectionIssues(
  value: DesignImageInspection,
): ValidationIssue[] {
  const issues = assetIssues(value);
  const derivationIds = new Set<string>();
  for (const [index, derivation] of value.imageAssetDerivations.entries()) {
    if (issues.length >= MAX_IMAGE_INSPECTION_ISSUES) break;
    const path = `/imageAssetDerivations/${index}`;
    if (derivationIds.has(derivation.id)) {
      issues.push(
        issue(
          "design_image_inspection.derivation_duplicate",
          `${path}/id`,
          "Image derivation id must be unique in inspection",
          derivation.id,
        ),
      );
    }
    derivationIds.add(derivation.id);
    for (const [field, assetId] of derivationAssetReferences(derivation)) {
      if (!value.assetsById[assetId]) {
        issues.push(
          issue(
            "design_image_inspection.asset_reference_missing",
            `${path}/${field}`,
            "Image derivation reference must identify an inspected image asset",
            assetId,
          ),
        );
      }
    }
    if (
      derivation.sourceAssetId === derivation.resultAssetId ||
      derivation.maskAssetId === derivation.resultAssetId ||
      derivation.referenceAssetIds.includes(derivation.resultAssetId)
    ) {
      issues.push(
        issue(
          "design_image_inspection.derivation_result_reused",
          `${path}/resultAssetId`,
          "Image derivation result cannot also be one of its inputs",
          derivation.resultAssetId,
        ),
      );
    }
  }
  if (
    value.imageAssetDerivationsTruncated &&
    value.imageAssetDerivations.length < 64
  ) {
    issues.push({
      code: "design_image_inspection.truncation_invalid",
      path: "/imageAssetDerivationsTruncated",
      message: "Truncated image derivations must fill the inspection budget",
      expected: 64,
      actual: value.imageAssetDerivations.length,
      recovery: "Regenerate the bounded image inspection projection.",
    });
  }
  return issues.slice(0, MAX_IMAGE_INSPECTION_ISSUES);
}

function assetIssues(value: DesignImageInspection): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [assetId, asset] of Object.entries(value.assetsById)) {
    const path = `/assetsById/${escapePath(assetId)}`;
    if (asset.id !== assetId) {
      issues.push({
        code: "design_image_inspection.asset_identity_mismatch",
        path: `${path}/id`,
        message: "Image asset map key must match asset id",
        expected: assetId,
        actual: asset.id,
        recovery: "Regenerate image inspection from the current Design File.",
      });
    }
    if (
      asset.generated !== true &&
      (asset.availability !== undefined || asset.designRole !== undefined)
    ) {
      issues.push(
        issue(
          "design_image_inspection.generated_metadata_invalid",
          path,
          "Design File availability and design role require a generated asset",
          assetId,
        ),
      );
    }
    if (
      asset.generated === true &&
      (!asset.extensionKeys.includes("generatedBy") ||
        asset.availability !== "design-file")
    ) {
      issues.push(
        issue(
          "design_image_inspection.generated_metadata_invalid",
          path,
          "Generated assets must expose their provenance key and Design File availability",
          assetId,
        ),
      );
    }
    if (
      asset.designRole !== undefined &&
      !asset.extensionKeys.includes("designRole")
    ) {
      issues.push(
        issue(
          "design_image_inspection.design_role_invalid",
          `${path}/designRole`,
          "Projected design role must be present in extensionKeys",
          asset.designRole,
        ),
      );
    }
    if (issues.length >= MAX_IMAGE_INSPECTION_ISSUES) break;
  }
  return issues;
}

function derivationAssetReferences(
  derivation: DesignImageInspection["imageAssetDerivations"][number],
): Array<[string, string]> {
  return [
    ["sourceAssetId", derivation.sourceAssetId],
    ["resultAssetId", derivation.resultAssetId],
    ...(derivation.maskAssetId
      ? ([["maskAssetId", derivation.maskAssetId]] as Array<[string, string]>)
      : []),
    ...derivation.referenceAssetIds.map((assetId, index): [string, string] => [
      `referenceAssetIds/${index}`,
      assetId,
    ]),
  ];
}

function issue(
  code: string,
  path: string,
  message: string,
  actual: string,
): ValidationIssue {
  return {
    code,
    path,
    message,
    actual,
    recovery: "Regenerate image inspection from the current Design File.",
  };
}

function escapePath(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
