import { describe, expect, it } from "vitest";
import {
  GlobalImageGenerationSettingsContract,
  isGlobalImageGenerationSettings,
  isModelProviderCatalog,
  isProviderConnectionResult,
  isSaveGlobalImageGenerationSettingsRequest,
  isSaveModelProviderProfileRequest,
  ModelProviderCatalogContract,
  normalizeProviderBaseUrl,
  ProviderConnectionResultContract,
  SaveModelProviderProfileRequestContract,
} from "./provider-config-contract";

const now = "2026-08-26T00:00:00.000Z";
const model = {
  modelId: "design-model",
  name: "Design model",
  contextWindow: 200_000,
  maxOutputTokens: 16_384,
  capabilities: {
    toolUse: true,
    imageInput: true,
    reasoning: true,
  },
  reasoningEfforts: ["off", "medium", "high"],
} as const;
const profile = {
  providerId: "provider_1",
  name: "Primary",
  enabled: true,
  apiFormat: "openai-responses",
  authMode: "bearer",
  baseUrl: "https://api.openai.com/v1",
  models: [model],
} as const;

describe("Provider configuration contract", () => {
  it("accepts one sanitized current catalog and rejects legacy or secret-bearing shapes", () => {
    const catalog = {
      version: 3,
      providers: [{ ...profile, hasApiKey: true, updatedAt: now }],
      defaultSelection: {
        providerId: "provider_1",
        modelId: "design-model",
        reasoningEffort: "medium",
      },
    };
    expect(isModelProviderCatalog(catalog)).toBe(true);
    expect(isModelProviderCatalog({ ...catalog, version: 1 })).toBe(false);
    expect(isModelProviderCatalog({ ...catalog, version: 2 })).toBe(false);
    expect(
      isModelProviderCatalog({
        ...catalog,
        providers: [{ ...catalog.providers[0], apiKey: "secret" }],
      }),
    ).toBe(false);
  });

  it("reports catalog relationship failures with stable paths", () => {
    expect(
      ModelProviderCatalogContract.issues({
        version: 3,
        providers: [
          { ...profile, hasApiKey: false, updatedAt: now },
          { ...profile, hasApiKey: false, updatedAt: now },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.provider_id_duplicate",
        path: "/providers",
      }),
    );
    expect(
      ModelProviderCatalogContract.issues({
        version: 3,
        providers: [
          {
            ...profile,
            models: [model, model],
            hasApiKey: false,
            updatedAt: now,
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.model_id_duplicate",
        path: "/providers/0/models",
      }),
    );
    expect(
      ModelProviderCatalogContract.issues({
        version: 3,
        providers: [
          { ...profile, enabled: false, hasApiKey: false, updatedAt: now },
        ],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.default_selection_unavailable",
        path: "/defaultSelection",
      }),
    );
    expect(
      ModelProviderCatalogContract.issues({
        version: 3,
        providers: [{ ...profile, hasApiKey: false, updatedAt: now }],
        defaultSelection: {
          providerId: "provider_1",
          modelId: "design-model",
          reasoningEffort: "low",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.default_reasoning_effort_unsupported",
        path: "/defaultSelection/reasoningEffort",
      }),
    );
  });

  it("validates protocol profiles, local URLs and credential actions", () => {
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        apiKey: "secret",
      }),
    ).toBe(true);
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        providerId: "local-grok",
        apiFormat: "openai-chat-completions",
        baseUrl: "http://127.0.0.1:8362/",
        models: [{ ...model, modelId: "grok-4.5", name: "Grok 4.5" }],
      }),
    ).toBe(true);
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        providerId: "glm-proxy",
        apiFormat: "openai-chat-completions",
        baseUrl: "https://nxtoken.cn",
        models: [{ ...model, modelId: "glm-5.2", name: "GLM 5.2" }],
      }),
    ).toBe(true);
    expect(
      isSaveModelProviderProfileRequest({
        ...profile,
        apiFormat: "anthropic-messages",
        authMode: "x-api-key",
        baseUrl: "http://localhost:11434/v1",
      }),
    ).toBe(true);
    expect(
      SaveModelProviderProfileRequestContract.issues({
        ...profile,
        baseUrl: "https://secret@models.example/v1",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.base_url_invalid",
        path: "/baseUrl",
      }),
    );
    expect(
      SaveModelProviderProfileRequestContract.issues({
        ...profile,
        apiKey: "secret",
        clearApiKey: true,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.credential_action_conflict",
        path: "/clearApiKey",
      }),
    );
  });

  it("keeps reasoning capability consistent with supported efforts", () => {
    expect(
      SaveModelProviderProfileRequestContract.issues({
        ...profile,
        models: [
          {
            ...model,
            capabilities: { ...model.capabilities, reasoning: false },
          },
        ],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.reasoning_capability_mismatch",
        path: "/models/0/reasoningEfforts",
      }),
    );
  });

  it("normalizes only the trailing Provider URL separator", () => {
    expect(normalizeProviderBaseUrl("https://models.example/v1///")).toBe(
      "https://models.example/v1",
    );
    expect(normalizeProviderBaseUrl("http://127.0.0.1:8362/")).toBe(
      "http://127.0.0.1:8362",
    );
  });
});

describe("Global image-generation configuration contract", () => {
  const settings = {
    version: 1,
    enabled: true,
    apiFormat: "openai-images",
    authMode: "bearer",
    baseUrl: "https://images.example/v1",
    modelId: "gpt-image-2",
    hasApiKey: true,
    updatedAt: now,
  } as const;

  it("accepts sanitized settings and rejects credentials or invalid timestamps", () => {
    expect(isGlobalImageGenerationSettings(settings)).toBe(true);
    expect(
      isGlobalImageGenerationSettings({ ...settings, apiKey: "secret" }),
    ).toBe(false);
    expect(
      GlobalImageGenerationSettingsContract.issues({
        ...settings,
        updatedAt: "not-a-timestamp",
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.timestamp_invalid",
        path: "/updatedAt",
      }),
    );
  });

  it("allows an empty disabled model and requires one when enabled", () => {
    expect(
      isSaveGlobalImageGenerationSettingsRequest({
        enabled: false,
        apiFormat: "openai-images",
        authMode: "bearer",
        baseUrl: "https://images.example/v1",
        modelId: "",
      }),
    ).toBe(true);
    expect(
      isSaveGlobalImageGenerationSettingsRequest({
        enabled: true,
        apiFormat: "openai-images",
        authMode: "bearer",
        baseUrl: "https://images.example/v1",
        modelId: "",
      }),
    ).toBe(false);
  });
});

describe("Provider connection result contract", () => {
  it("requires compatible status to agree with ok", () => {
    const result = {
      status: "text-only",
      ok: false,
      message: "Parameterized tool call was not produced",
      providerId: "provider_1",
      modelId: "design-model",
      latencyMs: 42,
      textLatencyMs: 10,
      toolLatencyMs: 32,
    } as const;
    expect(isProviderConnectionResult(result)).toBe(true);
    expect(
      ProviderConnectionResultContract.issues({ ...result, ok: true }),
    ).toContainEqual(
      expect.objectContaining({
        code: "provider_config.connection_status_mismatch",
        path: "/ok",
      }),
    );
  });
});
