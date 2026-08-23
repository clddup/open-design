import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isDiagnosticEvent } from "@/shared/diagnostics";
import { DiagnosticLog } from "./diagnostic-log";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "opendesign-diagnostics-"));
  temporaryDirectories.push(path);
  return path;
}

describe("DiagnosticLog", () => {
  it("writes one validated JSONL event without diagnostic payload bodies", async () => {
    const directory = await temporaryDirectory();
    const log = new DiagnosticLog(directory, {
      appVersion: "0.1.0",
      platform: "darwin",
    });
    const event = log.record({
      level: "error",
      source: "agent",
      presentation: "toast",
      code: "model_failed",
      message: "Provider returned 503",
      context: { conversationId: "conversation_1", runId: "run_1" },
    });

    await log.flush();

    const lines = (await readFile(log.path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "null")).toEqual(event);
    expect(isDiagnosticEvent(event)).toBe(true);
  });

  it("rotates before an append would exceed the configured size", async () => {
    const directory = await temporaryDirectory();
    const log = new DiagnosticLog(directory, {
      appVersion: "0.1.0",
      platform: "win32",
      maxBytes: 700,
    });
    log.record({
      level: "warning",
      source: "storage",
      presentation: "silent",
      code: "first",
      message: "x".repeat(350),
    });
    log.record({
      level: "error",
      source: "storage",
      presentation: "toast",
      code: "second",
      message: "y".repeat(350),
    });

    await log.flush();

    expect((await stat(log.rotatedPath)).size).toBeGreaterThan(0);
    expect(await readFile(log.path, "utf8")).toContain('"code":"second"');
  });
});
