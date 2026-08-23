import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaferFrameScheduler } from "./frame-scheduler.js";

describe("LeaferFrameScheduler", () => {
  let nextFrameId: number;
  let frames: Map<number, FrameRequestCallback>;
  const cancel = vi.fn();

  beforeEach(() => {
    nextFrameId = 1;
    frames = new Map();
    cancel.mockReset();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", cancel);
  });

  it("coalesces viewport work into one frame", () => {
    const onViewportFrame = vi.fn();
    const scheduler = createScheduler({ onViewportFrame });

    scheduler.scheduleViewport();
    scheduler.scheduleViewport();
    expect(frames.size).toBe(1);

    runFrame(frames, 1);
    expect(onViewportFrame).toHaveBeenCalledOnce();
  });

  it("merges node and tree refresh requests and clears the batch", () => {
    const onEditorRefresh = vi.fn();
    const scheduler = createScheduler({ onEditorRefresh });

    scheduler.scheduleEditorRefresh({ nodeBounds: ["node_a"] });
    scheduler.scheduleEditorRefresh({
      nodeBounds: ["node_a", "node_b"],
      treeBounds: true,
    });
    runFrame(frames, 1);

    expect(onEditorRefresh).toHaveBeenLastCalledWith({
      nodeBounds: ["node_a", "node_b"],
      treeBounds: true,
    });

    scheduler.scheduleEditorRefresh({ nodeBounds: ["node_c"] });
    runFrame(frames, 2);
    expect(onEditorRefresh).toHaveBeenLastCalledWith({
      nodeBounds: ["node_c"],
      treeBounds: false,
    });
  });

  it("cancels pending resources and suppresses disposed callbacks", () => {
    const onEditorRefresh = vi.fn();
    const onViewportFrame = vi.fn();
    const scheduler = createScheduler({
      onEditorRefresh,
      onViewportFrame,
    });

    scheduler.scheduleViewport();
    scheduler.scheduleEditorRefresh({ nodeBounds: ["node_a"] });
    scheduler.dispose();

    expect(cancel).toHaveBeenCalledTimes(2);
    runFrame(frames, 1);
    runFrame(frames, 2);
    expect(onViewportFrame).not.toHaveBeenCalled();
    expect(onEditorRefresh).not.toHaveBeenCalled();

    scheduler.scheduleViewport();
    scheduler.scheduleEditorRefresh({ nodeBounds: ["node_b"] });
    expect(frames.size).toBe(0);
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});

function createScheduler(
  options: Partial<ConstructorParameters<typeof LeaferFrameScheduler>[0]> = {},
) {
  return new LeaferFrameScheduler({
    isDisposed: options.isDisposed ?? (() => false),
    onEditorRefresh: options.onEditorRefresh ?? vi.fn(),
    onViewportFrame: options.onViewportFrame ?? vi.fn(),
  });
}

function runFrame(
  frames: Map<number, FrameRequestCallback>,
  frameId: number,
): void {
  const callback = frames.get(frameId);
  if (!callback) throw new Error(`Animation frame ${frameId} is missing`);
  frames.delete(frameId);
  callback(performance.now());
}
