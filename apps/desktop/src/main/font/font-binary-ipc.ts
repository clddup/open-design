import type { IpcMainInvokeEvent } from "electron";
import { channels, isFontBinaryReadRequest } from "@/shared/desktop-api.js";
import type { FontBinaryHost } from "./font-binary-host.js";

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface FontBinaryIpcRegistrar {
  handle(channel: string, listener: Handler): void;
}

export function registerFontBinaryIpc(options: {
  assertRenderer(event: IpcMainInvokeEvent): void;
  host: Pick<FontBinaryHost, "importFiles" | "list" | "read">;
  ipc: FontBinaryIpcRegistrar;
  selectFiles(): Promise<readonly string[]>;
}): void {
  options.ipc.handle(channels.selectFontBinaries, async (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 0);
    const paths = await options.selectFiles();
    return paths.length === 0 ? [] : options.host.importFiles(paths);
  });
  options.ipc.handle(channels.listFontBinaries, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 0);
    return options.host.list();
  });
  options.ipc.handle(channels.readFontBinary, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 1);
    if (!isFontBinaryReadRequest(args[0])) {
      throw new TypeError("Invalid font binary read request");
    }
    return options.host.read(args[0].fontId);
  });
}

function assertArgumentCount(args: unknown[], expected: number): void {
  if (args.length !== expected) {
    throw new TypeError("Unexpected font binary IPC arguments");
  }
}
