import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  DirectResizeSnapController,
  resizeAxes,
} from "./direct-resize-snap-controller.js";

describe("DirectResizeSnapController", () => {
  it("maps all eight Leafer handles to only their active edges", () => {
    expect(
      Array.from({ length: 8 }, (_, direction) => resizeAxes(direction)),
    ).toEqual([
      { horizontal: "start", vertical: "start" },
      { horizontal: null, vertical: "start" },
      { horizontal: "end", vertical: "start" },
      { horizontal: "end", vertical: null },
      { horizontal: "end", vertical: "end" },
      { horizontal: null, vertical: "end" },
      { horizontal: "start", vertical: "end" },
      { horizontal: "start", vertical: null },
    ]);
  });

  it("corrects an active edge before Leafer applies the resize", () => {
    const onLines = vi.fn();
    const controller = new DirectResizeSnapController({ onLines });
    controller.begin(
      resizeInput([{ axis: "X", offset: 120 }], {
        geometry: false,
        objects: false,
        pixelGrid: false,
      }),
    );

    const first = controller.resolve({
      aroundCenter: false,
      bounds: { x: 20, y: 30, width: 100, height: 50 },
      direction: 3,
      lockRatio: false,
      origin: { x: 20, y: 55 },
      scaleX: 0.97,
      scaleY: 1,
    });
    const repeated = controller.resolve({
      aroundCenter: false,
      bounds: { x: 20, y: 30, width: 100, height: 50 },
      direction: 3,
      lockRatio: false,
      origin: { x: 20, y: 55 },
      scaleX: 0.97,
      scaleY: 1,
    });

    expect(first.scaleX).toBeCloseTo(1);
    expect(first.scaleY).toBe(1);
    expect(repeated).toEqual(first);
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ axis: "x", position: 120 }),
    ]);
  });

  it("keeps center resize and ratio lock coupled", () => {
    const controller = new DirectResizeSnapController({ onLines: vi.fn() });
    controller.begin(
      resizeInput([{ axis: "X", offset: 20 }], {
        geometry: false,
        objects: false,
        pixelGrid: false,
      }),
    );

    const centered = controller.resolve({
      aroundCenter: true,
      bounds: { x: 20, y: 30, width: 100, height: 50 },
      direction: 7,
      lockRatio: true,
      origin: { x: 70, y: 55 },
      scaleX: 0.94,
      scaleY: 0.94,
    });

    expect(centered.scaleX).toBeCloseTo(1);
    expect(centered.scaleY).toBeCloseTo(1);
  });

  it("suppresses object and guide targets while retaining pixel snapping", () => {
    const controller = new DirectResizeSnapController({ onLines: vi.fn() });
    controller.begin(
      resizeInput([{ axis: "X", offset: 120 }], {
        geometry: false,
        objects: false,
        pixelGrid: true,
      }),
    );
    controller.setSuppressed(true);

    const result = controller.resolve({
      aroundCenter: false,
      bounds: { x: 20, y: 30, width: 100, height: 50 },
      direction: 3,
      lockRatio: false,
      origin: { x: 20, y: 55 },
      scaleX: 0.974,
      scaleY: 1,
    });

    expect(result.scaleX).toBeCloseTo(0.97);
    expect(result.scaleY).toBe(1);
  });

  it("fails open for flips, invalid values, and unsupported directions", () => {
    const controller = new DirectResizeSnapController({ onLines: vi.fn() });
    controller.begin(
      resizeInput([{ axis: "X", offset: 120 }], {
        geometry: false,
        objects: false,
        pixelGrid: false,
      }),
    );
    const common = {
      aroundCenter: false,
      bounds: { x: 20, y: 30, width: 100, height: 50 },
      lockRatio: false,
      origin: { x: 20, y: 55 },
      scaleY: 1,
    };

    expect(
      controller.resolve({ ...common, direction: 3, scaleX: -0.5 }),
    ).toEqual({ scaleX: -0.5, scaleY: 1 });
    expect(
      controller.resolve({ ...common, direction: 8, scaleX: 0.97 }),
    ).toEqual({ scaleX: 0.97, scaleY: 1 });
    expect(
      controller.resolve({ ...common, direction: 3, scaleX: Number.NaN }),
    ).toEqual({ scaleX: Number.NaN, scaleY: 1 });
  });
});

function resizeInput(
  guides: Array<{ axis: "X" | "Y"; offset: number }>,
  settings: { geometry: boolean; objects: boolean; pixelGrid: boolean },
) {
  const document = structuredClone(createWelcomeDocument());
  document.pagesById.page_welcome!.guides = guides;
  return {
    document,
    excludedNodeIds: new Set(["title_welcome"]),
    nodeIds: ["title_welcome"],
    pageId: "page_welcome",
    rulerGuidesVisible: true,
    settings,
    viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
  };
}
