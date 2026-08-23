import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import { Statusbar } from "./Statusbar";

function renderStatusbar(
  overrides: Partial<Parameters<typeof Statusbar>[0]> = {},
) {
  const props: Parameters<typeof Statusbar>[0] = {
    dirty: false,
    error: null,
    onFitPage: vi.fn(),
    onFitSelection: vi.fn(),
    onZoomChange: vi.fn(),
    revision: 4,
    selection: { count: 0 },
    zoom: 1,
    ...overrides,
  };
  render(
    <I18nProvider initialLocale="en">
      <Statusbar {...props} />
    </I18nProvider>,
  );
  return props;
}

describe("Statusbar", () => {
  it("shows persistence, revision, and zoom state", () => {
    renderStatusbar();

    expect(screen.getByRole("status")).toHaveTextContent("All changes saved");
    expect(screen.getByText("Revision 4")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reset zoom" }),
    ).toHaveTextContent("100%");
    expect(
      screen.queryByRole("button", { name: "Fit selection (Shift+2)" }),
    ).toBeNull();
  });

  it("summarizes a selected layer and exposes fit-selection", () => {
    renderStatusbar({
      selection: { count: 1, node: { kind: "text", name: "Headline" } },
    });

    expect(screen.getByText("Headline · text")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fit selection (Shift+2)" }),
    ).toBeEnabled();
  });

  it("surfaces errors and delegates viewport commands", async () => {
    const user = userEvent.setup();
    const props = renderStatusbar({
      error: "Canvas projection failed",
      zoom: 2,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Canvas projection failed",
    );
    await user.click(
      screen.getByRole("button", { name: "Fit page (Shift+1)" }),
    );
    await user.click(screen.getByRole("button", { name: "Zoom out" }));
    await user.click(screen.getByRole("button", { name: "Reset zoom" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));

    expect(props.onFitPage).toHaveBeenCalledOnce();
    expect(props.onZoomChange).toHaveBeenNthCalledWith(1, 1.8);
    expect(props.onZoomChange).toHaveBeenNthCalledWith(2, 1);
    expect(props.onZoomChange).toHaveBeenNthCalledWith(3, 2.2);
  });
});
