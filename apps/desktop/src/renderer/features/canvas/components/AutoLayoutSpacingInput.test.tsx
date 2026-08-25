import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  AutoLayoutSpacingInput,
  type CanvasAutoLayoutSpacingInput,
} from "./AutoLayoutSpacingInput";

const request: CanvasAutoLayoutSpacingInput = {
  canvasPoint: { x: 120, y: 80 },
  clientPoint: { x: 140, y: 110 },
  expectedRevision: 7,
  frameId: "frame_1",
  kind: "padding-left",
  padding: { top: 8, right: 12, bottom: 16, left: 20 },
  paddingScope: "opposite",
  value: 20,
};

describe("Auto Layout spacing canvas input", () => {
  it("focuses the current value and commits one semantic change on Enter", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn(() => true);
    render(
      <AutoLayoutSpacingInput
        label="Left padding"
        onClose={onClose}
        onCommit={onCommit}
        request={request}
      />,
    );

    const input = screen.getByRole("spinbutton", { name: "Left padding" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "28" } });
    fireEvent.submit(input.closest("form")!);

    expect(onCommit).toHaveBeenCalledWith({
      kind: "padding",
      value: { top: 8, right: 28, bottom: 16, left: 28 },
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape without committing", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn(() => true);
    render(
      <AutoLayoutSpacingInput
        label="Left padding"
        onClose={onClose}
        onCommit={onCommit}
        request={request}
      />,
    );

    fireEvent.keyDown(screen.getByRole("spinbutton"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("keeps the input open when the exact-revision commit is rejected", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn(() => false);
    render(
      <AutoLayoutSpacingInput
        label="Left padding"
        onClose={onClose}
        onCommit={onCommit}
        request={request}
      />,
    );

    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "28" } });
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });
});
