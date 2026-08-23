import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api.js";
import {
  registerSvgFileIpc,
  type SvgFileIpcHandler,
  type SvgFileIpcRegistrar,
} from "./svg-file-ipc.js";

function setup(assertRenderer = vi.fn()) {
  const handlers = new Map<string, SvgFileIpcHandler>();
  const ipc: SvgFileIpcRegistrar = {
    handle(channel: string, handler: SvgFileIpcHandler) {
      handlers.set(channel, handler);
    },
  };
  const service = {
    openSvgFile: vi.fn(() =>
      Promise.resolve({ name: "Brand.svg", contents: "<svg />" }),
    ),
    saveSvgFile: vi.fn(() => Promise.resolve({ name: "Brand.svg" })),
  };
  registerSvgFileIpc({ ipc, service, assertRenderer });
  return { assertRenderer, handlers, service };
}

const event = {} as IpcMainInvokeEvent;

describe("registerSvgFileIpc", () => {
  it("registers path-free open and save request/response channels", async () => {
    const { assertRenderer, handlers, service } = setup();
    const open = handlers.get(channels.openSvgFile);
    const save = handlers.get(channels.saveSvgFile);
    if (!open || !save) throw new Error("SVG handlers were not registered");
    const request = { suggestedName: "Brand", contents: "<svg />" };

    await expect(open(event)).resolves.toEqual({
      name: "Brand.svg",
      contents: "<svg />",
    });
    await expect(save(event, request)).resolves.toEqual({ name: "Brand.svg" });
    expect(service.openSvgFile).toHaveBeenCalledOnce();
    expect(service.saveSvgFile).toHaveBeenCalledWith(request);
    expect(assertRenderer).toHaveBeenCalledTimes(2);
  });

  it("validates the sender before rejecting unexpected argument counts", () => {
    const assertRenderer = vi.fn(() => {
      throw new Error("Request from unknown renderer");
    });
    const { handlers, service } = setup(assertRenderer);
    const open = handlers.get(channels.openSvgFile);
    if (!open) throw new Error("SVG open handler was not registered");

    expect(() => open(event, "/tmp/forged.svg")).toThrow(
      "Request from unknown renderer",
    );
    expect(service.openSvgFile).not.toHaveBeenCalled();
  });

  it("rejects missing or extra IPC arguments without invoking the service", () => {
    const { handlers, service } = setup();
    const open = handlers.get(channels.openSvgFile);
    const save = handlers.get(channels.saveSvgFile);
    if (!open || !save) throw new Error("SVG handlers were not registered");

    expect(() => open(event, "unexpected")).toThrow(
      "Unexpected SVG file IPC arguments",
    );
    expect(() => save(event)).toThrow("Unexpected SVG file IPC arguments");
    expect(() => save(event, {}, {})).toThrow(
      "Unexpected SVG file IPC arguments",
    );
    expect(service.openSvgFile).not.toHaveBeenCalled();
    expect(service.saveSvgFile).not.toHaveBeenCalled();
  });
});
