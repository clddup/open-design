import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "../../shared/desktop-api.js";
import {
  registerRendererDesignToolIpc,
  type RendererDesignToolIpcRegistrar,
} from "./renderer-design-tool-ipc.js";

type Handler = Parameters<RendererDesignToolIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;

describe("registerRendererDesignToolIpc", () => {
  it("validates and forwards correlated progress and responses", () => {
    const { assertRenderer, handlers, host } = setup();
    const progress = {
      requestId: "renderer_apply_1",
      phase: "applying",
      progress: 0.5,
      message: "Building navigation",
    };
    const response = {
      requestId: "renderer_apply_1",
      ok: true,
      result: {
        content: { ok: true },
        designRevision: {
          previousRevision: 4,
          revision: 5,
          transactionId: "transaction_5",
        },
      },
    };
    const reportProgress = handlers.get(channels.designToolProgress);
    const resolve = handlers.get(channels.resolveDesignToolRequest);
    if (!reportProgress || !resolve) {
      throw new Error("Renderer design tool handlers are missing");
    }

    expect(reportProgress(event, progress)).toBe(true);
    expect(resolve(event, response)).toBeUndefined();
    expect(host.progress).toHaveBeenCalledWith(progress);
    expect(host.resolve).toHaveBeenCalledWith(response);
    expect(assertRenderer).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed payloads, stale responses and unexpected arguments", () => {
    const { handlers, host } = setup();
    const reportProgress = handlers.get(channels.designToolProgress);
    const resolve = handlers.get(channels.resolveDesignToolRequest);
    if (!reportProgress || !resolve) {
      throw new Error("Renderer design tool handlers are missing");
    }

    expect(() => reportProgress(event, { requestId: "bad" })).toThrow(
      "Invalid design tool progress",
    );
    expect(() => resolve(event, { requestId: "bad" })).toThrow(
      "Invalid design tool response",
    );
    expect(() => reportProgress(event)).toThrow("Unexpected IPC arguments");

    host.resolve.mockReturnValueOnce(false);
    expect(() =>
      resolve(event, {
        requestId: "renderer_apply_1",
        ok: true,
        result: { content: { ok: true } },
      }),
    ).toThrow("Design tool request is no longer active");
  });

  it("checks sender identity before payload validation", () => {
    const assertRenderer = vi.fn(() => {
      throw new Error("Request from unknown renderer");
    });
    const { handlers, host } = setup(assertRenderer);
    const reportProgress = handlers.get(channels.designToolProgress);
    if (!reportProgress) throw new Error("Progress handler is missing");

    expect(() => reportProgress(event, { requestId: "bad" })).toThrow(
      "Request from unknown renderer",
    );
    expect(host.progress).not.toHaveBeenCalled();
  });
});

function setup(assertRenderer = vi.fn()) {
  const handlers = new Map<string, Handler>();
  const ipc: RendererDesignToolIpcRegistrar = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  const host = {
    progress: vi.fn(() => true),
    resolve: vi.fn(() => true),
  };
  registerRendererDesignToolIpc({ assertRenderer, host, ipc });
  return { assertRenderer, handlers, host };
}
