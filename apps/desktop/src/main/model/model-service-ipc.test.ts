import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import {
  channels,
  type GlobalImageGenerationSettings,
  type ModelProviderCatalog,
  type ProviderConnectionResult,
  type SaveGlobalImageGenerationSettingsRequest,
  type SaveModelProviderProfileRequest,
} from "@/shared/desktop-api.js";
import {
  registerModelServiceIpc,
  type ModelServiceIpcRegistrar,
} from "./model-service-ipc.js";

type Handler = Parameters<ModelServiceIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;
const catalog: ModelProviderCatalog = { version: 3, providers: [] };
const imageSettings: GlobalImageGenerationSettings = {
  version: 1,
  enabled: true,
  apiFormat: "openai-images",
  authMode: "bearer",
  baseUrl: "https://images.example/v1",
  modelId: "image-model",
  hasApiKey: true,
  updatedAt: "2026-08-23T00:00:00.000Z",
};
const saveImageSettings: SaveGlobalImageGenerationSettingsRequest = {
  enabled: true,
  apiFormat: "openai-images",
  authMode: "bearer",
  baseUrl: "https://images.example/v1",
  modelId: "image-model",
  apiKey: "image-secret",
};
const saveProvider: SaveModelProviderProfileRequest = {
  providerId: "provider-local",
  name: "Local provider",
  enabled: true,
  apiFormat: "openai-responses",
  authMode: "bearer",
  baseUrl: "http://127.0.0.1:8362/v1",
  models: [
    {
      modelId: "design-model",
      name: "Design model",
      contextWindow: 200_000,
      maxOutputTokens: 16_384,
      capabilities: { imageInput: true, reasoning: true, toolUse: true },
      reasoningEfforts: ["off", "low", "medium", "high"],
    },
  ],
  apiKey: "provider-secret",
  setAsDefault: true,
};
const connectionResult: ProviderConnectionResult = {
  status: "compatible",
  ok: true,
  message: "Provider supports Agent tool calling",
  providerId: "provider-local",
  modelId: "design-model",
  latencyMs: 42,
  textLatencyMs: 10,
  toolLatencyMs: 32,
};

