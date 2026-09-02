import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../../i18n";
import {
  SelectionContextMenu,
  type SelectionContextMenuActions,
} from "./SelectionContextMenu";

function actions(
  overrides: Partial<SelectionContextMenuActions> = {},
): SelectionContextMenuActions {
  return {
    canDelete: true,
    canDuplicate: true,
    canFlip: true,
    canGroup: true,
    canReorder: {
      "bring-forward": true,
      "bring-to-front": true,
      "send-backward": true,
      "send-to-back": true,
    },
    canSplitVector: true,
    canUngroup: false,
    onDelete: vi.fn(),
    onDuplicate: vi.fn(),
    onFlip: vi.fn(),
    onGroup: vi.fn(),
    onReorder: vi.fn(),
    onSplitVector: vi.fn(),
    onUngroup: vi.fn(),
    platform: "darwin",
    splitVectorRelevant: true,
    ...overrides,
  };
}

function renderMenu(value: SelectionContextMenuActions, onOpen = vi.fn()) {
  render(
    <I18nProvider initialLocale="en">
      <SelectionContextMenu
        actions={value}
        onOpen={onOpen}
        trigger={<div data-testid="selection">Selection</div>}
      />
    </I18nProvider>,
  );
  fireEvent.contextMenu(screen.getByTestId("selection"));
  return onOpen;
}

describe("SelectionContextMenu", () => {
  it("opens from a native context-menu gesture and routes Flip horizontal", async () => {
    const value = actions();
    const onOpen = renderMenu(value);

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Flip horizontal" }),
    );

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(value.onFlip).toHaveBeenCalledWith("horizontal");
  });

  it("routes Split vector without adding canvas toolbar clutter", async () => {
    const value = actions();
    renderMenu(value);

    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Split vector" }),
    );

    expect(value.onSplitVector).toHaveBeenCalledTimes(1);
  });

  it("does not show Split vector for unrelated layer selections", () => {
    renderMenu(actions({ splitVectorRelevant: false }));

    expect(
      screen.queryByRole("menuitem", { name: "Split vector" }),
    ).not.toBeInTheDocument();
  });

  it("keeps unavailable mutations disabled and closes with Escape", async () => {
    renderMenu(actions({ canDelete: false, canFlip: false }));

    expect(
      await screen.findByRole("menuitem", { name: "Flip horizontal" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("menuitem", { name: "Delete selection" }),
    ).toHaveAttribute("aria-disabled", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("menuitem", { name: "Flip horizontal" }),
      ).not.toBeInTheDocument(),
    );
  });
});
