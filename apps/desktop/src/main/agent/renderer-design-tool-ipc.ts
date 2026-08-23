import type { IpcMainInvokeEvent } from "electron";
import {
  isRendererDesignToolProgress,
  isRendererDesignToolResponse,
} from "@/shared/design-tool-bridge.js";
import { channels } from "@/shared/desktop-api.js";
import type { RendererDesignToolHost } from "./renderer-design-tool-host.js";

type RendererDesignToolIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface RendererDesignToolIpcRegistrar {
  handle(channel: string, listener: RendererDesignToolIpcHandler): void;
}

export function registerRendererDesignToolIpc(options: {
  assertRenderer(event: IpcMainInvokeEvent): void;
  host: Pick<RendererDesignToolHost, "progress" | "resolve">;
  ipc: RendererDesignToolIpcRegistrar;
}): void {
  options.ipc.handle(channels.designToolProgress, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 1);
    const progress = args[0];
    if (!isRendererDesignToolProgress(progress)) {
      throw new TypeError("Invalid design tool progress");
    }
    return options.host.progress(progress);
  });

  options.ipc.handle(channels.resolveDesignToolRequest, (event, ...args) => {
    options.assertRenderer(event);
    assertArgumentCount(args, 1);
    const response = args[0];
    if (!isRendererDesignToolResponse(response)) {
      throw new TypeError("Invalid design tool response");
    }
    if (!options.host.resolve(response)) {
      throw new Error("Design tool request is no longer active");
    }
  });
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
