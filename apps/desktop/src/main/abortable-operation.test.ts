import { describe, expect, it, vi } from "vitest";
import { awaitAbortable } from "./abortable-operation";

describe("abortable Main wait", () => {
  it("releases its listener when the operation settles", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      awaitAbortable(Promise.resolve(42), controller.signal),
    ).resolves.toBe(42);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
  it("removes the listener immediately on abort and observes late rejection", async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    let reject!: (error: Error) => void;
    const operation = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    const waiting = awaitAbortable(operation, controller.signal);
    const reason = new Error("User stopped");
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    reject(new Error("Late worker failure"));
    await Promise.resolve();
  });
  it("handles a rejected operation even when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      awaitAbortable(
        Promise.reject(new Error("Already rejected")),
        controller.signal,
      ),
    ).rejects.toBe(controller.signal.reason);
  });
});
