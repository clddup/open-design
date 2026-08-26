import { describe, expect, it } from "vitest";
import {
  isSessionStoreBridgeRequest,
  isSessionStoreBridgeResponse,
  SessionStoreBridgeRequestContract,
  SessionStoreBridgeResponseContract,
  sessionStoreBridgeRequestId,
  sessionStoreBridgeResponseId,
} from "./session-store-bridge.js";

const event = {
  eventId: "run_1_event_1",
  sessionId: "conversation_1",
  runId: "run_1",
  sequence: 1,
  type: "message.user",
  createdAt: "2026-08-23T00:00:00.000Z",
  payload: {
    messageId: "message_1",
    content: "Create a dashboard",
    documentId: "document_1",
    revision: 0,
    scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  },
} as const;

describe("Session Store bridge", () => {
  it("accepts exact bounded append and read requests", () => {
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event,
      }),
    ).toBe(true);
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_2",
        operation: "read",
        sessionId: "conversation_1",
      }),
    ).toBe(true);
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_2",
        operation: "read",
        sessionId: "conversation_1",
        path: "/tmp/events.jsonl",
      }),
    ).toBe(false);
  });

  it("rejects malformed events and oversized payloads", () => {
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: { ...event, sequence: 0 },
      }),
    ).toBe(false);
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: {
          ...event,
          type: "tool.requested",
          payload: {
            toolCallId: "tool_1",
            toolName: "opendesign_edit_design",
            input: "x".repeat(4_000_001),
            risk: "design_write",
          },
        },
      }),
    ).toBe(false);
    expect(
      SessionStoreBridgeRequestContract.issues({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: {
          ...event,
          type: "tool.requested",
          payload: {
            toolCallId: "tool_1",
            toolName: "opendesign_edit_design",
            input: "x".repeat(4_000_001),
            risk: "design_write",
          },
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "session_store_bridge_event.payload_too_large",
        path: "/event/payload",
      }),
    );
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: {
          ...event,
          createdAt: "not-a-timestamp",
        },
      }),
    ).toBe(false);
    expect(
      SessionStoreBridgeRequestContract.issues({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: {
          ...event,
          createdAt: "not-a-timestamp",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "session_store_bridge_event.timestamp_invalid",
        path: "/event/createdAt",
      }),
    );
    expect(
      isSessionStoreBridgeRequest({
        type: "session-store.request",
        requestId: "request_1",
        operation: "append",
        event: {
          ...event,
          payload: {
            messageId: "message_1",
            documentId: "document_1",
            revision: 0,
            scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
          },
        },
      }),
    ).toBe(false);
  });

  it("validates operation-specific responses", () => {
    expect(
      isSessionStoreBridgeResponse({
        type: "session-store.response",
        requestId: "request_1",
        operation: "append",
        ok: true,
        result: null,
      }),
    ).toBe(true);
    expect(
      isSessionStoreBridgeResponse({
        type: "session-store.response",
        requestId: "request_2",
        operation: "read",
        ok: true,
        result: [event],
      }),
    ).toBe(true);
    expect(
      isSessionStoreBridgeResponse({
        type: "session-store.response",
        requestId: "request_2",
        operation: "project",
        ok: true,
        result: [event],
      }),
    ).toBe(false);
    expect(
      SessionStoreBridgeResponseContract.issues({
        type: "session-store.response",
        requestId: "request_3",
        operation: "project",
        ok: true,
        result: {
          sessionId: "conversation_1",
          lastSequence: 2,
          messageCount: 0,
          toolCallCount: 0,
          compactedRanges: [{ fromSequence: 2, toSequence: 1 }],
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "session_store_bridge_response.compacted_range_invalid",
        path: "/result/compactedRanges/0/toSequence",
      }),
    );
  });

  it("extracts IDs from malformed matching envelopes", () => {
    expect(
      sessionStoreBridgeRequestId({
        type: "session-store.request",
        requestId: "request_1",
        operation: "read",
      }),
    ).toBe("request_1");
    expect(
      sessionStoreBridgeResponseId({
        type: "session-store.response",
        requestId: "request_1",
        ok: "invalid",
      }),
    ).toBe("request_1");
  });
});
