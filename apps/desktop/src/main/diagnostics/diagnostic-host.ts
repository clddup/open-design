import type { IpcMainInvokeEvent } from "electron";
import {
  channels,
  isRendererDiagnosticReport,
} from "../../shared/desktop-api.js";
import type {
  DiagnosticEvent,
  DiagnosticInput,
} from "../../shared/diagnostics.js";
import type { DiagnosticLog } from "./diagnostic-log.js";

type DiagnosticIpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

export interface DiagnosticIpcRegistrar {
  handle(channel: string, listener: DiagnosticIpcHandler): void;
}

export class DiagnosticHost {
  readonly #fallback: (input: DiagnosticInput) => void;
  readonly #send: (event: DiagnosticEvent) => boolean;
  #log: Pick<DiagnosticLog, "flush" | "record"> | null = null;
  readonly #pending: DiagnosticEvent[] = [];

  constructor(options: {
    fallback: (input: DiagnosticInput) => void;
    send: (event: DiagnosticEvent) => boolean;
  }) {
    this.#fallback = options.fallback;
    this.#send = options.send;
  }

  initialize(log: Pick<DiagnosticLog, "flush" | "record">): void {
    if (this.#log) throw new Error("Diagnostic host is already initialized");
    this.#log = log;
  }

  readonly publish = (input: DiagnosticInput): void => {
    const event = this.#log?.record(input);
    if (!event) {
      this.#fallback(input);
      return;
    }
    if (this.#send(event)) return;
    if (event.presentation === "toast") {
      this.#pending.push(event);
      if (this.#pending.length > 20) this.#pending.shift();
    }
  };

  registerIpc(options: {
    assertRenderer(event: IpcMainInvokeEvent): void;
    ipc: DiagnosticIpcRegistrar;
  }): void {
    options.ipc.handle(
      channels.getPendingDiagnostics,
      (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 0);
        return this.#pending.splice(0);
      },
    );
    options.ipc.handle(
      channels.reportDiagnostic,
      (event, ...args: unknown[]) => {
        options.assertRenderer(event);
        assertArgumentCount(args, 1);
        const report = args[0];
        if (!isRendererDiagnosticReport(report)) {
          throw new TypeError("Invalid diagnostic report");
        }
        this.publish({ ...report, source: "renderer" });
      },
    );
  }

  async flush(): Promise<void> {
    await this.#log?.flush();
  }

  clear(): void {
    this.#pending.length = 0;
    this.#log = null;
  }
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}
