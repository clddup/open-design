import type {
  DesignAsset,
  ImageAssetDerivation,
} from "@opendesign/design-contracts";
import type { ValidationIssue } from "./contract-validation";
import type {
  AgentAttachmentSelection,
  DesignImageEditRequest,
  DesignImageEditResult,
  DesignImageExpansion,
  DesignImageSelection,
} from "./media-input-contract-schemas";

export function agentAttachmentSelectionIssues(
  value: AgentAttachmentSelection,
): ValidationIssue[] {
  if (!value.attachmentId.startsWith("image_")) return [];
  return typeof value.previewDataUrl === "string" &&
    value.previewDataUrl.startsWith(`data:${value.mimeType};base64,`)
    ? []
    : [
        issue(
          "agent_attachment_selection.preview_mime_mismatch",
          "/previewDataUrl",
          "Image preview MIME type must match the attachment metadata",
        ),
      ];
}

export function designImageSelectionIssues(
  value: DesignImageSelection,
): ValidationIssue[] {
  return embeddedImageAssetIssues(value.asset, "/asset", false);
}

export function designImageExpansionIssues(
  value: DesignImageExpansion,
): ValidationIssue[] {
  return Object.values(value).some((candidate) => candidate > 0)
    ? []
    : [
        issue(
          "design_image_expansion.empty",
          "/",
          "At least one expansion edge must be greater than zero",
        ),
      ];
}

export function designImageEditRequestIssues(
  value: DesignImageEditRequest,
): ValidationIssue[] {
  const issues = embeddedImageAssetIssues(value.source, "/source", true);
  if (value.source.id !== value.expectedAssetId) {
    issues.push(
      issue(
        "design_image_edit_request.source_mismatch",
        "/expectedAssetId",
        "expectedAssetId must identify the embedded source asset",
      ),
    );
  }
  if ("prompt" in value && value.prompt.trim().length === 0) {
    issues.push(
      issue(
        "design_image_edit_request.prompt_empty",
        "/prompt",
        "Image edit prompt must contain visible text",
      ),
    );
  }
  if (value.action === "prompt-edit" && value.reference) {
    issues.push(
      ...embeddedImageAssetIssues(value.reference, "/reference", true),
    );
    if (value.reference.id === value.source.id) {
      issues.push(
        issue(
          "design_image_edit_request.reference_matches_source",
          "/reference/id",
          "Reference asset must differ from the source asset",
        ),
      );
    }
  }
  if (value.action === "expand") {
    issues.push(...prefixExpansionIssues(value.expansion, "/expansion"));
    if (value.targetSize.width <= 0 || value.targetSize.height <= 0) {
      issues.push(
        issue(
          "design_image_edit_request.target_size_invalid",
          "/targetSize",
          "Expansion target size must be positive",
        ),
      );
    }
  }
  return issues;
}

export function designImageEditResultIssues(
  value: DesignImageEditResult,
): ValidationIssue[] {
  const issues = embeddedImageAssetIssues(value.asset, "/asset", true);
  const derivation = value.derivation;
  if (derivation.sourceAssetId !== value.sourceAssetId) {
    issues.push(
      issue(
        "design_image_edit_result.source_mismatch",
        "/derivation/sourceAssetId",
        "Derivation source must match sourceAssetId",
      ),
    );
  }
  if (derivation.resultAssetId !== value.asset.id) {
    issues.push(
      issue(
        "design_image_edit_result.result_mismatch",
        "/derivation/resultAssetId",
        "Derivation result must match the returned asset",
      ),
    );
  }
  if (derivation.operation !== value.action) {
    issues.push(
      issue(
        "design_image_edit_result.operation_mismatch",
        "/derivation/operation",
        "Derivation operation must match the completed action",
      ),
    );
  }
  if (value.action !== "relight" && derivation.lightingPreset !== undefined) {
    issues.push(
      issue(
        "design_image_edit_result.lighting_preset_unexpected",
        "/derivation/lightingPreset",
        "Only relight may return a lighting preset",
      ),
    );
  }

  const supportingAssets = value.supportingAssets ?? [];
  const derivationInputIds = [
    ...derivation.referenceAssetIds,
    ...(derivation.maskAssetId ? [derivation.maskAssetId] : []),
  ];
  for (let index = 0; index < supportingAssets.length; index += 1) {
    const supportingAsset = supportingAssets[index];
    issues.push(
      ...embeddedImageAssetIssues(
        supportingAsset,
        `/supportingAssets/${index}`,
        true,
      ),
    );
    if (
      supportingAsset.id === value.sourceAssetId ||
      supportingAsset.id === value.asset.id
    ) {
      issues.push(
        issue(
          "design_image_edit_result.supporting_asset_alias",
          `/supportingAssets/${index}/id`,
          "Supporting asset must differ from source and result assets",
        ),
      );
    }
    if (supportingAsset.id !== derivationInputIds[index]) {
      issues.push(
        issue(
          "design_image_edit_result.supporting_asset_order",
          `/supportingAssets/${index}/id`,
          "Supporting assets must match derivation inputs in stable order",
        ),
      );
    }
  }
  if (supportingAssets.length !== derivationInputIds.length) {
    issues.push(
      issue(
        "design_image_edit_result.supporting_asset_count",
        "/supportingAssets",
        "Supporting assets must exactly materialize derivation inputs",
      ),
    );
  }
  issues.push(
    ...actionResultIssues(
      value.action,
      value.asset,
      derivation,
      supportingAssets,
    ),
  );
  return issues;
}

