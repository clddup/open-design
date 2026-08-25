import { fireEvent, render, screen } from "@testing-library/react";
import type { GridTrack } from "@opendesign/design-contracts";
import { describe, expect, it, vi } from "vitest";
import { GridTrackInput, type CanvasGridTrackInput } from "./GridTrackInput";

const request: CanvasGridTrackInput = {
  axis: "columns",
  canvasPoint: { x: 120, y: 80 },
  clientPoint: { x: 140, y: 110 },
  expectedRevision: 7,
  frameId: "frame_1",
  index: 1,
  resolvedSize: 320,
  track: { type: "fill", value: 2 },
};

function renderInput(
  options: {
    onClose?: () => void;
    onCommit?: (track: GridTrack) => boolean;
  } = {},
) {
  return render(
    <GridTrackInput
      fixedLabel="Fixed"
      fillLabel="Fill"
      hugLabel="Hug"
      label="Column 2"
      onClose={options.onClose ?? vi.fn()}
      onCommit={options.onCommit ?? vi.fn(() => true)}
      request={request}
    />,
  );
}

describe("Grid track canvas input", () => {
  it("focuses the current Fill value and commits its fractional weight", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn(() => true);
    renderInput({ onClose, onCommit });

    const input = screen.getByRole("spinbutton", { name: "Column 2 fr" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.submit(input.closest("form")!);

    expect(onCommit).toHaveBeenCalledWith({ type: "fill", value: 3 });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("uses the resolved canvas size when switching to Fixed", () => {
    const onCommit = vi.fn(() => true);
    renderInput({ onCommit });

    fireEvent.change(screen.getByRole("combobox", { name: "Column 2" }), {
      target: { value: "fixed" },
    });
    const input = screen.getByRole("spinbutton", { name: "Column 2 px" });
    expect(input).toHaveValue(320);
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).toHaveBeenCalledWith({ type: "fixed", value: 320 });
  });

  it("commits Hug without inventing a numeric value", () => {
    const onCommit = vi.fn(() => true);
    renderInput({ onCommit });

    const select = screen.getByRole("combobox", { name: "Column 2" });
    fireEvent.change(select, { target: { value: "hug" } });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith({ type: "hug" });
  });

  it("cancels on Escape and stays open when the commit is rejected", () => {
    const onClose = vi.fn();
    const onCommit = vi.fn(() => false);
    const view = renderInput({ onClose, onCommit });

    const input = screen.getByRole("spinbutton");
    fireEvent.submit(input.closest("form")!);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    view.unmount();
  });
});
