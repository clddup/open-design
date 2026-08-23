import type { ModelProfile, ModelProviderProfile } from "@/shared/desktop-api";

export type ProviderDraft = Omit<
  ModelProviderProfile,
  "hasApiKey" | "updatedAt"
>;

export function profileDraft(profile: ModelProviderProfile): ProviderDraft {
  return {
    providerId: profile.providerId,
    name: profile.name,
    enabled: profile.enabled,
    apiFormat: profile.apiFormat,
    authMode: profile.authMode,
    baseUrl: profile.baseUrl,
    models: profile.models.map((model) => ({
      ...model,
      capabilities: { ...model.capabilities },
      reasoningEfforts: [...model.reasoningEfforts],
    })),
  };
}

export function newProviderDraft(): ProviderDraft {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return {
    providerId: `provider-${suffix}`,
    name: "Custom provider",
    enabled: true,
    apiFormat: "openai-chat-completions",
    authMode: "bearer",
    baseUrl: "https://api.openai.com/v1",
    models: [newModelProfile()],
  };
}

export function newModelProfile(): ModelProfile {
  return {
    modelId: "",
    name: "",
    contextWindow: 200_000,
    maxOutputTokens: 16_384,
    capabilities: {
      toolUse: true,
      imageInput: false,
      reasoning: true,
    },
    reasoningEfforts: ["off", "low", "medium", "high", "xhigh"],
  };
}

export function validProviderDraft(draft: ProviderDraft): boolean {
  if (!draft.name.trim() || !draft.baseUrl.trim() || draft.models.length === 0)
    return false;
  const modelIds = draft.models.map((model) => model.modelId.trim());
  return (
    modelIds.every(Boolean) &&
    new Set(modelIds).size === modelIds.length &&
    draft.models.every(
      (model) =>
        Number.isInteger(model.contextWindow) &&
        model.contextWindow >= 1_024 &&
        Number.isInteger(model.maxOutputTokens) &&
        model.maxOutputTokens >= 1,
    )
  );
}

export function selectionForModel(
  provider: ModelProviderProfile,
  model: ModelProfile,
) {
  const preferred = model.reasoningEfforts.includes("medium")
    ? "medium"
    : model.reasoningEfforts[0];
  return {
    providerId: provider.providerId,
    modelId: model.modelId,
    ...(preferred === undefined ? {} : { reasoningEffort: preferred }),
  };
}
