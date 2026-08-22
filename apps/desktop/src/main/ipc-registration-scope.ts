import type { IpcMainInvokeEvent } from "electron";

type IpcHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;

export interface IpcHandlerRegistry {
  handle(channel: string, listener: IpcHandler): void;
  removeHandler(channel: string): void;
}

/** Tracks one atomic family of ipcMain.handle registrations. */
export class IpcRegistrationScope {
  readonly #ipc: IpcHandlerRegistry;
  readonly #channels: string[] = [];
  #disposed = false;

  constructor(ipc: IpcHandlerRegistry) {
    this.#ipc = ipc;
  }

  handle(channel: string, listener: IpcHandler): void {
    if (this.#disposed) throw new Error("IPC registration scope is disposed");
    if (this.#channels.includes(channel)) {
      throw new Error(
        `IPC channel is already registered in this scope: ${channel}`,
      );
    }
    this.#ipc.handle(channel, listener);
    this.#channels.push(channel);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const failures: Error[] = [];
    for (const channel of this.#channels.reverse()) {
      try {
        this.#ipc.removeHandler(channel);
      } catch (error) {
        failures.push(
          new Error(
            `${channel}: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          ),
        );
      }
    }
    this.#channels.length = 0;
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "IPC registration rollback was incomplete",
      );
    }
  }
}
