import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { HomeTitlebar } from "./HomeTitlebar";

function titlebar(platform: NodeJS.Platform) {
  return (
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <HomeTitlebar
          actions={<button type="button">Context action</button>}
          icon="lucide:sparkles"
          identity={<strong>OpenDesign workspace</strong>}
          platform={platform}
        />
      </I18nProvider>
    </TooltipProvider>
  );
}

describe("HomeTitlebar", () => {
  it("keeps identity and contextual actions while adapting native controls", () => {
    const { rerender } = render(titlebar("darwin"));

    expect(screen.getByRole("banner")).toHaveAttribute(
      "data-platform",
      "darwin",
    );
    expect(screen.getByText("OpenDesign workspace")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Context action" }),
    ).toBeVisible();
    expect(screen.queryByRole("group", { name: "Window controls" })).toBeNull();

    rerender(titlebar("win32"));

    expect(screen.getByRole("banner")).toHaveAttribute(
      "data-platform",
      "win32",
    );
    expect(
      screen.getByRole("group", { name: "Window controls" }),
    ).toBeVisible();
  });
});
