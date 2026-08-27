import {
  DesignAssetSchema,
  ImagePlacementSchema,
  type DesignAsset,
  type ImagePlacement,
} from "@opendesign/design-contracts";
import { Type } from "@sinclair/typebox";
import { defineContract, type ValidationIssue } from "./contract-validation";

const StableIdSchema = Type.String({ minLength: 1, maxLength: 256 });
const PositiveSizeSchema = Type.Object(
  {
    width: Type.Number({ exclusiveMinimum: 0 }),
    height: Type.Number({ exclusiveMinimum: 0 }),
  },
  { additionalProperties: false },
);

export const BoundedEmbeddedImageAssetSchema = Type.Intersect([
  DesignAssetSchema,
  Type.Object({
    id: Type.String({ pattern: "^asset_[a-f0-9]{64}$" }),
    kind: Type.Literal("image"),
    mimeType: Type.Union([
      Type.Literal("image/png"),
      Type.Literal("image/jpeg"),
      Type.Literal("image/webp"),
      Type.Literal("image/gif"),
    ]),
    source: Type.Object(
      {
        type: Type.Literal("data"),
        value: Type.String({
          minLength: 1,
          maxLength: 24_000_000,
          pattern: "^[A-Za-z0-9+/]*={0,2}$",
        }),
      },
      { additionalProperties: false },
    ),
    size: PositiveSizeSchema,
  }),
]);

export const PreparedImageEditSourceSchema = Type.Object(
  {
    kind: Type.Literal("prepared-image-edit-source"),
    pageId: StableIdSchema,
    nodeId: StableIdSchema,
    expectedAssetId: StableIdSchema,
    asset: BoundedEmbeddedImageAssetSchema,
    placement: ImagePlacementSchema,
    targetSize: PositiveSizeSchema,
  },
  { additionalProperties: false },
);

export type PreparedImageEditSource = {
  kind: "prepared-image-edit-source";
  pageId: string;
  nodeId: string;
  expectedAssetId: string;
  asset: DesignAsset;
  placement: ImagePlacement;
  targetSize: { width: number; height: number };
};

export const BoundedEmbeddedImageAssetContract = defineContract<DesignAsset>({
  schema: BoundedEmbeddedImageAssetSchema,
  code: "bounded_embedded_image_asset.schema_invalid",
  subject: "bounded embedded image asset",
  clone: false,
});

export const PreparedImageEditSourceContract =
  defineContract<PreparedImageEditSource>({
    schema: PreparedImageEditSourceSchema,
    code: "prepared_image_edit_source.schema_invalid",
    subject: "prepared image edit source",
    clone: false,
    refine: (value) => assetIdentityIssues(value),
  });

export function isPreparedImageEditSource(
  value: unknown,
): value is PreparedImageEditSource {
  return PreparedImageEditSourceContract.parse(value).ok;
}

export function isBoundedEmbeddedImageAsset(
  value: unknown,
): value is DesignAsset {
  return BoundedEmbeddedImageAssetContract.parse(value).ok;
}

function assetIdentityIssues(
  value: PreparedImageEditSource,
): ValidationIssue[] {
  return value.asset.id === value.expectedAssetId
    ? []
    : [
        {
          code: "prepared_image_edit_source.asset_identity_mismatch",
          path: "/asset/id",
          message: "Embedded asset ID must match expectedAssetId",
          expected: value.expectedAssetId,
          actual: value.asset.id,
          recovery:
            "Return the exact inspected image asset requested by the stale-write guard.",
        },
      ];
}
