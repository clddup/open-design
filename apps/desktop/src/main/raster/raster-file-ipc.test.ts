import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api.js";
import {
  registerRasterFileIpc,
  type RasterFileIpcHandler,
  type RasterFileIpcRegistrar,
} from "./raster-file-ipc.js";

describe("registerRasterFileIpc", () => {
  it("validates sender and argument count before path-free saving", async () => {
    const handlers = new Map<string, RasterFileIpcHandler>();
    const ipc: RasterFileIpcRegistrar = {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    };
    const service = {
      saveRasterFile: vi
        .fn()
        .mockResolvedValue({ name: "Poster.png", byteSize: 3 }),
    };
    const assertRenderer = vi.fn();
    registerRasterFileIpc({ ipc, service, assertRenderer });
    const save = handlers.get(channels.saveRasterFile);
    if (!save) throw new Error("Raster save handler was not registered");
    const event = {} as IpcMainInvokeEvent;
    const request = { format: "png" };

    await expect(save(event, request)).resolves.toEqual({
      name: "Poster.png",
      byteSize: 3,
    });
    expect(assertRenderer).toHaveBeenCalledWith(event);
    expect(service.saveRasterFile).toHaveBeenCalledWith(request);
    expect(() => save(event)).toThrow("Unexpected raster file IPC arguments");
    expect(() => save(event, request, request)).toThrow(
      "Unexpected raster file IPC arguments",
    );
  });
});
