import { TooltipProvider } from "@opendesign/ui";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  SaveGlobalImageGenerationSettingsRequest,
  ModelProviderCatalog,
  SaveModelProviderProfileRequest,
} from "@/shared/desktop-api";
import { I18nProvider } from "../../i18n";
import { SettingsPage } from "./SettingsView";

const emptyCatalog: ModelProviderCatalog = { version: 3, providers: [] };
const configuredCatalog: ModelProviderCatalog = {
  version: 3,
  providers: [
    {
      providerId: "provider-saved",
      name: "Saved provider",
      enabled: true,
      apiFormat: "openai-responses",
      authMode: "bearer",
      baseUrl: "https://provider.example/v1",
      models: [
        {
          modelId: "saved-model",
          name: "Saved model",
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
          reasoningEfforts: ["off", "low", "medium", "high"],
          capabilities: {
            toolUse: true,
            imageInput: true,
            reasoning: true,
          },
        },
      ],
      hasApiKey: true,
      updatedAt: "2026-08-09T00:00:00.000Z",
    },
  ],
  defaultSelection: {
    providerId: "provider-saved",
    modelId: "saved-model",
    reasoningEffort: "medium",
  },
};

beforeEach(() => {
  window.desktop = {
    getLocale: vi.fn().mockResolvedValue("en"),
    setLocale: vi.fn().mockImplementation((locale) => Promise.resolve(locale)),
    onLocaleChange: vi.fn().mockReturnValue(() => undefined),
    getModelProviderCatalog: vi.fn().mockResolvedValue(emptyCatalog),
    getGlobalImageGenerationSettings: vi.fn().mockResolvedValue({
      version: 1,
      enabled: false,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
      modelId: "",
      hasApiKey: false,
      updatedAt: null,
    }),
    saveGlobalImageGenerationSettings: vi
      .fn()
      .mockImplementation((request: SaveGlobalImageGenerationSettingsRequest) =>
        Promise.resolve({
          version: 1,
          enabled: request.enabled,
          apiFormat: request.apiFormat,
          authMode: request.authMode,
          baseUrl: request.baseUrl,
          modelId: request.modelId,
          hasApiKey: Boolean(request.apiKey),
          updatedAt: "2026-08-10T00:00:00.000Z",
        }),
      ),
    onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    saveModelProviderProfile: vi
      .fn()
      .mockImplementation((request: SaveModelProviderProfileRequest) =>
        Promise.resolve({
          version: 3,
          providers: [
            {
              providerId: request.providerId,
              name: request.name,
              enabled: request.enabled,
              apiFormat: request.apiFormat,
              authMode: request.authMode,
              baseUrl: request.baseUrl,
              models: request.models,
              hasApiKey: Boolean(request.apiKey),
              updatedAt: "2026-08-09T00:00:00.000Z",
            },
          ],
          defaultSelection: {
            providerId: request.providerId,
            modelId: request.models[0].modelId,
            reasoningEffort: "medium",
          },
        } satisfies ModelProviderCatalog),
      ),
    deleteModelProviderProfile: vi.fn().mockResolvedValue(emptyCatalog),
    testModelProviderConnection: vi.fn().mockResolvedValue({
      status: "compatible",
      ok: true,
      message: "Provider supports Agent tool calling",
      providerId: "provider-test",
      modelId: "design-model",
      latencyMs: 42,
      textLatencyMs: 10,
      toolLatencyMs: 32,
    }),
  } as unknown as DesktopApi;
});

function renderSettings() {
  const onClose = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <SettingsPage
          onClose={onClose}
          onThemeChange={vi.fn()}
          platform="darwin"
          theme="dark"
        />
      </I18nProvider>
    </TooltipProvider>,
  );
  return { onClose };
}

async function openNewProvider(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Models" }));
  await screen.findByRole("heading", { name: "Model provider" });
  await user.click(screen.getAllByRole("button", { name: "Add provider" })[0]);
}

