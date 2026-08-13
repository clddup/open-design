import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForCanvasPaint } from "./agent-generation-timing";

describe("Agent generation canvas timing", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("continues when Electron suspends animation frames", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 41);
    const cancel = vi
      .spyOn(window, "cancelAnimationFrame")
      .mockImplementation(() => undefined);
    const waiting = waitForCanvasPaint(undefined, 0);

    await vi.advanceTimersByTimeAsync(500);
    await expect(waiting).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledWith(41);
  });

  it("still cancels a suspended frame wait", async () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 42);
    const controller = new AbortController();
    const waiting = waitForCanvasPaint(controller.signal, 0);

    controller.abort();
    await expect(waiting).rejects.toThrow("Design generation stopped");
  });
});
