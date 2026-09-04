import {
  isDeleteModelProviderProfileRequest,
  isGlobalImageGenerationSettings,
  isModelProviderCatalog,
  isProviderConnectionResult,
  isSaveGlobalImageGenerationSettingsRequest,
  isSaveModelProviderProfileRequest,
  isSaveVisualCriticSelectionRequest,
  isTestModelProviderConnectionRequest,
  type DeleteModelProviderProfileRequest,
  type GlobalImageGenerationSettings,
  type ModelProviderCatalog,
  type ProviderConnectionResult,
  type SaveGlobalImageGenerationSettingsRequest,
  type SaveModelProviderProfileRequest,
  type SaveVisualCriticSelectionRequest,
  type TestModelProviderConnectionRequest,
} from "@/shared/provider-config-contract";
import { channels, type DesktopApi } from "@/shared/desktop-api";
import { validate } from "./value-parser";

type ProviderApi = Pick<
  DesktopApi,
  | "getModelProviderCatalog"
  | "getGlobalImageGenerationSettings"
  | "saveGlobalImageGenerationSettings"
  | "saveModelProviderProfile"
  | "saveVisualCriticSelection"
  | "deleteModelProviderProfile"
  | "testModelProviderConnection"
  | "onModelProviderCatalogChange"
>;

type Subscribe = (
  channel: string,
  listener: (value: unknown) => void,
) => () => void;

export function createProviderApi(
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
  subscribe: Subscribe,
): ProviderApi {
  return {
    getModelProviderCatalog: async () =>
      validate<ModelProviderCatalog>(
        await invoke(channels.getModelProviderCatalog),
        isModelProviderCatalog,
        "Invalid model provider catalog response",
      ),
    getGlobalImageGenerationSettings: async () =>
      validate<GlobalImageGenerationSettings>(
        await invoke(channels.getGlobalImageGenerationSettings),
        isGlobalImageGenerationSettings,
        "Invalid global image-generation settings response",
      ),
    saveGlobalImageGenerationSettings: async (
      request: SaveGlobalImageGenerationSettingsRequest,
    ) => {
      validate(
        request,
        isSaveGlobalImageGenerationSettingsRequest,
        "Invalid global image-generation settings request",
      );
      return validate<GlobalImageGenerationSettings>(
        await invoke(channels.saveGlobalImageGenerationSettings, request),
        isGlobalImageGenerationSettings,
        "Invalid global image-generation settings response",
      );
    },
    saveModelProviderProfile: async (
      request: SaveModelProviderProfileRequest,
    ) => {
      validate(
        request,
        isSaveModelProviderProfileRequest,
        "Invalid model provider profile request",
      );
      return validate<ModelProviderCatalog>(
        await invoke(channels.saveModelProviderProfile, request),
        isModelProviderCatalog,
        "Invalid model provider catalog response",
      );
    },
    saveVisualCriticSelection: async (
      request: SaveVisualCriticSelectionRequest,
    ) => {
      validate(
        request,
        isSaveVisualCriticSelectionRequest,
        "Invalid visual critic model selection request",
      );
      return validate<ModelProviderCatalog>(
        await invoke(channels.saveVisualCriticSelection, request),
        isModelProviderCatalog,
        "Invalid model provider catalog response",
      );
    },
    deleteModelProviderProfile: async (
      request: DeleteModelProviderProfileRequest,
    ) => {
      validate(
        request,
        isDeleteModelProviderProfileRequest,
        "Invalid model provider delete request",
      );
      return validate<ModelProviderCatalog>(
        await invoke(channels.deleteModelProviderProfile, request),
        isModelProviderCatalog,
        "Invalid model provider catalog response",
      );
    },
    testModelProviderConnection: async (
      request: TestModelProviderConnectionRequest,
    ) => {
      validate(
        request,
        isTestModelProviderConnectionRequest,
        "Invalid model provider test request",
      );
      return validate<ProviderConnectionResult>(
        await invoke(channels.testModelProviderConnection, request),
        isProviderConnectionResult,
        "Invalid model provider connection response",
      );
    },
    onModelProviderCatalogChange: (listener) =>
      subscribe(channels.modelProviderCatalogChanged, (value) => {
        if (isModelProviderCatalog(value)) listener(value);
      }),
  };
}
