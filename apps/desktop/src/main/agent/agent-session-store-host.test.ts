import { projectTimeline, type SessionStore } from "@opendesign/session-store";
import { describe, expect, it } from "vitest";
import { AgentSessionStoreHost } from "./agent-session-store-host.js";

describe("AgentSessionStoreHost", () => {
  it("executes session operations without exposing a path", async () => {
    const store = memoryStore();
    const host = new AgentSessionStoreHost(store);
    const signal = new AbortController().signal;
    const event = {
      eventId: "run_1_event_1",
      sessionId: "conversation_1",
      runId: "run_1",
      sequence: 1,
      type: "session.created" as const,
      createdAt: "2026-08-23T00:00:00.000Z",
      payload: {},
    };

    await expect(
      host.execute(
        {
          type: "session-store.request",
          requestId: "append_1",
          operation: "append",
          event,
        },
        signal,
      ),
    ).resolves.toMatchObject({ ok: true, operation: "append", result: null });
    await expect(
      host.execute(
        {
          type: "session-store.request",
          requestId: "read_1",
          operation: "read",
          sessionId: "conversation_1",
        },
        signal,
      ),
    ).resolves.toMatchObject({ result: [event] });
  });

  it("stops waiting when Main cancels a pending request", async () => {
    const store = memoryStore();
    store.read = () => new Promise(() => undefined);
    const host = new AgentSessionStoreHost(store);
    const controller = new AbortController();
    const pending = host.execute(
      {
        type: "session-store.request",
        requestId: "read_1",
        operation: "read",
        sessionId: "conversation_1",
      },
      controller.signal,
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});

function memoryStore(): SessionStore {
  const events: Parameters<SessionStore["append"]>[0][] = [];
  return {
    append: (event) => {
      events.push(structuredClone(event));
      return Promise.resolve();
    },
    read: (sessionId) =>
      Promise.resolve(events.filter((event) => event.sessionId === sessionId)),
    readTimeline: (sessionId) =>
      Promise.resolve(
        projectTimeline(
          sessionId,
          events.filter((event) => event.sessionId === sessionId),
        ),
      ),
    project: (sessionId) =>
      Promise.resolve({
        sessionId,
        lastSequence: events.reduce(
          (maximum, event) => Math.max(maximum, event.sequence),
          0,
        ),
        messageCount: 0,
        toolCallCount: 0,
        compactedRanges: [],
      }),
  };
}
