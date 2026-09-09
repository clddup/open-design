import type { DesktopApi } from "@/shared/desktop-api";
import { TooltipProvider } from "@opendesign/ui";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { WindowControls } from "./WindowControls";

const previousDesktop = window.desktop;
afterEach(() => {
  window.desktop = previousDesktop;
});

describe("WindowControls", () => {
  it("follows native maximize/restore events without applying a stale initial result", async () => {
    let changed: ((value: boolean) => void) | undefined;
    let resolveInitial!: (value: boolean) => void;
    const unsubscribe = vi.fn();
    const windowAction = vi
      .fn<DesktopApi["windowAction"]>()
      .mockResolvedValue(undefined);
    window.desktop = {
      onWindowMaximized: (listener: (value: boolean) => void) => {
        changed = listener;
        return unsubscribe;
      },
      getWindowMaximized: () =>
        new Promise<boolean>((resolve) => {
          resolveInitial = resolve;
        }),
      windowAction,
      getLocale: () => Promise.resolve("en"),
      onLocaleChange: () => () => undefined,
    } as unknown as DesktopApi;
    const { unmount } = render(
      <TooltipProvider>
        <I18nProvider initialLocale="en">
          <WindowControls />
        </I18nProvider>
      </TooltipProvider>,
    );
    act(() => changed?.(true));
    await act(() => {
      resolveInitial(false);
      return Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", { name: "Restore window" }));
    expect(windowAction).toHaveBeenCalledWith("toggle-maximize");
    act(() => changed?.(false));
    expect(
      screen.getByRole("button", { name: "Maximize window" }),
    ).toBeVisible();
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
