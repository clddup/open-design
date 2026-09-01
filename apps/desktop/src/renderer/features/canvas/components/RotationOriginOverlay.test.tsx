import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { RelativePoint } from "@opendesign/design-contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  RotationOriginOverlay,
  rotationOriginFromScreenPoint,
  rotationOriginScreenPoint,
} from "./RotationOriginOverlay";

describe("rotation origin overlay geometry", () => {
  it("round-trips a nested rotated layer through zoom and pan", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const node = document.nodesById.title_welcome;
    frame.transform = [0, 1, -1, 0, 900, 120];
    node.transform = [1, 0.2, -0.1, 1, 80, 50];
    const viewport = {
      panX: -120,
      panY: 64,
      zoom: 1.75,
      width: 1_280,
      height: 900,
    };
    const origin = { x: 0.2, y: 0.8 };
    const point = rotationOriginScreenPoint(document, node, origin, viewport);
    expect(point).not.toBeNull();
    const roundTrip = rotationOriginFromScreenPoint(
      document,
      node,
      point!,
      viewport,
    );
    expect(roundTrip?.x).toBeCloseTo(origin.x, 12);
    expect(roundTrip?.y).toBeCloseTo(origin.y, 12);
  });

  it("preserves an origin outside the layer bounds", () => {
    const document = createWelcomeDocument();
    const node = document.nodesById.title_welcome;
    const viewport = {
      panX: 0,
      panY: 0,
      zoom: 1,
      width: 1_280,
      height: 900,
    };
    const origin = { x: -0.25, y: 1.5 };
    const point = rotationOriginScreenPoint(document, node, origin, viewport);
    const roundTrip = rotationOriginFromScreenPoint(
      document,
      node,
      point!,
      viewport,
    );
    expect(roundTrip?.x).toBeCloseTo(origin.x, 12);
    expect(roundTrip?.y).toBeCloseTo(origin.y, 12);
  });

  it("commits one origin update after a drag and none during pointer movement", () => {
    const document = createWelcomeDocument();
    const node = document.nodesById.title_welcome;
    const onCommit = vi.fn<(origin: RelativePoint | null) => void>();
    render(
      <RotationOriginOverlay
        document={document}
        label="Edit rotation origin"
        node={node}
        onCommit={onCommit}
        viewport={{
          panX: 0,
          panY: 0,
          zoom: 1,
          width: 1_280,
          height: 900,
        }}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "Edit rotation origin",
    });
    Object.assign(handle, {
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    fireEvent.pointerDown(handle, { clientX: 180, clientY: 120, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 220, clientY: 140, pointerId: 1 });
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 260, clientY: 160, pointerId: 1 });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]?.[0];
    expect(committed).not.toBeNull();
    expect(committed?.x).toBeTypeOf("number");
    expect(committed?.y).toBeTypeOf("number");
  });
});
