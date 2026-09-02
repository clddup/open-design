import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasSnapSettings } from "./use-canvas-snap-settings";

describe("useCanvasSnapSettings", () => {
  beforeEach(() => localStorage.clear());

  it("defaults all Figma-compatible snap settings to enabled", () => {
    const { result, unmount } = renderHook(() => useCanvasSnapSettings());

    expect(result.current.settings).toEqual({
      geometry: true,
      objects: true,
      pixelGrid: true,
    });
    unmount();
  });

  it("persists toggles across mounts without writing design data", () => {
    const first = renderHook(() => useCanvasSnapSettings());
    act(() => {
      first.result.current.toggleGeometry();
      first.result.current.toggleObjects();
      first.result.current.togglePixelGrid();
    });
    expect(first.result.current.settings).toEqual({
      geometry: false,
      objects: false,
      pixelGrid: false,
    });
    first.unmount();

    const second = renderHook(() => useCanvasSnapSettings());
    expect(second.result.current.settings).toEqual({
      geometry: false,
      objects: false,
      pixelGrid: false,
    });
    second.unmount();
  });
});