function actionResultIssues(
  action: DesignImageEditResult["action"],
  asset: DesignAsset,
  derivation: ImageAssetDerivation,
  supportingAssets: readonly DesignAsset[],
): ValidationIssue[] {
  const noPrompt = derivation.prompt === undefined;
  const noMask = derivation.maskAssetId === undefined;
  const noReferences = derivation.referenceAssetIds.length === 0;
  const noSupporting = supportingAssets.length === 0;
  if (action === "remove-background") {
    return noPrompt && noMask && noSupporting
      ? []
      : [actionIssue(action, "Remove-background must not carry edit inputs")];
  }
  if (action === "upscale") {
    return noPrompt &&
      noMask &&
      noReferences &&
      noSupporting &&
      asset.mimeType === "image/png"
      ? []
      : [actionIssue(action, "Upscale must return PNG without edit inputs")];
  }
  if (action === "replace-background") {
    return hasPrompt(derivation) && noMask && noReferences && noSupporting
      ? []
      : [
          actionIssue(
            action,
            "Background replacement requires only its trusted prompt",
          ),
        ];
  }
  if (action === "relight") {
    return derivation.lightingPreset !== undefined &&
      noPrompt &&
      noMask &&
      noReferences &&
      noSupporting
      ? []
      : [actionIssue(action, "Relight requires only a lighting preset")];
  }
  if (action === "prompt-edit") {
    return hasPrompt(derivation) && noMask
      ? []
      : [actionIssue(action, "Prompt edit requires a prompt and no mask")];
  }
  const maskAsset = supportingAssets[0];
  const validMask =
    hasPrompt(derivation) &&
    noReferences &&
    supportingAssets.length === 1 &&
    maskAsset?.mimeType === "image/png" &&
    derivation.maskAssetId === maskAsset.id;
  const validResult = action !== "expand" || asset.mimeType === "image/png";
  return validMask && validResult
    ? []
    : [
        actionIssue(
          action,
          "Area and expansion edits require one matching PNG mask and trusted prompt",
        ),
      ];
}

function embeddedImageAssetIssues(
  asset: DesignAsset,
  path: string,
  editable: boolean,
): ValidationIssue[] {
  const validMime =
    !editable ||
    asset.mimeType === "image/png" ||
    asset.mimeType === "image/jpeg" ||
    asset.mimeType === "image/webp";
  const valid =
    asset.kind === "image" &&
    /^asset_[a-f0-9]{64}$/.test(asset.id) &&
    validMime &&
    asset.source.type === "data" &&
    asset.source.value.length > 0 &&
    asset.source.value.length <= 24_000_000 &&
    /^[A-Za-z0-9+/]*={0,2}$/.test(asset.source.value) &&
    asset.size !== undefined &&
    asset.size.width > 0 &&
    asset.size.height > 0;
  return valid
    ? []
    : [
        issue(
          "design_image_asset.embedded_invalid",
          path,
          "Image asset must be a bounded embedded editable raster with positive dimensions",
        ),
      ];
}

function prefixExpansionIssues(
  value: DesignImageExpansion,
  prefix: string,
): ValidationIssue[] {
  return designImageExpansionIssues(value).map((current) => ({
    ...current,
    path: `${prefix}${current.path === "/" ? "" : current.path}`,
  }));
}

function hasPrompt(value: ImageAssetDerivation): boolean {
  return typeof value.prompt === "string" && value.prompt.trim().length > 0;
}

function actionIssue(action: string, message: string): ValidationIssue {
  return issue(
    "design_image_edit_result.action_invalid",
    "/derivation",
    `${action}: ${message}`,
  );
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Use current embedded image identities and return one internally consistent edit payload.",
  };
}
