import { IconButton, TooltipProvider } from "@opendesign/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "../../../../shared/desktop-api";
import { I18nProvider } from "../../../i18n";
import { Titlebar } from "./Titlebar";

afterEach(() => {
  window.desktop = undefined;
});

function renderTitlebar() {
  const onOpen = vi.fn();
  const onImportSvg = vi.fn();
  const onSave = vi.fn();
  const onSaveAs = vi.fn();
  const onExportSvg = vi.fn();
  const onThemeChange = vi.fn();
  const onToggleLeftPanel = vi.fn();
  const onToggleUtilityPanel = vi.fn();

  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <Titlebar
          canExportSvg
          dirty={false}
          documentName="Welcome.opendesign"
          leftPanelVisible
          onExportSvg={onExportSvg}
          onImportSvg={onImportSvg}
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
          onSettings={vi.fn()}
          onThemeChange={onThemeChange}
          onToggleLeftPanel={onToggleLeftPanel}
          onToggleUtilityPanel={onToggleUtilityPanel}
          onWorkspace={vi.fn()}
          platform="darwin"
          svgBusy={false}
          theme="light"
          utilityPanelVisible
        />
      </I18nProvider>
    </TooltipProvider>,
  );

  return {
    onExportSvg,
    onImportSvg,
    onOpen,
    onSave,
    onSaveAs,
    onThemeChange,
    onToggleLeftPanel,
    onToggleUtilityPanel,
  };
}

describe("Titlebar behavior primitives", () => {
  it("toggles navigator and utility panels without taking canvas focus", async () => {
    const user = userEvent.setup();
    const { onToggleLeftPanel, onToggleUtilityPanel } = renderTitlebar();
    const navigator = screen.getByRole("button", {
      name: "Toggle navigator panel",
    });
    const utility = screen.getByRole("button", {
      name: "Toggle Agent and properties panel",
    });
    expect(navigator).toHaveAttribute("aria-pressed", "true");
    expect(navigator).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Shift+1 Meta+Shift+1",
    );
    expect(utility).toHaveAttribute("aria-pressed", "true");
    expect(utility).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+Shift+2 Meta+Shift+2",
    );
    await user.click(navigator);
    await user.click(utility);
    expect(onToggleLeftPanel).toHaveBeenCalledOnce();
    expect(onToggleUtilityPanel).toHaveBeenCalledOnce();
  });

  it("only reserves the native traffic-light area on macOS", () => {
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Titlebar
            canExportSvg={false}
            dirty={false}
            documentName="Welcome.opendesign"
            onExportSvg={vi.fn()}
            onImportSvg={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="win32"
            svgBusy={false}
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    expect(screen.getByRole("banner")).toHaveAttribute(
      "data-platform",
      "win32",
    );
    expect(
      screen.getByRole("group", { name: "Window controls" }),
    ).toBeVisible();

    rerender(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Titlebar
            canExportSvg={false}
            dirty={false}
            documentName="Welcome.opendesign"
            onExportSvg={vi.fn()}
            onImportSvg={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="darwin"
            svgBusy={false}
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    expect(screen.getByRole("banner")).toHaveAttribute(
      "data-platform",
      "darwin",
    );
    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  });

  it("routes all Windows titlebar controls through the typed desktop bridge", async () => {
    const user = userEvent.setup();
    const windowAction = vi.fn().mockResolvedValue(undefined);
    window.desktop = {
      getLocale: vi.fn().mockResolvedValue("en"),
      onLocaleChange: vi.fn().mockReturnValue(() => undefined),
      setLocale: vi.fn().mockResolvedValue("en"),
      windowAction,
    } as unknown as DesktopApi;

    render(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Titlebar
            canExportSvg={false}
            dirty={false}
            documentName="Welcome.opendesign"
            onExportSvg={vi.fn()}
            onImportSvg={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="win32"
            svgBusy={false}
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Minimize window" }));
    await user.click(screen.getByRole("button", { name: "Maximize window" }));
    await user.click(screen.getByRole("button", { name: "Close window" }));

    expect(windowAction.mock.calls).toEqual([
      ["minimize"],
      ["toggle-maximize"],
      ["close"],
    ]);
  });

  it("keeps the menu open when its parent rerenders during the pointer gesture", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [, rerender] = useState(0);
      return (
        <div onPointerDown={() => rerender((value) => value + 1)}>
          <Titlebar
            canExportSvg={false}
            dirty={false}
            documentName="Welcome.opendesign"
            onExportSvg={vi.fn()}
            onImportSvg={vi.fn()}
            onOpen={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="darwin"
            svgBusy={false}
            theme="light"
          />
        </div>
      );
    }

    render(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Harness />
        </I18nProvider>
      </TooltipProvider>,
    );
    await user.click(screen.getByRole("button", { name: "File actions" }));

    expect(screen.getByRole("menuitem", { name: "Open…" })).toBeVisible();
  });

  it("navigates file actions by keyboard and restores trigger focus", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderTitlebar();
    const trigger = screen.getByRole("button", { name: "File actions" });

    trigger.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Open…" })).toHaveFocus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(trigger).toHaveFocus();

    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("menuitem", { name: "Open…" }));

    expect(onOpen).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("offers editable SVG import and current-format selection export in the file menu", async () => {
    const user = userEvent.setup();
    const { onExportSvg, onImportSvg } = renderTitlebar();

    await user.click(screen.getByRole("button", { name: "File actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Import SVG…" }));
    expect(onImportSvg).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "File actions" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Export selection…" }),
    );
    expect(onExportSvg).toHaveBeenCalledOnce();
  });

  it("disables import and export commands while an operation is active or no layer is selected", async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Titlebar
            canExportSvg={false}
            dirty={false}
            documentName="Welcome.opendesign"
            onExportSvg={vi.fn()}
            onImportSvg={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="win32"
            svgBusy
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    await user.click(screen.getByRole("button", { name: "File actions" }));
    expect(
      screen.getByRole("menuitem", { name: "Import SVG…" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Export selection…" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("shows accessible tooltip content for icon-only controls", async () => {
    const user = userEvent.setup();
    renderTitlebar();
    const themeButton = screen.getByRole("button", {
      name: "Use dark theme",
    });

    await user.hover(themeButton);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Use dark theme",
    );

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("keeps disabled icon controls labelled and hover-describable", async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <IconButton disabled icon="lucide:undo-2" label="Undo unavailable" />
      </TooltipProvider>,
    );

    const button = screen.getByRole("button", { name: "Undo unavailable" });
    const tooltipTrigger = button.closest(".ui-disabled-tooltip-trigger");

    expect(button).toBeDisabled();
    expect(tooltipTrigger).not.toBeNull();
    await user.hover(tooltipTrigger!);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Undo unavailable",
    );
  });
});
