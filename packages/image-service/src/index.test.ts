import { describe, expect, it } from "vitest";
import { resolveImagePlacement } from "./index.js";

describe("image placement geometry", () => {
  it("preserves direct stretch and fit modes", () => {
    expect(
      resolveImagePlacement({
        placement: { mode: "stretch" },
        sourceSize: { width: 100, height: 80 },
        targetSize: { width: 400, height: 200 },
      }),
    ).toEqual({ mode: "stretch" });
    expect(
      resolveImagePlacement({
        placement: { mode: "fit" },
        sourceSize: { width: 100, height: 80 },
        targetSize: { width: 400, height: 200 },
      }),
    ).toEqual({ mode: "fit" });
  });

  it("resolves centered fill as a clipping transform", () => {
    expect(
      resolveImagePlacement({
        placement: { mode: "fill", focalPoint: { x: 0.5, y: 0.5 } },
        sourceSize: { width: 400, height: 200 },
        targetSize: { width: 100, height: 100 },
      }),
    ).toEqual({
      mode: "clip",
      scale: { x: 0.5, y: 0.5 },
      rotation: 0,
      effectiveFocalPoint: { x: 0.5, y: 0.5 },
      offset: { x: -50, y: 0 },
    });
  });

  it("clamps focal placement so a crop cannot expose empty pixels", () => {
    const resolved = resolveImagePlacement({
      placement: {
        mode: "crop",
        focalPoint: { x: 0, y: 1 },
        zoom: 1,
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
      },
      sourceSize: { width: 400, height: 200 },
      targetSize: { width: 100, height: 100 },
    });
    expect(resolved).toMatchObject({
      mode: "clip",
      effectiveFocalPoint: { x: 0.25, y: 0.5 },
      offset: { x: 0, y: 0 },
    });
  });

  it("covers rotated crops and preserves flips in the resolved scale", () => {
    const resolved = resolveImagePlacement({
      placement: {
        mode: "crop",
        focalPoint: { x: 0.5, y: 0.5 },
        zoom: 1.25,
        rotation: 90,
        flipHorizontal: true,
        flipVertical: false,
      },
      sourceSize: { width: 200, height: 100 },
      targetSize: { width: 300, height: 200 },
    });
    expect(resolved.mode).toBe("clip");
    if (resolved.mode !== "clip") throw new Error("Expected clip placement");
    expect(resolved.rotation).toBe(90);
    expect(resolved.scale.x).toBeCloseTo(-3.75);
    expect(resolved.scale.y).toBeCloseTo(3.75);
    expect(resolved.effectiveFocalPoint).toEqual({ x: 0.5, y: 0.5 });
  });

  it("rejects zero-sized source or target geometry", () => {
    expect(() =>
      resolveImagePlacement({
        placement: { mode: "fit" },
        sourceSize: { width: 0, height: 80 },
        targetSize: { width: 400, height: 200 },
      }),
    ).toThrow("sourceSize must have positive finite dimensions");
  });
});
