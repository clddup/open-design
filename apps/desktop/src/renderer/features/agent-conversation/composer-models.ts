import type { ModelSelection } from "@opendesign/model-gateway";
import type {
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
} from "@/shared/desktop-api";

export interface ComposerModelOption {
  label: string;
  selection: ModelSelection;
  value: string;
}

export function selectableModels(
  catalog: ModelProviderCatalog,
): ComposerModelOption[] {
  return catalog.providers.flatMap((provider) =>
    provider.enabled
      ? provider.models
          .filter((model) => model.capabilities.toolUse)
          .map((model) => ({
            value: selectionValue(provider.providerId, model.modelId),
            label: `${provider.name}/${model.name}`,
            selection: selectionForModel(provider, model),
          }))
      : [],
  );
}

export function selectionValue(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

export function resolveCatalogModel(
  catalog: ModelProviderCatalog,
  selection: ModelSelection,
): { provider: ModelProviderProfile; model: ModelProfile } | undefined {
  const provider = catalog.providers.find(
    (candidate) =>
      candidate.enabled && candidate.providerId === selection.providerId,
  );
  const model = provider?.models.find(
    (candidate) =>
      candidate.capabilities.toolUse && candidate.modelId === selection.modelId,
  );
  if (!provider || !model) return undefined;
  if (
    selection.reasoningEffort !== undefined &&
    !model.reasoningEfforts.includes(selection.reasoningEffort)
  ) {
    return undefined;
  }
  return { provider, model };
}

export function firstValidSelection(
  catalog: ModelProviderCatalog,
  preferred: ModelSelection | undefined,
): ModelSelection | null {
  if (preferred && resolveCatalogModel(catalog, preferred)) {
    return { ...preferred };
  }
  return selectableModels(catalog)[0]?.selection ?? null;
}

function selectionForModel(
  provider: ModelProviderProfile,
  model: ModelProfile,
): ModelSelection {
  const preferred = model.reasoningEfforts.includes("medium")
    ? "medium"
    : model.reasoningEfforts[0];
  return {
    providerId: provider.providerId,
    modelId: model.modelId,
    ...(preferred === undefined ? {} : { reasoningEffort: preferred }),
  };
}
