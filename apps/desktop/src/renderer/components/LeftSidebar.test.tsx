import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { LeftSidebar } from "./LeftSidebar";

describe("LeftSidebar layer tree", () => {
  it("distinguishes own, inherited, and unlocked layer states", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const child = document.nodesById.feature_one;
    if (!frame || !child) throw new Error("Missing layer fixtures");
    frame.locked = true;
    const onToggleLock = vi.fn();
    const view = render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={document}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={onToggleLock}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const ownLock = screen.getByRole("button", {
      name: `Unlock ${frame.name}`,
    });
    expect(ownLock).toHaveAttribute("aria-pressed", "true");
    expect(ownLock.querySelector('[data-glyph="lock"]')).toBeInTheDocument();
    await user.click(ownLock);
    expect(onToggleLock).toHaveBeenCalledWith(frame.id);

    const inheritedLock = screen.getByRole("button", {
      name: `${child.name} is locked by its parent`,
    });
    expect(inheritedLock).toBeDisabled();
    expect(inheritedLock).toHaveAttribute("aria-pressed", "true");
    expect(
      inheritedLock.querySelector('[data-glyph="lock"]'),
    ).toBeInTheDocument();

    const unlockedDocument = structuredClone(document);
    const unlockedFrame = unlockedDocument.nodesById.frame_welcome;
    if (!unlockedFrame) throw new Error("Missing frame fixture");
    unlockedFrame.locked = false;
    view.rerender(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={unlockedDocument}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={onToggleLock}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const unlocked = screen.getByRole("button", {
      name: `Lock ${child.name}`,
    });
    expect(unlocked).not.toBeDisabled();
    expect(unlocked).toHaveAttribute("aria-pressed", "false");
    expect(unlocked.querySelector('[data-glyph="unlock"]')).toBeInTheDocument();
  });

  it("collapses with the disclosure control and reveals selected descendants", async () => {
    const user = userEvent.setup();
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    const child = document.nodesById.feature_one;
    if (!frame || !child) throw new Error("Missing layer fixtures");
    const onSelect = vi.fn();
    const renderSidebar = (selectedNodeIds: readonly string[]) => (
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={document}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onSelect={onSelect}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={selectedNodeIds}
          tab="layers"
        />
      </I18nProvider>
    );
    const view = render(renderSidebar([]));

    await user.click(
      screen.getByRole("button", { name: `Collapse ${frame.name}` }),
    );
    expect(
      screen.queryByRole("button", { name: child.name }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: `Expand ${frame.name}` }),
    ).toBeInTheDocument();

    view.rerender(renderSidebar([child.id]));
    expect(
      await screen.findByRole("button", { name: child.name }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: `Collapse ${frame.name}` }),
    );
    await user.click(screen.getByRole("button", { name: frame.name }));
    expect(onSelect).toHaveBeenCalledWith(frame.id);
    expect(
      screen.getByRole("button", { name: child.name }),
    ).toBeInTheDocument();
  });
});
