import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DesktopApi,
  ModelProviderCatalog,
  SaveModelProviderProfileRequest,
} from "../../shared/desktop-api";
import { I18nProvider } from "../i18n";
import { SettingsPage } from "./SettingsPage";

const emptyCatalog: ModelProviderCatalog = { version: 1, providers: [] };

beforeEach(() => {
  window.desktop = {
    getLocale: vi.fn().mockResolvedValue("en"),
    setLocale: vi.fn().mockImplementation((locale) => Promise.resolve(locale)),
    onLocaleChange: vi.fn().mockReturnValue(() => undefined),
    getModelProviderCatalog: vi.fn().mockResolvedValue(emptyCatalog),
    onModelProviderCatalogChange: vi.fn().mockReturnValue(() => undefined),
    saveModelProviderProfile: vi
      .fn()
      .mockImplementation((request: SaveModelProviderProfileRequest) =>
        Promise.resolve({
          version: 1,
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
      ok: true,
      message: "Provider connection succeeded",
      providerId: "provider-test",
      modelId: "design-model",
      latencyMs: 42,
    }),
  } as unknown as DesktopApi;
});

function renderSettings() {
  const onClose = vi.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <SettingsPage onClose={onClose} onThemeChange={vi.fn()} theme="dark" />
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
        "Connected to Design gateway/design-model in 42 ms",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.queryByText("provider-secret")).toBeNull();
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
