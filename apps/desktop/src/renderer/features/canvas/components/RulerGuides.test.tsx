import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { SelectionState } from "@opendesign/design-contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { RulerGuideEdit } from "../ruler-guides";
import { RulerGuides } from "./RulerGuides";

const viewport = {
  panX: 0,
  panY: 0,
  zoom: 1,
  width: 800,
  height: 600,
};

describe("RulerGuides interaction", () => {
  it("creates a Page guide from the ruler and commits only on pointer up", () => {
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    const { container } = renderGuides(onEdit);
    const horizontalRuler = container.querySelector('[data-ruler-axis="Y"]');
    if (!horizontalRuler) throw new Error("Missing horizontal ruler");

    fireEvent.pointerDown(horizontalRuler, {
      button: 0,
      clientX: 160,
      clientY: 8,
    });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 180 });
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.pointerUp(window, { clientX: 160, clientY: 180 });

    expect(onEdit).toHaveBeenCalledWith({
      duplicate: false,
      expectedRevision: 0,
      target: {
        guide: { axis: "Y", offset: 180 },
        owner: { type: "page", pageId: "page_welcome" },
      },
    });
  });

  it("cancels an interrupted drag without committing", () => {
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    const { container } = renderGuides(onEdit);
    const horizontalRuler = container.querySelector('[data-ruler-axis="Y"]');
    if (!horizontalRuler) throw new Error("Missing horizontal ruler");

    fireEvent.pointerDown(horizontalRuler, {
      button: 0,
      clientX: 160,
      clientY: 8,
    });
    fireEvent.pointerMove(window, { clientX: 160, clientY: 180 });
    expect(screen.getByText("180")).toBeInTheDocument();
    fireEvent.pointerCancel(window);

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByText("180")).not.toBeInTheDocument();
  });

  it("copies an existing guide with Alt and keeps its original source", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome.guides = [{ axis: "X", offset: 100 }];
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    renderGuides(onEdit, document);
    const guide = screen.getByRole("button", { name: "X guide at 100" });

    fireEvent.pointerDown(guide, { button: 0, clientX: 100, clientY: 120 });
    fireEvent.pointerUp(window, { altKey: true, clientX: 140, clientY: 120 });

    expect(onEdit).toHaveBeenCalledWith({
      duplicate: true,
      expectedRevision: 0,
      source: {
        guide: { axis: "X", offset: 100 },
        index: 0,
        owner: { type: "page", pageId: "page_welcome" },
      },
      target: {
        guide: { axis: "X", offset: 140 },
        owner: { type: "page", pageId: "page_welcome" },
      },
    });
  });

  it("shows disposable guide-to-Frame redlines only during an Alt drag", () => {
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    const { container } = renderGuides(onEdit, createWelcomeDocument(), {
      nodeIds: ["frame_welcome"],
      anchorNodeId: "frame_welcome",
    });
    const verticalRuler = container.querySelector('[data-ruler-axis="X"]');
    if (!verticalRuler) throw new Error("Missing vertical ruler");

    fireEvent.pointerDown(verticalRuler, {
      altKey: true,
      button: 0,
      clientX: 8,
      clientY: 200,
    });
    fireEvent.pointerMove(window, {
      altKey: true,
      clientX: 40,
      clientY: 200,
    });
    expect(container.querySelectorAll("[data-ruler-measurement]")).toHaveLength(
      1,
    );

    fireEvent.keyUp(window, { key: "Alt" });
    expect(container.querySelectorAll("[data-ruler-measurement]")).toHaveLength(
      0,
    );

    fireEvent.pointerUp(window, { clientX: 40, clientY: 200 });
    expect(container.querySelectorAll("[data-ruler-measurement]")).toHaveLength(
      0,
    );
  });

  it("deletes the selected guide from the canvas keyboard focus", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome.guides = [{ axis: "X", offset: 100 }];
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    renderGuides(onEdit, document);
    const guide = screen.getByRole("button", { name: "X guide at 100" });

    fireEvent.pointerDown(guide, { button: 0, clientX: 100, clientY: 120 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 120 });
    fireEvent.keyDown(window, { key: "Delete" });

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledWith({
      duplicate: false,
      expectedRevision: 0,
      source: {
        guide: { axis: "X", offset: 100 },
        index: 0,
        owner: { type: "page", pageId: "page_welcome" },
      },
    });
  });

  it("offers the Figma-style Remove guide context action", async () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome.guides = [{ axis: "X", offset: 100 }];
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    renderGuides(onEdit, document);

    fireEvent.contextMenu(
      screen.getByRole("button", { name: "X guide at 100" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "Remove guide" }),
    );

    expect(onEdit).toHaveBeenCalledOnce();
    expect(onEdit.mock.calls[0]?.[0]).toMatchObject({
      duplicate: false,
      source: { guide: { axis: "X", offset: 100 }, index: 0 },
    });
  });

  it("exposes locked Frame guides as read-only", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    frame.locked = true;
    frame.properties.guides = [{ axis: "Y", offset: 40 }];
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    renderGuides(onEdit, document);
    const guide = screen.getByRole("button", { name: "Y guide at 40" });

    expect(guide).toHaveAttribute("aria-disabled", "true");
    expect(guide).toHaveAttribute("tabindex", "-1");
    fireEvent.pointerDown(guide, { button: 0, clientX: 120, clientY: 40 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 80 });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("preserves the drag-start revision so the host can reject stale edits", () => {
    const document = structuredClone(createWelcomeDocument());
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => false);
    const { container, rerender } = renderGuides(onEdit, document);
    const horizontalRuler = container.querySelector('[data-ruler-axis="Y"]');
    if (!horizontalRuler) throw new Error("Missing horizontal ruler");

    fireEvent.pointerDown(horizontalRuler, {
      button: 0,
      clientX: 160,
      clientY: 8,
    });
    rerender(rulerGuides(onEdit, { ...document, revision: 1 }));
    fireEvent.pointerUp(window, { clientX: 160, clientY: 180 });

    expect(onEdit.mock.calls[0]?.[0].expectedRevision).toBe(0);
  });

  it("does not reinterpret a selected guide index after the revision changes", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome.guides = [
      { axis: "Y", offset: 100 },
      { axis: "Y", offset: 200 },
      { axis: "Y", offset: 300 },
    ];
    const onEdit = vi.fn<(edit: RulerGuideEdit) => boolean>(() => true);
    const { rerender } = renderGuides(onEdit, document);
    const selected = screen.getByRole("button", { name: "Y guide at 200" });

    fireEvent.pointerDown(selected, { button: 0, clientX: 120, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 120, clientY: 200 });
    const next = structuredClone(document);
    next.revision = 1;
    next.pagesById.page_welcome.guides = [
      { axis: "Y", offset: 200 },
      { axis: "Y", offset: 300 },
    ];
    rerender(rulerGuides(onEdit, next));
    fireEvent.keyDown(window, { key: "Delete" });

    expect(onEdit).not.toHaveBeenCalled();
  });
});

function renderGuides(
  onEdit: (edit: RulerGuideEdit) => boolean,
  document = createWelcomeDocument(),
  selection: SelectionState = { nodeIds: [] },
) {
  return render(rulerGuides(onEdit, document, selection));
}

function rulerGuides(
  onEdit: (edit: RulerGuideEdit) => boolean,
  document = createWelcomeDocument(),
  selection: SelectionState = { nodeIds: [] },
) {
  return (
    <RulerGuides
      document={document}
      onEdit={onEdit}
      onFocusCanvas={vi.fn()}
      pageId="page_welcome"
      selection={selection}
      viewport={viewport}
    />
  );
}
