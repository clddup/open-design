import {
  DurableTimelineEventSchema,
  SessionTimelineItemSchema,
} from "@opendesign/agent-contracts";
import type {
  JournalEvent,
  SessionProjection,
  SessionTimelineItem,
} from "@opendesign/session-store";
import { Type, type Static } from "@sinclair/typebox";

const BridgeIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const BridgeErrorSchema = Type.String({ minLength: 1, maxLength: 20_000 });
const SessionStoreOperationSchema = Type.Union([
  Type.Literal("append"),
  Type.Literal("read"),
  Type.Literal("readTimeline"),
  Type.Literal("project"),
]);
const CompactedRangeSchema = Type.Object(
  {
    fromSequence: Type.Integer({ minimum: 1 }),
    toSequence: Type.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const SessionProjectionSchema = Type.Object(
  {
    sessionId: BridgeIdSchema,
    lastSequence: Type.Integer({ minimum: 0 }),
    activeRunId: Type.Optional(BridgeIdSchema),
    latestRevision: Type.Optional(Type.Integer({ minimum: 0 })),
    messageCount: Type.Integer({ minimum: 0 }),
    toolCallCount: Type.Integer({ minimum: 0 }),
    compactedRanges: Type.Array(CompactedRangeSchema, { maxItems: 100_000 }),
  },
  { additionalProperties: false },
);

const AppendRequestSchema = Type.Object(
  {
    type: Type.Literal("session-store.request"),
    requestId: BridgeIdSchema,
    operation: Type.Literal("append"),
    event: DurableTimelineEventSchema,
  },
  { additionalProperties: false },
);
const ReadRequestSchema = Type.Object(
  {
    type: Type.Literal("session-store.request"),
    requestId: BridgeIdSchema,
    operation: Type.Union([
      Type.Literal("read"),
      Type.Literal("readTimeline"),
      Type.Literal("project"),
    ]),
    sessionId: BridgeIdSchema,
  },
  { additionalProperties: false },
);

export const SessionStoreBridgeRequestSchema = Type.Union([
  AppendRequestSchema,
  ReadRequestSchema,
]);

const ResponseEnvelope = {
  type: Type.Literal("session-store.response"),
  requestId: BridgeIdSchema,
};
export const SessionStoreBridgeResponseSchema = Type.Union([
  Type.Object(
    {
      ...ResponseEnvelope,
      operation: Type.Literal("append"),
      ok: Type.Literal(true),
      result: Type.Null(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ResponseEnvelope,
      operation: Type.Literal("read"),
      ok: Type.Literal(true),
      result: Type.Array(DurableTimelineEventSchema, { maxItems: 100_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ResponseEnvelope,
      operation: Type.Literal("readTimeline"),
      ok: Type.Literal(true),
      result: Type.Array(SessionTimelineItemSchema, { maxItems: 100_000 }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ResponseEnvelope,
      operation: Type.Literal("project"),
      ok: Type.Literal(true),
      result: SessionProjectionSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...ResponseEnvelope,
      operation: SessionStoreOperationSchema,
      ok: Type.Literal(false),
      error: BridgeErrorSchema,
    },
    { additionalProperties: false },
  ),
]);

export const SessionStoreBridgeRequestIdentitySchema = Type.Object(
  {
    type: Type.Literal("session-store.request"),
    requestId: BridgeIdSchema,
  },
  { additionalProperties: true },
);
export const SessionStoreBridgeRequestOperationSchema = Type.Object(
  {
    type: Type.Literal("session-store.request"),
    operation: SessionStoreOperationSchema,
  },
  { additionalProperties: true },
);
export const SessionStoreBridgeResponseIdentitySchema = Type.Object(
  {
    type: Type.Literal("session-store.response"),
    requestId: BridgeIdSchema,
  },
  { additionalProperties: true },
);

export type SessionStoreOperation = Static<typeof SessionStoreOperationSchema>;
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
export type SessionStoreBridgeRequestIdentity = Static<
  typeof SessionStoreBridgeRequestIdentitySchema
>;
export type SessionStoreBridgeRequestOperation = Static<
  typeof SessionStoreBridgeRequestOperationSchema
>;
export type SessionStoreBridgeResponseIdentity = Static<
  typeof SessionStoreBridgeResponseIdentitySchema
>;
