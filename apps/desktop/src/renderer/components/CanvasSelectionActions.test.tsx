import { TooltipProvider } from "@opendesign/ui";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { CanvasSelectionActions } from "./CanvasSelectionActions";

function renderActions(
  options: {
    count?: number;
    canBringForward?: boolean;
    hierarchyAction?: "group" | "ungroup";
  } = {},
) {
  const callbacks = {
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onGroup: vi.fn(),
    onOpenProperties: vi.fn(),
    onReorder: vi.fn(),
    onUngroup: vi.fn(),
  };
  render(
    <TooltipProvider delayDuration={0}>
      <I18nProvider initialLocale="en">
        <CanvasSelectionActions
          canDelete
          canDuplicate
          canHierarchyAction
          canReorder={{
            "bring-forward": options.canBringForward ?? true,
            "bring-to-front": true,
            "send-backward": true,
            "send-to-back": true,
          }}
          count={options.count ?? 1}
          hierarchyAction={options.hierarchyAction ?? "group"}
          name="Hero artwork"
          platform="darwin"
          {...callbacks}
        />
      </I18nProvider>
    </TooltipProvider>,
  );
  return callbacks;
}

describe("CanvasSelectionActions", () => {
  it("keeps frequent selection actions directly on the canvas", async () => {
    const user = userEvent.setup();
    const callbacks = renderActions();

    expect(
      screen.getByRole("toolbar", { name: "Canvas selection actions" }),
    ).toHaveTextContent("Hero artwork");
    await user.click(
      screen.getByRole("button", { name: "Duplicate on canvas (⌘D)" }),
    );
    await user.click(screen.getByRole("button", { name: "Group on canvas" }));
    await user.click(
      screen.getByRole("button", { name: "Move forward on canvas" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Open selection properties" }),
    );

    expect(callbacks.onDuplicate).toHaveBeenCalledOnce();
    expect(callbacks.onGroup).toHaveBeenCalledOnce();
    expect(callbacks.onReorder).toHaveBeenCalledWith("bring-forward");
    expect(callbacks.onOpenProperties).toHaveBeenCalledOnce();
  });

  it("reports multi-selection and disables unavailable operations", () => {
    renderActions({ count: 3, canBringForward: false });

    expect(screen.getByText("3 layers selected")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Move forward on canvas" }),
    ).toBeDisabled();
  });

  it("uses the current hierarchy action instead of exposing both commands", async () => {
    const user = userEvent.setup();
    const callbacks = renderActions({ hierarchyAction: "ungroup" });

    await user.click(screen.getByRole("button", { name: "Ungroup on canvas" }));
    expect(callbacks.onUngroup).toHaveBeenCalledOnce();
    expect(callbacks.onGroup).not.toHaveBeenCalled();
  });
});