describe("registerModelServiceIpc", () => {
  it("registers and forwards the complete Provider and image-settings family", async () => {
    const fixture = setup();

    expect(invoke(fixture, channels.getModelProviderCatalog)).toEqual(catalog);
    expect(invoke(fixture, channels.getGlobalImageGenerationSettings)).toEqual(
      imageSettings,
    );
    expect(
      invoke(
        fixture,
        channels.saveGlobalImageGenerationSettings,
        saveImageSettings,
      ),
    ).toEqual(imageSettings);
    expect(
      invoke(fixture, channels.saveModelProviderProfile, saveProvider),
    ).toEqual(catalog);
    expect(
      invoke(fixture, channels.saveVisualCriticSelection, {
        selection: {
          providerId: "provider-local",
          modelId: "design-model",
        },
      }),
    ).toEqual(catalog);
    expect(
      invoke(fixture, channels.deleteModelProviderProfile, {
        providerId: "provider-local",
      }),
    ).toEqual(catalog);
    await expect(
      invoke(fixture, channels.testModelProviderConnection, {
        providerId: "provider-local",
        modelId: "design-model",
        reasoningEffort: "medium",
      }),
    ).resolves.toEqual(connectionResult);

    expect(fixture.imageHost.saveSettings).toHaveBeenCalledWith(
      saveImageSettings,
    );
    expect(fixture.modelHost.saveProfile).toHaveBeenCalledWith(saveProvider);
    expect(fixture.modelHost.saveVisualCriticSelection).toHaveBeenCalledWith({
      selection: {
        providerId: "provider-local",
        modelId: "design-model",
      },
    });
    expect(fixture.modelHost.deleteProfile).toHaveBeenCalledWith({
      providerId: "provider-local",
    });
    expect(fixture.publishModelProviderCatalog).toHaveBeenCalledTimes(3);
    expect(fixture.handlers.size).toBe(7);
    expect(fixture.assertRenderer).toHaveBeenCalledTimes(7);
  });

  it("validates sender identity before arguments, payloads and host resolution", () => {
    const fixture = setup({
      assertRenderer: vi.fn(() => {
        throw new Error("Request from unknown renderer");
      }),
    });

    expect(() =>
      invoke(fixture, channels.saveModelProviderProfile, { invalid: true }),
    ).toThrow("Request from unknown renderer");
    expect(fixture.getModelProviderHost).not.toHaveBeenCalled();
    expect(fixture.modelHost.saveProfile).not.toHaveBeenCalled();
  });

  it("rejects malformed requests and unexpected arguments without side effects", () => {
    const fixture = setup();

    expect(() => invoke(fixture, channels.getModelProviderCatalog, {})).toThrow(
      "Unexpected IPC arguments",
    );
    expect(() =>
      invoke(fixture, channels.saveGlobalImageGenerationSettings, {
        enabled: true,
      }),
    ).toThrow("Invalid global image-generation settings request input");
    expect(() =>
      invoke(fixture, channels.saveModelProviderProfile, { providerId: "bad" }),
    ).toThrow("Invalid model Provider save request input");
    expect(() =>
      invoke(fixture, channels.saveModelProviderProfile, {
        ...saveProvider,
        baseUrl: "https://secret@models.example/v1",
      }),
    ).toThrow("provider_config.base_url_invalid at /baseUrl");
    expect(() =>
      invoke(fixture, channels.deleteModelProviderProfile, {
        providerId: "bad id",
      }),
    ).toThrow("Invalid model Provider delete request input");
    expect(() =>
      invoke(fixture, channels.testModelProviderConnection, {
        providerId: "provider-local",
      }),
    ).toThrow("Invalid model Provider connection test request input");
    expect(fixture.publishModelProviderCatalog).not.toHaveBeenCalled();
    expect(fixture.modelHost.saveProfile).not.toHaveBeenCalled();
    expect(fixture.imageHost.saveSettings).not.toHaveBeenCalled();
  });

  it("resolves current hosts on every request and publishes only successful mutations", () => {
    const fixture = setup();
    invoke(fixture, channels.getModelProviderCatalog);
    invoke(fixture, channels.getModelProviderCatalog);
    expect(fixture.getModelProviderHost).toHaveBeenCalledTimes(2);

    fixture.modelHost.saveProfile.mockImplementationOnce(() => {
      throw new Error("Secure credential storage is unavailable");
    });
    expect(() =>
      invoke(fixture, channels.saveModelProviderProfile, saveProvider),
    ).toThrow("Secure credential storage is unavailable");
    expect(fixture.publishModelProviderCatalog).not.toHaveBeenCalled();
  });
});

function invoke(
  fixture: ReturnType<typeof setup>,
  channel: string,
  ...args: unknown[]
): unknown {
  const handler = fixture.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler(event, ...args);
}

function setup(
  overrides: {
    assertRenderer?: (event: IpcMainInvokeEvent) => void;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  const imageHost = {
    getSettings: vi.fn(() => imageSettings),
    saveSettings: vi.fn(() => imageSettings),
  };
  const modelHost = {
    deleteProfile: vi.fn(() => catalog),
    getCatalog: vi.fn(() => catalog),
    saveProfile: vi.fn(() => catalog),
    saveVisualCriticSelection: vi.fn(() => catalog),
    testConnection: vi.fn(() => Promise.resolve(connectionResult)),
  };
  const getImageGenerationHost = vi.fn(() => imageHost);
  const getModelProviderHost = vi.fn(() => modelHost);
  const publishModelProviderCatalog = vi.fn();
  const assertRenderer = overrides.assertRenderer ?? vi.fn();
  registerModelServiceIpc({
    assertRenderer,
    getImageGenerationHost,
    getModelProviderHost,
    ipc: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    publishModelProviderCatalog,
  });
  return {
    assertRenderer,
    getImageGenerationHost,
    getModelProviderHost,
    handlers,
    imageHost,
    modelHost,
    publishModelProviderCatalog,
  };
}
