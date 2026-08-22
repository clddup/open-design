import { isSessionTimelineItem } from "@opendesign/agent-contracts";
import type {
  JournalEvent,
  SessionProjection,
  SessionTimelineItem,
} from "@opendesign/session-store";

export type SessionStoreBridgeRequest =
  | {
      type: "session-store.request";
      requestId: string;
      operation: "append";
      event: JournalEvent;
    }
  | {
      type: "session-store.request";
      requestId: string;
      operation: "read" | "readTimeline" | "project";
      sessionId: string;
    };

export type SessionStoreBridgeResponse =
  | {
      type: "session-store.response";
      requestId: string;
      operation: "append";
      ok: true;
      result: null;
    }
  | {
      type: "session-store.response";
      requestId: string;
      operation: "read";
      ok: true;
      result: JournalEvent[];
    }
  | {
      type: "session-store.response";
      requestId: string;
      operation: "readTimeline";
      ok: true;
      result: SessionTimelineItem[];
    }
  | {
      type: "session-store.response";
      requestId: string;
      operation: "project";
      ok: true;
      result: SessionProjection;
    }
  | {
      type: "session-store.response";
      requestId: string;
      operation: SessionStoreOperation;
      ok: false;
      error: string;
    };

export type SessionStoreOperation = SessionStoreBridgeRequest["operation"];

const operations = new Set<SessionStoreOperation>([
  "append",
  "read",
  "readTimeline",
  "project",
]);
const journalEventTypes = new Set([
  "session.created",
  "run.state",
  "message.user",
  "message.assistant",
  "tool.requested",
  "tool.progress",
  "tool.completed",
  "tool.failed",
  "approval.requested",
  "approval.resolved",
  "design.revision",
  "context.compacted",
]);

export function isSessionStoreBridgeRequest(
  value: unknown,
): value is SessionStoreBridgeRequest {
  if (
    !record(value) ||
    value.type !== "session-store.request" ||
    !safeId(value.requestId) ||
    !isOperation(value.operation)
  ) {
    return false;
  }
  if (value.operation === "append") {
    return (
      isJournalEvent(value.event) &&
      exactKeys(value, ["type", "requestId", "operation", "event"])
    );
  }
  return (
    safeId(value.sessionId) &&
    exactKeys(value, ["type", "requestId", "operation", "sessionId"])
  );
}

export function sessionStoreBridgeRequestId(value: unknown): string | null {
  return record(value) &&
    value.type === "session-store.request" &&
    safeId(value.requestId)
    ? value.requestId
    : null;
}

export function sessionStoreBridgeRequestOperation(
  value: unknown,
): SessionStoreOperation | null {
  return record(value) &&
    value.type === "session-store.request" &&
    isOperation(value.operation)
    ? value.operation
    : null;
}

export function isSessionStoreBridgeResponse(
  value: unknown,
): value is SessionStoreBridgeResponse {
  if (
    !record(value) ||
    value.type !== "session-store.response" ||
    !safeId(value.requestId) ||
    !isOperation(value.operation) ||
    typeof value.ok !== "boolean"
  ) {
    return false;
  }
  if (!value.ok) {
    return (
      safeText(value.error, 20_000) &&
      exactKeys(value, ["type", "requestId", "operation", "ok", "error"])
    );
  }
  if (!exactKeys(value, ["type", "requestId", "operation", "ok", "result"])) {
    return false;
  }
  if (value.operation === "append") return value.result === null;
  if (value.operation === "read") {
    return boundedArray(value.result, isJournalEvent);
  }
  if (value.operation === "readTimeline") {
    return boundedArray(value.result, isSessionTimelineItem);
  }
  return isSessionProjection(value.result);
}

export function sessionStoreBridgeResponseId(value: unknown): string | null {
  return record(value) &&
    value.type === "session-store.response" &&
    safeId(value.requestId)
    ? value.requestId
    : null;
}

function isJournalEvent(value: unknown): value is JournalEvent {
  return (
    record(value) &&
    safeId(value.eventId) &&
    safeId(value.sessionId) &&
    (value.runId === undefined || safeId(value.runId)) &&
    Number.isSafeInteger(value.sequence) &&
    Number(value.sequence) >= 1 &&
    typeof value.type === "string" &&
    journalEventTypes.has(value.type) &&
    typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) &&
    "payload" in value &&
    jsonSizeWithin(value.payload, 4_000_000) &&
    exactKeys(value, [
      "eventId",
      "sessionId",
      "runId",
      "sequence",
      "type",
      "createdAt",
      "payload",
    ])
  );
}

function isSessionProjection(value: unknown): value is SessionProjection {
  return (
    record(value) &&
    safeId(value.sessionId) &&
    Number.isSafeInteger(value.lastSequence) &&
    Number(value.lastSequence) >= 0 &&
    (value.activeRunId === undefined || safeId(value.activeRunId)) &&
    (value.latestRevision === undefined ||
      (Number.isSafeInteger(value.latestRevision) &&
        Number(value.latestRevision) >= 0)) &&
    Number.isSafeInteger(value.messageCount) &&
    Number(value.messageCount) >= 0 &&
    Number.isSafeInteger(value.toolCallCount) &&
    Number(value.toolCallCount) >= 0 &&
    boundedArray(value.compactedRanges, isCompactedRange) &&
    exactKeys(value, [
      "sessionId",
      "lastSequence",
      "activeRunId",
      "latestRevision",
      "messageCount",
      "toolCallCount",
      "compactedRanges",
    ])
  );
}

function isCompactedRange(
  value: unknown,
): value is SessionProjection["compactedRanges"][number] {
  return (
    record(value) &&
    Number.isSafeInteger(value.fromSequence) &&
    Number(value.fromSequence) >= 1 &&
    Number.isSafeInteger(value.toSequence) &&
    Number(value.toSequence) >= Number(value.fromSequence) &&
    exactKeys(value, ["fromSequence", "toSequence"])
  );
}

function boundedArray<T>(
  value: unknown,
  validate: (candidate: unknown) => candidate is T,
): value is T[] {
  return (
    Array.isArray(value) &&
    value.length <= 100_000 &&
    value.every(validate) &&
    jsonSizeWithin(value, 16_000_000)
  );
}

function isOperation(value: unknown): value is SessionStoreOperation {
  return (
    typeof value === "string" && operations.has(value as SessionStoreOperation)
  );
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return (
    safeText(value, 256) &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function jsonSizeWithin(value: unknown, maximum: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= maximum;
  } catch {
    return false;
  }
}
