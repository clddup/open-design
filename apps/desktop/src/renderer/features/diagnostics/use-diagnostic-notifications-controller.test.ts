import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApi } from "@/shared/desktop-api";
import type { DiagnosticEvent } from "@/shared/diagnostics";
import { useDiagnosticNotificationsController } from "./use-diagnostic-notifications-controller";

afterEach(() => {
  delete window.desktop;
});

describe("useDiagnosticNotificationsController", () => {
  it("filters non-toast and task-scoped events at the single notification boundary", () => {
    const harness = diagnosticHarness();
    const { result, unmount } = renderHook(() =>
      useDiagnosticNotificationsController(),
    );

    act(() => {
      harness.emit(event("silent", 1, { presentation: "silent" }));
      harness.emit(
        event("task", 2, {
          context: { conversationId: "conversation_1", runId: "run_1" },
        }),
      );
      harness.emit(event("global", 3));
    });

    expect(result.current.events.map(({ eventId }) => eventId)).toEqual([
      "global",
    ]);
    unmount();
  });

  it("merges late pending diagnostics with live events in chronological order", async () => {
    const pending = deferred<DiagnosticEvent[]>();
    let emit: ((event: DiagnosticEvent) => void) | undefined;
    window.desktop = {
      getPendingDiagnostics: vi.fn().mockReturnValue(pending.promise),
      onDiagnosticEvent: vi
        .fn()
        .mockImplementation((listener: (event: DiagnosticEvent) => void) => {
          emit = listener;
          return () => undefined;
        }),
    } as unknown as DesktopApi;
    const { result, unmount } = renderHook(() =>
      useDiagnosticNotificationsController(),
    );
    if (!emit) throw new Error("Diagnostic listener is missing");

    act(() => emit?.(event("live_newer", 4, { message: "Live message" })));
    pending.resolve([
      event("live_newer", 1, { message: "Stale pending message" }),
      event("pending_older", 2),
      event("pending_middle", 3),
    ]);

    await waitFor(() => expect(result.current.events).toHaveLength(3));
    expect(result.current.events.map(({ eventId }) => eventId)).toEqual([
      "pending_older",
      "pending_middle",
      "live_newer",
    ]);
    expect(result.current.events.at(-1)?.message).toBe("Live message");
    unmount();
  });

  it("deduplicates by Event ID, retains the newest four and supports dismiss", () => {
    const harness = diagnosticHarness();
    const { result, unmount } = renderHook(() =>
      useDiagnosticNotificationsController(),
    );

    act(() => {
      for (let index = 1; index <= 6; index += 1) {
        harness.emit(event(`event_${index}`, index));
      }
      harness.emit(event("event_6", 6, { message: "Updated message" }));
    });

    expect(result.current.events.map(({ eventId }) => eventId)).toEqual([
      "event_3",
      "event_4",
      "event_5",
      "event_6",
    ]);
    expect(result.current.events.at(-1)?.message).toBe("Updated message");

    act(() => result.current.dismiss("event_4"));
    expect(result.current.events.map(({ eventId }) => eventId)).toEqual([
      "event_3",
      "event_5",
      "event_6",
    ]);
    unmount();
  });

  it("unsubscribes and ignores a pending response after unmount", async () => {
    const pending = deferred<DiagnosticEvent[]>();
    const unsubscribe = vi.fn();
    window.desktop = {
      getPendingDiagnostics: vi.fn().mockReturnValue(pending.promise),
      onDiagnosticEvent: vi.fn().mockReturnValue(unsubscribe),
    } as unknown as DesktopApi;
    const { unmount } = renderHook(() =>
      useDiagnosticNotificationsController(),
    );

    unmount();
    pending.resolve([event("late", 1)]);
    await pending.promise;

    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

function diagnosticHarness() {
  let emit: ((event: DiagnosticEvent) => void) | undefined;
  window.desktop = {
    getPendingDiagnostics: vi.fn().mockResolvedValue([]),
    onDiagnosticEvent: vi
      .fn()
      .mockImplementation((listener: (event: DiagnosticEvent) => void) => {
        emit = listener;
        return () => undefined;
      }),
  } as unknown as DesktopApi;
  return {
    emit(event: DiagnosticEvent) {
      if (!emit) throw new Error("Diagnostic listener is missing");
      emit(event);
    },
  };
}

function event(
  eventId: string,
  minute: number,
  overrides: Partial<DiagnosticEvent> = {},
): DiagnosticEvent {
  return {
    version: 3,
    eventId,
    occurredAt: `2026-08-23T00:${String(minute).padStart(2, "0")}:00.000Z`,
    level: "error",
    source: "main",
    presentation: "toast",
    code: "request_failed",
    message: `Diagnostic ${eventId}`,
    appVersion: "0.0.0",
    platform: "darwin",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
