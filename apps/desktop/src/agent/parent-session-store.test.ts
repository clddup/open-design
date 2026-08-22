import type { JournalEvent } from "@opendesign/session-store";
import { describe, expect, it, vi } from "vitest";
import { ParentSessionStore } from "./parent-session-store.js";

const event: JournalEvent = {
  eventId: "run_1_event_1",
  sessionId: "conversation_1",
  runId: "run_1",
  sequence: 1,
  type: "session.created",
  createdAt: "2026-08-23T00:00:00.000Z",
  payload: {},
};

describe("ParentSessionStore", () => {
  it("proxies append and read without receiving a path", async () => {
    const postMessage = vi.fn();
    const store = new ParentSessionStore({ postMessage });
    const appended = store.append(event);
    const appendRequest = postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    expect(appendRequest).not.toHaveProperty("path");
    expect(
      store.handleMessage({
        type: "session-store.response",
        requestId: appendRequest.requestId,
        operation: "append",
        ok: true,
        result: null,
      }),
    ).toBe(true);
    await expect(appended).resolves.toBeUndefined();

    const read = store.read("conversation_1");
    const readRequest = postMessage.mock.calls[1]?.[0] as {
      requestId: string;
    };
    store.handleMessage({
      type: "session-store.response",
      requestId: readRequest.requestId,
      operation: "read",
      ok: true,
      result: [event],
    });
    await expect(read).resolves.toEqual([event]);
  });

  it("rejects malformed and mismatched responses", async () => {
    const postMessage = vi.fn();
    const store = new ParentSessionStore({ postMessage });
    const read = store.read("conversation_1");
    const request = postMessage.mock.calls[0]?.[0] as { requestId: string };

    store.handleMessage({
      type: "session-store.response",
      requestId: request.requestId,
      operation: "project",
      ok: true,
      result: {
        sessionId: "conversation_1",
        lastSequence: 0,
        messageCount: 0,
        toolCallCount: 0,
        compactedRanges: [],
      },
    });
    await expect(read).rejects.toThrow("invalid Session Store response");
  });

  it("ignores unrelated messages", () => {
    const store = new ParentSessionStore({ postMessage: vi.fn() });
    expect(store.handleMessage({ type: "agent.connected" })).toBe(false);
  });
});
