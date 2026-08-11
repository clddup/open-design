import type { IpcMainInvokeEvent } from "electron";
import { channels } from "../../shared/desktop-api.js";
import type { RasterFileService } from "./raster-file-service.js";

export type RasterFileIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface RasterFileIpcRegistrar {
  handle(channel: string, listener: RasterFileIpcHandler): void;
}

export function registerRasterFileIpc(options: {
  ipc: RasterFileIpcRegistrar;
  service: Pick<RasterFileService, "saveRasterFile">;
  assertRenderer(event: IpcMainInvokeEvent): void;
}): void {
  options.ipc.handle(channels.saveRasterFile, (event, ...args) => {
    options.assertRenderer(event);
    if (args.length !== 1) {
      throw new TypeError("Unexpected raster file IPC arguments");
    }
    return options.service.saveRasterFile(args[0]);
  });
}
