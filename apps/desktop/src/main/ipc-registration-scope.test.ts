import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { IpcRegistrationScope } from "./ipc-registration-scope";

describe("IpcRegistrationScope", () => {
  it("removes only its successfully registered channels in reverse order", () => {
    const order: string[] = [];
    const scope = new IpcRegistrationScope({
      handle: (channel) => order.push(`add:${channel}`),
      removeHandler: (channel) => order.push(`remove:${channel}`),
    });
    const handler = vi.fn<(event: IpcMainInvokeEvent) => void>();

    scope.handle("first", handler);
    scope.handle("second", handler);
    scope.dispose();
    scope.dispose();

    expect(order).toEqual([
      "add:first",
      "add:second",
      "remove:second",
      "remove:first",
    ]);
  });

  it("does not record a channel whose underlying registration failed", () => {
    const removeHandler = vi.fn();
    const scope = new IpcRegistrationScope({
      handle: (channel) => {
        if (channel === "broken") throw new Error("registration failed");
      },
      removeHandler,
    });

    scope.handle("ready", vi.fn());
    expect(() => scope.handle("broken", vi.fn())).toThrow(
      "registration failed",
    );
    scope.dispose();

    expect(removeHandler).toHaveBeenCalledOnce();
    expect(removeHandler).toHaveBeenCalledWith("ready");
  });

  it("rejects duplicate and post-disposal registration", () => {
    const scope = new IpcRegistrationScope({
      handle: vi.fn(),
      removeHandler: vi.fn(),
    });
    const handler = vi.fn();
    scope.handle("channel", handler);

    expect(() => scope.handle("channel", handler)).toThrow(
      "already registered",
    );
    scope.dispose();
    expect(() => scope.handle("later", handler)).toThrow("disposed");
  });

  it("continues removing remaining channels after one removal fails", () => {
    const removed: string[] = [];
    const scope = new IpcRegistrationScope({
      handle: vi.fn(),
      removeHandler: (channel) => {
        removed.push(channel);
        if (channel === "second") throw new Error("remove failed");
      },
    });
    scope.handle("first", vi.fn());
    scope.handle("second", vi.fn());
    scope.handle("third", vi.fn());

    expect(() => scope.dispose()).toThrow(AggregateError);
    expect(removed).toEqual(["third", "second", "first"]);
    expect(() => scope.dispose()).not.toThrow();
  });
});
