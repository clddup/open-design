import { createHash } from "node:crypto";
import type { ModelSelection } from "@opendesign/model-gateway";
import {
  isVisualCriticSelectionAvailable,
  MODEL_PROVIDER_CATALOG_VERSION,
  type ModelProfile,
  type ModelProviderCatalog,
  type ModelProviderProfile,
} from "@/shared/desktop-api.js";

export const emptyModelProviderCatalog: ModelProviderCatalog = {
  version: MODEL_PROVIDER_CATALOG_VERSION,
  providers: [],
};

export function normalizeModelProviderCatalog(
  catalog: ModelProviderCatalog,
): ModelProviderCatalog {
  const currentDefault = validDefaultSelection(catalog);
  const fallbackDefault = catalog.providers
    .filter((provider) => provider.enabled)
    .map(defaultModelSelection)
    .find((selection) => selection !== undefined);
  const visualCriticSelection =
    catalog.visualCriticSelection &&
    isVisualCriticSelectionAvailable(catalog, catalog.visualCriticSelection)
      ? catalog.visualCriticSelection
      : undefined;
  return {
    version: MODEL_PROVIDER_CATALOG_VERSION,
    providers: catalog.providers.map((provider) => ({
      ...provider,
      models: provider.models.map(snapshotModelProfile),
    })),
    ...((currentDefault ?? fallbackDefault)
      ? { defaultSelection: { ...(currentDefault ?? fallbackDefault)! } }
      : {}),
    ...(visualCriticSelection
      ? { visualCriticSelection: { ...visualCriticSelection } }
      : {}),
  };
}

export function defaultModelSelection(
  provider: ModelProviderProfile,
): ModelSelection | undefined {
  const model = provider.models.find(
    (candidate) => candidate.capabilities.toolUse,
  );
  if (!model) return undefined;
  const preferred = model.reasoningEfforts.includes("medium")
    ? "medium"
    : model.reasoningEfforts[0];
  return {
    providerId: provider.providerId,
    modelId: model.modelId,
    ...(preferred === undefined ? {} : { reasoningEffort: preferred }),
  };
}

export function snapshotModelProfile(model: ModelProfile): ModelProfile {
  return {
    ...model,
    capabilities: { ...model.capabilities },
    reasoningEfforts: [...model.reasoningEfforts],
  };
}

export function modelProviderCredentialKey(providerId: string): string {
  const digest = createHash("sha256").update(providerId).digest("hex");
  return `model.provider.credential.${digest.slice(0, 32)}`;
}

function validDefaultSelection(
  catalog: ModelProviderCatalog,
): ModelSelection | undefined {
  const selection = catalog.defaultSelection;
  if (!selection) return undefined;
  const available = catalog.providers.some(
    (provider) =>
      provider.enabled &&
      provider.providerId === selection.providerId &&
      provider.models.some(
        (model) =>
          model.modelId === selection.modelId &&
          model.capabilities.toolUse &&
          (selection.reasoningEffort === undefined ||
            model.reasoningEfforts.includes(selection.reasoningEffort)),
      ),
  );
  return available ? selection : undefined;
}
