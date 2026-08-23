import { appendFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  DIAGNOSTIC_EVENT_VERSION,
  type DiagnosticEvent,
  type DiagnosticInput,
} from "@/shared/diagnostics";

export type DiagnosticLogOptions = {
  appVersion: string;
  platform: NodeJS.Platform;
  maxBytes?: number;
};

const defaultMaximumBytes = 2 * 1024 * 1024;

export class DiagnosticLog {
  readonly path: string;
  readonly rotatedPath: string;
  readonly #appVersion: string;
  readonly #platform: NodeJS.Platform;
  readonly #maxBytes: number;
  #writeQueue: Promise<void> = Promise.resolve();

  constructor(
    readonly directory: string,
    options: DiagnosticLogOptions,
  ) {
    this.path = join(directory, "events.jsonl");
    this.rotatedPath = join(directory, "events.1.jsonl");
    this.#appVersion = options.appVersion;
    this.#platform = options.platform;
    this.#maxBytes = options.maxBytes ?? defaultMaximumBytes;
  }

  record(input: DiagnosticInput): DiagnosticEvent {
    const event: DiagnosticEvent = {
      ...input,
      version: DIAGNOSTIC_EVENT_VERSION,
      eventId: `diagnostic_${randomUUID()}`,
      occurredAt: new Date().toISOString(),
      appVersion: this.#appVersion,
      platform: this.#platform,
    };
    this.#writeQueue = this.#writeQueue
      .then(() => this.#append(event))
      .catch((error: unknown) => {
        console.error(
          `Diagnostic log write failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    return event;
  }

  async flush(): Promise<void> {
    await this.#writeQueue;
  }

  async #append(event: DiagnosticEvent): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const line = `${JSON.stringify(event)}\n`;
    let currentBytes = 0;
    try {
      currentBytes = (await stat(this.path)).size;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    if (
      currentBytes > 0 &&
      currentBytes + Buffer.byteLength(line, "utf8") > this.#maxBytes
    ) {
      await rm(this.rotatedPath, { force: true });
      await rename(this.path, this.rotatedPath);
    }
    await appendFile(this.path, line, { encoding: "utf8", flag: "a" });
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
