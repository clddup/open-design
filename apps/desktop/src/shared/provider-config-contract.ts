import {
  defineContract,
  formatValidationFailure,
  type Contract,
} from "./contract-validation";
import {
  refineGlobalImageGenerationSettings,
  refineModelProviderCatalog,
  refineProviderConnectionResult,
  refineSaveGlobalImageGenerationSettingsRequest,
  refineSaveModelProviderProfileRequest,
  refineTestModelProviderConnectionRequest,
} from "./provider-config-contract-domain";
import {
  DeleteModelProviderProfileRequestSchema,
  GlobalImageGenerationSettingsSchema,
  MODEL_PROVIDER_CATALOG_VERSION,
  ModelProviderCatalogSchema,
  ModelProviderProfileSchema,
  ProviderConnectionResultSchema,
  SaveGlobalImageGenerationSettingsRequestSchema,
  SaveModelProviderProfileRequestSchema,
  TestModelProviderConnectionRequestSchema,
  type DeleteModelProviderProfileRequest,
  type GlobalImageGenerationSettings,
  type ModelProviderCatalog,
  type ModelProviderProfile,
  type ProviderConnectionResult,
  type SaveGlobalImageGenerationSettingsRequest,
  type SaveModelProviderProfileRequest,
  type TestModelProviderConnectionRequest,
} from "./provider-config-contract-schemas";

export {
  GLOBAL_IMAGE_GENERATION_SETTINGS_VERSION,
  MODEL_PROVIDER_CATALOG_VERSION,
  type DeleteModelProviderProfileRequest,
  type GlobalImageGenerationSettings,
  type ImageGenerationApiFormat,
  type ModelCapabilities,
  type ModelProfile,
  type ModelProviderCatalog,
  type ModelProviderProfile,
  type ProviderConnectionResult,
  type SaveGlobalImageGenerationSettingsRequest,
  type SaveModelProviderProfileRequest,
  type TestModelProviderConnectionRequest,
} from "./provider-config-contract-schemas";

export const ModelProviderCatalogContract =
  defineContract<ModelProviderCatalog>({
    schema: ModelProviderCatalogSchema,
    code: "provider_config.catalog_schema_invalid",
    subject: "model Provider catalog",
    clone: false,
    refine: refineModelProviderCatalog,
  });

export const ModelProviderProfileContract =
  defineContract<ModelProviderProfile>({
    schema: ModelProviderProfileSchema,
    code: "provider_config.profile_schema_invalid",
    subject: "model Provider profile",
    clone: false,
    refine: (value) =>
      refineModelProviderCatalog({
        version: MODEL_PROVIDER_CATALOG_VERSION,
        providers: [value],
      }),
  });

export const SaveModelProviderProfileRequestContract =
  defineContract<SaveModelProviderProfileRequest>({
    schema: SaveModelProviderProfileRequestSchema,
    code: "provider_config.save_profile_schema_invalid",
    subject: "model Provider save request",
    clone: false,
    refine: refineSaveModelProviderProfileRequest,
  });

export const DeleteModelProviderProfileRequestContract =
  defineContract<DeleteModelProviderProfileRequest>({
    schema: DeleteModelProviderProfileRequestSchema,
    code: "provider_config.delete_profile_schema_invalid",
    subject: "model Provider delete request",
    clone: false,
  });

export const TestModelProviderConnectionRequestContract =
  defineContract<TestModelProviderConnectionRequest>({
    schema: TestModelProviderConnectionRequestSchema,
    code: "provider_config.test_connection_schema_invalid",
    subject: "model Provider connection test request",
    clone: false,
    refine: refineTestModelProviderConnectionRequest,
  });

export const GlobalImageGenerationSettingsContract =
  defineContract<GlobalImageGenerationSettings>({
    schema: GlobalImageGenerationSettingsSchema,
    code: "provider_config.image_settings_schema_invalid",
    subject: "global image-generation settings",
    clone: false,
    refine: refineGlobalImageGenerationSettings,
  });

export const SaveGlobalImageGenerationSettingsRequestContract =
  defineContract<SaveGlobalImageGenerationSettingsRequest>({
    schema: SaveGlobalImageGenerationSettingsRequestSchema,
    code: "provider_config.save_image_settings_schema_invalid",
    subject: "global image-generation settings request",
    clone: false,
    refine: refineSaveGlobalImageGenerationSettingsRequest,
  });

export const ProviderConnectionResultContract =
  defineContract<ProviderConnectionResult>({
    schema: ProviderConnectionResultSchema,
    code: "provider_config.connection_result_schema_invalid",
    subject: "model Provider connection result",
    clone: false,
    refine: refineProviderConnectionResult,
  });

export function isModelProviderCatalog(
  value: unknown,
): value is ModelProviderCatalog {
  return ModelProviderCatalogContract.parse(value).ok;
}

export function modelProviderCatalogValidationError(
  value: unknown,
): string | null {
  return validationFailure(
    "model Provider catalog",
    ModelProviderCatalogContract,
    value,
  );
}

export function isModelProviderProfile(
  value: unknown,
): value is ModelProviderProfile {
  return ModelProviderProfileContract.parse(value).ok;
}

export function isSaveModelProviderProfileRequest(
  value: unknown,
): value is SaveModelProviderProfileRequest {
  return SaveModelProviderProfileRequestContract.parse(value).ok;
}

export function saveModelProviderProfileRequestValidationError(
  value: unknown,
): string | null {
  return validationFailure(
    "model Provider save request",
    SaveModelProviderProfileRequestContract,
    value,
  );
}

export function isDeleteModelProviderProfileRequest(
  value: unknown,
): value is DeleteModelProviderProfileRequest {
  return DeleteModelProviderProfileRequestContract.parse(value).ok;
}

export function deleteModelProviderProfileRequestValidationError(
  value: unknown,
): string | null {
  return validationFailure(
    "model Provider delete request",
    DeleteModelProviderProfileRequestContract,
    value,
  );
}

export function isModelSelection(
  value: unknown,
): value is TestModelProviderConnectionRequest {
  return TestModelProviderConnectionRequestContract.parse(value).ok;
}

export const isTestModelProviderConnectionRequest = isModelSelection;

export function testModelProviderConnectionRequestValidationError(
  value: unknown,
): string | null {
  return validationFailure(
    "model Provider connection test request",
    TestModelProviderConnectionRequestContract,
    value,
  );
}

export function isGlobalImageGenerationSettings(
  value: unknown,
): value is GlobalImageGenerationSettings {
  return GlobalImageGenerationSettingsContract.parse(value).ok;
}

export function isSaveGlobalImageGenerationSettingsRequest(
  value: unknown,
): value is SaveGlobalImageGenerationSettingsRequest {
  return SaveGlobalImageGenerationSettingsRequestContract.parse(value).ok;
}

export function saveGlobalImageGenerationSettingsRequestValidationError(
  value: unknown,
): string | null {
  return validationFailure(
    "global image-generation settings request",
    SaveGlobalImageGenerationSettingsRequestContract,
    value,
  );
}

export function isProviderConnectionResult(
  value: unknown,
): value is ProviderConnectionResult {
  return ProviderConnectionResultContract.parse(value).ok;
}

export function normalizeProviderBaseUrl(value: string): string {
  const url = new URL(value.trim());
  url.pathname = url.pathname.replace(/\/+$/u, "");
  return url.toString().replace(/\/$/u, "");
}

function validationFailure<T>(
  subject: string,
  contract: Contract<T>,
  value: unknown,
): string | null {
  const result = contract.parse(value);
  return result.ok ? null : formatValidationFailure(subject, result.issues);
}
