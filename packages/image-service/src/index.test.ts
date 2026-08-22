import { describe, expect, it } from "vitest";
import {
  applyImageFiltersToRgba,
  createImageCropSession,
  imageFiltersAreNeutral,
  imageCropSourceTransform,
  moveImageCrop,
  normalizeImageFilters,
  resetImageCrop,
  resolveImagePlacement,
  setImageCropZoom,
} from "./index.js";

describe("image adjustments", () => {
  it("normalizes sparse Figma-compatible fields and clamps their range", () => {
    expect(
      normalizeImageFilters({ exposure: 2, contrast: 0, tint: -2 }),
    ).toEqual({ exposure: 1, tint: -1 });
    expect(normalizeImageFilters({ shadows: 0 })).toBeUndefined();
    expect(imageFiltersAreNeutral(undefined)).toBe(true);
    expect(imageFiltersAreNeutral({ saturation: 0.25 })).toBe(false);
    expect(() => normalizeImageFilters({ exposure: Number.NaN })).toThrow(
      "finite",
    );
  });

  it("keeps alpha stable and turns full negative saturation into grayscale", () => {
    const pixels = new Uint8ClampedArray([230, 80, 20, 77]);
    applyImageFiltersToRgba(pixels, { saturation: -1 });
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[3]).toBe(77);
  });

  it("applies exposure, temperature, tint, highlights, and shadows deterministically", () => {
    const original = new Uint8ClampedArray([
      32, 48, 64, 255, 192, 176, 160, 128,
    ]);
    const first = new Uint8ClampedArray(original);
    const second = new Uint8ClampedArray(original);
    const filters = {
      exposure: 0.2,
      contrast: 0.1,
      temperature: 0.35,
      tint: -0.2,
      highlights: -0.25,
      shadows: 0.4,
    };
    applyImageFiltersToRgba(first, filters);
    applyImageFiltersToRgba(second, filters);
    expect(first).toEqual(second);
    expect(first).not.toEqual(original);
    expect(first[3]).toBe(255);
    expect(first[7]).toBe(128);
  });

  it("rejects malformed RGBA buffers", () => {
    expect(() =>
      applyImageFiltersToRgba(new Uint8ClampedArray([1, 2, 3]), {
        contrast: 0.5,
      }),
    ).toThrow("divisible by four");
  });
});

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

describe("image crop interaction session", () => {
  it("enters crop from Fill without changing its resolved geometry", () => {
    const sourceSize = { width: 1_600, height: 900 };
    const targetSize = { width: 400, height: 400 };
    const fill = {
      mode: "fill" as const,
      focalPoint: { x: 0.35, y: 0.6 },
    };
    const session = createImageCropSession({
      placement: fill,
      sourceSize,
      targetSize,
    });
    const resolvedFill = resolveImagePlacement({
      placement: fill,
      sourceSize,
      targetSize,
    });
    expect(session.current).toMatchObject({
      mode: "crop",
      focalPoint:
        resolvedFill.mode === "clip"
          ? resolvedFill.effectiveFocalPoint
          : fill.focalPoint,
      zoom: 1,
      rotation: 0,
    });
    expect(
      resolveImagePlacement({
        placement: session.current,
        sourceSize,
        targetSize,
      }),
    ).toEqual(resolvedFill);
  });

  it("repositions the source in target-local coordinates and clamps empty pixels", () => {
    const session = createImageCropSession({
      placement: {
        mode: "crop",
        focalPoint: { x: 0.5, y: 0.5 },
        zoom: 1.5,
        rotation: 0,
        flipHorizontal: false,
        flipVertical: false,
      },
      sourceSize: { width: 800, height: 600 },
      targetSize: { width: 400, height: 300 },
    });
    const before = imageCropSourceTransform(session);
    const moved = moveImageCrop(session, { x: 30, y: -20 });
    const after = imageCropSourceTransform(moved);
    expect(after[4] - before[4]).toBeCloseTo(30);
    expect(after[5] - before[5]).toBeCloseTo(-20);

    const clamped = moveImageCrop(moved, { x: 100_000, y: -100_000 });
    expect(clamped.current.focalPoint.x).toBeGreaterThanOrEqual(0);
    expect(clamped.current.focalPoint.x).toBeLessThanOrEqual(1);
    expect(clamped.current.focalPoint.y).toBeGreaterThanOrEqual(0);
    expect(clamped.current.focalPoint.y).toBeLessThanOrEqual(1);
  });

  it("zooms around the focal point, supports reset, and preserves finite rotated flips", () => {
    const session = createImageCropSession({
      placement: {
        mode: "crop",
        focalPoint: { x: 0.25, y: 0.7 },
        zoom: 2,
        rotation: 35,
        flipHorizontal: true,
        flipVertical: false,
      },
      sourceSize: { width: 1_200, height: 800 },
      targetSize: { width: 480, height: 320 },
    });
    const zoomed = setImageCropZoom(session, 80);
    expect(zoomed.current.zoom).toBe(64);
    expect(imageCropSourceTransform(zoomed).every(Number.isFinite)).toBe(true);
    expect(setImageCropZoom(session, 0).current.zoom).toBe(1);
    expect(resetImageCrop(session).current).toEqual({
      mode: "crop",
      focalPoint: { x: 0.5, y: 0.5 },
      zoom: 1,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
    });
  });

  it("rejects non-finite interaction input", () => {
    const session = createImageCropSession({
      placement: { mode: "fit" },
      sourceSize: { width: 100, height: 100 },
      targetSize: { width: 50, height: 50 },
    });
    expect(() => moveImageCrop(session, { x: Number.NaN, y: 0 })).toThrow(
      "finite",
    );
    expect(() => setImageCropZoom(session, Number.POSITIVE_INFINITY)).toThrow(
      "finite",
    );
  });
});
