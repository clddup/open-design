import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCanvasInlineEditors } from "./use-canvas-inline-editors";

const selection = {
  nodeIds: ["frame_1"],
  anchorNodeId: "frame_1",
};

describe("canvas inline editor session", () => {
  it("keeps one editor inside the Canvas and closes it on stale revision", () => {
    const element = document.createElement("div");
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      bottom: 760,
      height: 760,
      left: 0,
      right: 1_000,
      top: 0,
      width: 1_000,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const hook = renderHook(
      ({ revision }) =>
        useCanvasInlineEditors({ revision, selection, tool: "select" }),
      { initialProps: { revision: 7 } },
    );

    act(() => {
      hook.result.current.openGridTrack(
        {
          axis: "columns",
          clientPoint: { x: 990, y: 750 },
          expectedRevision: 7,
          frameId: "frame_1",
          index: 0,
          resolvedSize: 200,
          track: { type: "fixed", value: 200 },
        },
        element,
      );
    });
    expect(hook.result.current.gridTrack?.canvasPoint).toEqual({
      x: 840,
      y: 720,
    });
    expect(hook.result.current.autoLayoutSpacing).toBeNull();

    act(() => {
      hook.result.current.openAutoLayoutSpacing(
        {
          clientPoint: { x: 30, y: 40 },
          expectedRevision: 7,
          frameId: "frame_1",
          kind: "gap",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          paddingScope: "single",
          value: 12,
        },
        element,
      );
    });
    expect(hook.result.current.gridTrack).toBeNull();
    expect(hook.result.current.autoLayoutSpacing?.canvasPoint).toEqual({
      x: 30,
      y: 40,
    });

    hook.rerender({ revision: 8 });
    expect(hook.result.current.autoLayoutSpacing).toBeNull();
  });
});
