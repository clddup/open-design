import type { IpcMainInvokeEvent } from "electron";
import { channels } from "@/shared/desktop-api.js";
import type { SvgFileService } from "./svg-file-service.js";

export type SvgFileIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface SvgFileIpcRegistrar {
  handle(channel: string, listener: SvgFileIpcHandler): void;
}

export interface RegisterSvgFileIpcOptions {
  ipc: SvgFileIpcRegistrar;
  service: Pick<SvgFileService, "openSvgFile" | "saveSvgFile">;
  assertRenderer: (event: IpcMainInvokeEvent) => void;
}

/** Registers the only Renderer-facing SVG file channels. */
export function registerSvgFileIpc(options: RegisterSvgFileIpcOptions): void {
  options.ipc.handle(channels.openSvgFile, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 0);
    return options.service.openSvgFile();
  });

  options.ipc.handle(channels.saveSvgFile, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 1);
    return options.service.saveSvgFile(args[0]);
  });
}

function assertArgumentCount(args: unknown[], expected: number): void {
  if (args.length !== expected) {
    throw new TypeError("Unexpected SVG file IPC arguments");
  }
}
