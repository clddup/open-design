import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { LeftSidebar } from "./LeftSidebar";

describe("LeftSidebar layer tree", () => {
  it("presents Boolean groups as named, collapsible vector containers", async () => {
    const user = userEvent.setup();
    const document = structuredClone(createWelcomeDocument());
    const parent = document.nodesById.feature_group;
    const first = document.nodesById.feature_one;
    const second = document.nodesById.feature_two;
    if (
      !parent ||
      parent.kind !== "group" ||
      !first ||
      !second ||
      first.kind !== "rectangle" ||
      second.kind !== "rectangle"
    ) {
      throw new Error("Missing Boolean tree fixtures");
    }
    document.nodesById.boolean_cards = {
      id: "boolean_cards",
      kind: "boolean",
      name: "Boolean cards",
      parentId: parent.id,
      childIds: [first.id, second.id],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 640, height: 220 },
      opacity: 1,
      properties: {
        operation: "union",
        fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    first.parentId = "boolean_cards";
    second.parentId = "boolean_cards";
    parent.childIds = ["boolean_cards", "feature_three"];

    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={document}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onReparent={vi.fn(() => ({ ok: true }) as const)}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );

    const booleanLayer = screen.getByRole("button", {
      name: "Boolean cards",
    });
    expect(
      booleanLayer.querySelector('[data-glyph="boolean"]'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: first.name }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Collapse Boolean cards" }),
    );
    expect(
      screen.queryByRole("button", { name: first.name }),
    ).not.toBeInTheDocument();
  });

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
          onReparent={vi.fn(() => ({ ok: true }) as const)}
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
    expect(screen.getByRole("button", { name: child.name })).toHaveAttribute(
      "draggable",
      "false",
    );

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
          onReparent={vi.fn(() => ({ ok: true }) as const)}
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
    expect(screen.getByRole("button", { name: child.name })).toHaveAttribute(
      "draggable",
      "true",
    );
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
          onReparent={vi.fn(() => ({ ok: true }) as const)}
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

  it("moves a same-parent selected block with explicit before feedback", () => {
    const document = createWelcomeDocument();
    const onReparent = vi.fn(() => ({ ok: true }) as const);
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={document}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onReparent={onReparent}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={["title_welcome", "subtitle_welcome"]}
          tab="layers"
        />
      </I18nProvider>,
    );
    const source = screen.getByRole("button", { name: "Title" });
    const target = screen
      .getByRole("button", { name: "Capabilities" })
      .closest(".layer-row");
    if (!target) throw new Error("Missing target layer row");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
    };

    fireEvent.dragStart(source, { dataTransfer });
    expect(screen.getByRole("status")).toHaveTextContent("Moving 2 layers");
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, "clientY", { value: 101 });
    fireEvent(target, dragOver);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Place before Capabilities",
    );
    expect(screen.getByText("Before")).toBeInTheDocument();
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 101 });
    fireEvent(target, drop);

    expect(onReparent).toHaveBeenCalledWith({
      nodeIds: ["title_welcome", "subtitle_welcome"],
      parentId: "frame_welcome",
      index: 1,
      position: "before",
      targetNodeId: "feature_group",
    });
    expect(screen.getByRole("status")).toHaveTextContent("Moved 2 layers");
    expect(screen.queryByText("Before")).not.toBeInTheDocument();
  });

  it("ignores external drag payloads and reports rejected inside moves", () => {
    const document = createWelcomeDocument();
    const onReparent = vi.fn(
      () => ({ ok: false, error: "Rejected by hierarchy planner" }) as const,
    );
    render(
      <I18nProvider initialLocale="en">
        <LeftSidebar
          activePageId="page_welcome"
          document={document}
          onDelete={vi.fn()}
          onPageChange={vi.fn()}
          onReparent={onReparent}
          onSelect={vi.fn()}
          onTabChange={vi.fn()}
          onToggleLock={vi.fn()}
          onToggleVisibility={vi.fn()}
          selectedNodeIds={[]}
          tab="layers"
        />
      </I18nProvider>,
    );
    const source = screen.getByRole("button", { name: "Title" });
    const target = screen
      .getByRole("button", { name: "Capabilities" })
      .closest(".layer-row");
    if (!target) throw new Error("Missing target layer row");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 128,
      left: 0,
      right: 220,
      width: 220,
      height: 28,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
      getData: vi.fn(() => "feature_one"),
    };

    const externalDrop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(externalDrop, "clientY", { value: 114 });
    fireEvent(target, externalDrop);
    expect(onReparent).not.toHaveBeenCalled();

    fireEvent.dragStart(source, { dataTransfer });
    const dragOver = createEvent.dragOver(target, { dataTransfer });
    Object.defineProperty(dragOver, "clientY", { value: 114 });
    fireEvent(target, dragOver);
    expect(screen.getByText("Inside")).toBeInTheDocument();
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, "clientY", { value: 114 });
    fireEvent(target, drop);

    expect(onReparent).toHaveBeenCalledWith({
      nodeIds: ["title_welcome"],
      parentId: "feature_group",
      index: 3,
      position: "inside",
      targetNodeId: "feature_group",
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Rejected by hierarchy planner",
    );
  });
});
