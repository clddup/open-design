import { IconButton, TooltipProvider } from "@opendesign/ui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { Titlebar } from "./Titlebar";

function renderTitlebar() {
  const onOpen = vi.fn();
  const onSave = vi.fn();
  const onSaveAs = vi.fn();
  const onThemeChange = vi.fn();

  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <Titlebar
          dirty={false}
          documentName="Welcome.opendesign"
          onOpen={onOpen}
          onSave={onSave}
          onSaveAs={onSaveAs}
          onSettings={vi.fn()}
          onThemeChange={onThemeChange}
          onWorkspace={vi.fn()}
          platform="darwin"
          theme="light"
        />
      </I18nProvider>
    </TooltipProvider>,
  );

  return { onOpen, onSave, onSaveAs, onThemeChange };
}

describe("Titlebar behavior primitives", () => {
  it("only reserves the native traffic-light area on macOS", () => {
    const { rerender } = render(
      <TooltipProvider delayDuration={0}>
        <I18nProvider initialLocale="en">
          <Titlebar
            dirty={false}
            documentName="Welcome.opendesign"
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="win32"
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    expect(document.querySelector(".titlebar")).toHaveAttribute(
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
            dirty={false}
            documentName="Welcome.opendesign"
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="darwin"
            theme="light"
          />
        </I18nProvider>
      </TooltipProvider>,
    );

    expect(document.querySelector(".titlebar")).toHaveAttribute(
      "data-platform",
      "darwin",
    );
    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();
  });

  it("keeps the menu open when its parent rerenders during the pointer gesture", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [, rerender] = useState(0);
      return (
        <div onPointerDown={() => rerender((value) => value + 1)}>
          <Titlebar
            dirty={false}
            documentName="Welcome.opendesign"
            onOpen={vi.fn()}
            onSave={vi.fn()}
            onSettings={vi.fn()}
            onThemeChange={vi.fn()}
            onWorkspace={vi.fn()}
            platform="darwin"
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
        <IconButton disabled icon="undo" label="Undo unavailable" />
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