describe("SettingsPage", () => {
  it("keeps global image generation out of conversation Provider settings", async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("tab", { name: "Models" }));
    const modelsPanel = screen.getByRole("tabpanel", { name: "Models" });
    expect(
      within(modelsPanel).queryByLabelText("Image service API"),
    ).toBeNull();
    expect(
      within(modelsPanel).queryByRole("checkbox", {
        name: "Use globally for image generation",
      }),
    ).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Image service" }));
    await user.click(await screen.findByRole("checkbox", { name: "Enabled" }));
    await user.type(screen.getByLabelText("Image model ID"), "gpt-image-2");
    await user.type(
      screen.getByLabelText("Image service API key"),
      "image-secret",
    );
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      window.desktop!.saveGlobalImageGenerationSettings,
    ).toHaveBeenCalledWith({
      enabled: true,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-image-2",
      apiKey: "image-secret",
    });
    expect(window.desktop!.saveModelProviderProfile).not.toHaveBeenCalled();
    expect(
      await screen.findByText("Global image service settings saved"),
    ).toBeVisible();
  });

  it("disables the independent global image-generation profile", async () => {
    vi.mocked(
      window.desktop!.getGlobalImageGenerationSettings,
    ).mockResolvedValue({
      version: 1,
      enabled: true,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
      hasApiKey: true,
      updatedAt: "2026-08-10T00:00:00.000Z",
    });
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("tab", { name: "Image service" }));
    const checkbox = await screen.findByRole("checkbox", { name: "Enabled" });
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    expect(
      window.desktop!.saveGlobalImageGenerationSettings,
    ).toHaveBeenCalledWith({
      enabled: false,
      apiFormat: "openai-images",
      authMode: "bearer",
      baseUrl: "https://images.example/v1",
      modelId: "gpt-image-2",
    });
  });

  it("shows a restart message instead of crashing with an older preload", async () => {
    window.desktop = {
      ...window.desktop,
      getModelProviderCatalog: undefined,
    } as unknown as DesktopApi;
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("tab", { name: "Models" }));

    expect(
      screen.getByText(
        "Model settings were updated. Restart OpenDesign to finish loading them.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Model provider" }),
    ).toBeVisible();
  });

  it("switches locale immediately and keeps settings keyboard reachable", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSettings();

    await user.click(screen.getByRole("button", { name: "简体中文" }));

    expect(window.desktop!.setLocale).toHaveBeenCalledWith("zh-CN");
    expect(
      await screen.findByRole("heading", { name: "语言与外观" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭设置" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("saves a provider profile with protocol, models and a Main-only key", async () => {
    const user = userEvent.setup();
    renderSettings();
    await openNewProvider(user);

    await user.clear(screen.getByLabelText("Provider name"));
    await user.type(screen.getByLabelText("Provider name"), "Design gateway");
    await user.selectOptions(
      screen.getByLabelText("API format"),
      "anthropic-messages",
    );
    await user.type(screen.getByLabelText("Model ID 1"), "design-model");
    await user.type(screen.getByLabelText("Display name 1"), "Design Model");
    await user.type(screen.getByLabelText("API key"), "provider-secret");
    await user.click(screen.getByRole("button", { name: "Save & test" }));

    expect(window.desktop!.saveModelProviderProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Design gateway",
        apiFormat: "anthropic-messages",
        authMode: "x-api-key",
        apiKey: "provider-secret",
        models: [expect.objectContaining({ modelId: "design-model" })],
      }),
    );
    expect(window.desktop!.testModelProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        modelId: "design-model",
        reasoningEffort: "medium",
      }),
    );
    expect(
      await screen.findByText(
        "Agent compatible: Design gateway/design-model (42 ms)",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByText("provider-secret")).toBeNull();
  });

  it("defaults a custom OpenAI-compatible provider to Chat Completions", async () => {
    const user = userEvent.setup();
    renderSettings();
    await openNewProvider(user);

    expect(screen.getByLabelText("API format")).toHaveValue(
      "openai-chat-completions",
    );
  });

  it("cancels a new Provider with Back or Escape and restores the saved Provider", async () => {
    vi.mocked(window.desktop!.getModelProviderCatalog).mockResolvedValue(
      configuredCatalog,
    );
    const user = userEvent.setup();
    renderSettings();

    await user.click(screen.getByRole("tab", { name: "Models" }));
    await screen.findByDisplayValue("Saved provider");
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    expect(screen.getByText("New provider")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Back to providers" }),
    ).toBeVisible();
    expect(screen.getByText("Unsaved")).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Back to providers" }));
    expect(screen.getByLabelText("Provider name")).toHaveValue(
      "Saved provider",
    );

    await user.click(screen.getByRole("button", { name: "Add provider" }));

    await user.type(screen.getByLabelText("Provider name"), " draft");
    await user.keyboard("{Escape}");

    expect(screen.getByLabelText("Provider name")).toHaveValue(
      "Saved provider",
    );
    expect(screen.queryByText("New provider")).toBeNull();
    expect(screen.queryByText("Unsaved")).toBeNull();

    await user.type(screen.getByLabelText("API key"), "replacement-key");
    expect(screen.getByText("Unsaved")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByText("Unsaved")).toBeNull();
    expect(window.desktop!.saveModelProviderProfile).not.toHaveBeenCalled();
  });

  it("does not report text-only endpoints as Agent compatible", async () => {
    vi.mocked(window.desktop!.testModelProviderConnection).mockResolvedValue({
      status: "text-only",
      ok: false,
      message: "required parameterized tool call was not produced",
      providerId: "provider-test",
      modelId: "design-model",
      latencyMs: 42,
      textLatencyMs: 10,
      toolLatencyMs: 32,
    });
    const user = userEvent.setup();
    renderSettings();
    await openNewProvider(user);
    await user.type(screen.getByLabelText("Model ID 1"), "design-model");
    await user.click(screen.getByRole("button", { name: "Save & test" }));

    expect(
      await screen.findByText(
        "Text works; Agent tools are incompatible: required parameterized tool call was not produced",
      ),
    ).toBeVisible();
  });

  it("preserves an unsaved provider/model draft when the locale changes", async () => {
    const user = userEvent.setup();
    renderSettings();
    await openNewProvider(user);
    await user.type(screen.getByLabelText("Model ID 1"), "draft-model");

    await user.click(screen.getByRole("tab", { name: "General" }));
    await user.click(screen.getByRole("button", { name: "简体中文" }));
    await user.click(screen.getByRole("tab", { name: "模型" }));

    expect(screen.getByRole("textbox", { name: "模型 ID 1" })).toHaveValue(
      "draft-model",
    );
    expect(window.desktop!.getModelProviderCatalog).toHaveBeenCalledOnce();
  });
});
