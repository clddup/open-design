import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "../../shared/desktop-api.js";
import {
  DIAGNOSTIC_EVENT_VERSION,
  type DiagnosticEvent,
  type DiagnosticInput,
} from "../../shared/diagnostics.js";
import {
  DiagnosticHost,
  type DiagnosticIpcRegistrar,
} from "./diagnostic-host.js";

type Handler = Parameters<DiagnosticIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;

describe("DiagnosticHost", () => {
  it("falls back before storage initialization", () => {
    const fixture = setup({ initialize: false });
    const input = diagnostic("startup_unavailable", "silent");

    fixture.host.publish(input);

    expect(fixture.fallback).toHaveBeenCalledWith(input);
    expect(fixture.send).not.toHaveBeenCalled();
  });

  it("sends live events and keeps only a bounded pending toast queue", () => {
    const fixture = setup({ send: vi.fn(() => false) });
    for (let index = 0; index < 22; index += 1) {
      fixture.host.publish(diagnostic(`toast_${index}`, "toast"));
    }
    fixture.host.publish(diagnostic("silent_event", "silent"));

    const pending = invoke(fixture, channels.getPendingDiagnostics) as
      DiagnosticEvent[] | undefined;
    expect(pending).toHaveLength(20);
    expect(pending?.[0]?.code).toBe("toast_2");
    expect(pending?.at(-1)?.code).toBe("toast_21");
    expect(invoke(fixture, channels.getPendingDiagnostics)).toEqual([]);
  });

  it("accepts Renderer reports but owns their diagnostic source", () => {
    const fixture = setup();

    invoke(fixture, channels.reportDiagnostic, {
      level: "warning",
      presentation: "toast",
      code: "renderer_warning",
      message: "Renderer warning",
    });

    expect(fixture.log.record).toHaveBeenCalledWith({
      level: "warning",
      source: "renderer",
      presentation: "toast",
      code: "renderer_warning",
      message: "Renderer warning",
    });
  });

  it("validates sender before arguments and payloads", () => {
    const fixture = setup({
      assertRenderer: vi.fn(() => {
        throw new Error("Request from unknown renderer");
      }),
    });

    expect(() =>
      invoke(fixture, channels.reportDiagnostic, { invalid: true }),
    ).toThrow("Request from unknown renderer");
    expect(fixture.log.record).not.toHaveBeenCalled();

    fixture.assertRenderer.mockImplementation(() => undefined);
    expect(() => invoke(fixture, channels.reportDiagnostic)).toThrow(
      "Unexpected IPC arguments",
    );
    expect(() =>
      invoke(fixture, channels.reportDiagnostic, { invalid: true }),
    ).toThrow("Invalid diagnostic report");
  });

  it("flushes and clears the active log exactly once per lifecycle", async () => {
    const fixture = setup();

    await fixture.host.flush();
    expect(fixture.log.flush).toHaveBeenCalledOnce();
    fixture.host.clear();
    await fixture.host.flush();
    expect(fixture.log.flush).toHaveBeenCalledOnce();
    expect(() => fixture.host.initialize(fixture.log)).not.toThrow();
    expect(() => fixture.host.initialize(fixture.log)).toThrow(
      "Diagnostic host is already initialized",
    );
  });
});

function diagnostic(
  code: string,
  presentation: DiagnosticInput["presentation"],
): DiagnosticInput {
  return {
    level: "info",
    source: "main",
    presentation,
    code,
    message: code,
  };
}

function invoke(
  fixture: ReturnType<typeof setup>,
  channel: string,
  ...args: unknown[]
): unknown {
  const handler = fixture.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler(event, ...args);
}

function setup(
  overrides: {
    assertRenderer?: (event: IpcMainInvokeEvent) => void;
    initialize?: boolean;
    send?: (event: DiagnosticEvent) => boolean;
  } = {},
) {
  const handlers = new Map<string, Handler>();
  let sequence = 0;
  const log = {
    flush: vi.fn(() => Promise.resolve()),
    record: vi.fn((input: DiagnosticInput): DiagnosticEvent => ({
      ...input,
      version: DIAGNOSTIC_EVENT_VERSION,
      eventId: `diagnostic_${++sequence}`,
      occurredAt: "2026-08-23T00:00:00.000Z",
      appVersion: "0.0.0",
      platform: "darwin",
    })),
  };
  const fallback = vi.fn();
  const send = vi.fn(overrides.send ?? (() => true));
  const assertRenderer = vi.fn(overrides.assertRenderer ?? (() => undefined));
  const host = new DiagnosticHost({ fallback, send });
  if (overrides.initialize !== false) host.initialize(log);
  host.registerIpc({
    assertRenderer,
    ipc: {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
  });
  return {
    assertRenderer,
    fallback,
    handlers,
    host,
    log,
    send,
  };
}
