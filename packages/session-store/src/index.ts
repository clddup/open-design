import { mkdirSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  AgentToolFailureDetailsContract,
  DurableTimelineEventContract,
  SessionTimelineItemContract,
  TrustedToolFailureContract,
  formatRuntimeContractFailure,
  type AssistantTimelineBlock,
  type DurableTimelineEvent,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { normalizeAssistantTimelineBlocks } from "./durable-assistant-blocks.js";

export { normalizeAssistantTimelineBlocks } from "./durable-assistant-blocks.js";

export type JournalEventType = DurableTimelineEvent["type"];

export interface JournalEvent<T = unknown> {
  eventId: string;
  sessionId: string;
  runId?: string;
  sequence: number;
  type: JournalEventType;
  createdAt: string;
  payload: T;
}

type RunStatePayload = Extract<
  DurableTimelineEvent,
  { type: "run.state" }
>["payload"];
type TimelineBase = Pick<
  SessionTimelineItem,
  "itemId" | "sessionId" | "runId" | "sequence" | "createdAt" | "updatedAt"
>;

export interface SessionProjection {
  sessionId: string;
  lastSequence: number;
  activeRunId?: string;
  latestRevision?: number;
  messageCount: number;
  toolCallCount: number;
  compactedRanges: Array<{ fromSequence: number; toSequence: number }>;
}

export interface SessionStore {
  append<T>(event: JournalEvent<T>): Promise<void>;
  appendNext?<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>>;
  read(sessionId: string): Promise<JournalEvent[]>;
  readTimeline(sessionId: string): Promise<SessionTimelineItem[]>;
  project(sessionId: string): Promise<SessionProjection>;
}

export class SqliteSessionStore implements SessionStore {
  readonly #database: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS journal_events (
        event_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        run_id TEXT,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        UNIQUE(session_id, sequence)
      );
      CREATE INDEX IF NOT EXISTS journal_events_session_sequence
        ON journal_events(session_id, sequence);
    `);
  }

  append<T>(event: JournalEvent<T>): Promise<void> {
    assertJournalEvent(event);
    this.#insert(event);
    return Promise.resolve();
  }

  appendNext<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>> {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const row = this.#database
        .prepare(
          `
          SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
          FROM journal_events
          WHERE session_id = ?
        `,
        )
        .get(sessionId) as { next_sequence: number };
      const event = createEvent(row.next_sequence);
      assertAllocatedEvent(event, sessionId, row.next_sequence);
      this.#insert(event);
      this.#database.exec("COMMIT");
      return Promise.resolve(event);
    } catch (error) {
      try {
        this.#database.exec("ROLLBACK");
      } catch {
        // Preserve the original allocation or insertion error.
      }
      throw error;
    }
  }

  read(sessionId: string): Promise<DurableTimelineEvent[]> {
    const rows = this.#database
      .prepare(
        `
        SELECT event_id, session_id, run_id, sequence, type, created_at, payload_json
        FROM journal_events
        WHERE session_id = ?
        ORDER BY sequence ASC, event_id ASC
      `,
      )
      .all(sessionId) as Array<{
      event_id: string;
      session_id: string;
      run_id: string | null;
      sequence: number;
      type: string;
      created_at: string;
      payload_json: string;
    }>;

    return Promise.resolve(
      rows.flatMap((row) => {
        try {
          const candidate = {
            eventId: row.event_id,
            sessionId: row.session_id,
            ...(row.run_id ? { runId: row.run_id } : {}),
            sequence: row.sequence,
            type: row.type,
            createdAt: row.created_at,
            payload: JSON.parse(row.payload_json) as unknown,
          };
          const parsed = parsePersistedJournalEvent(candidate);
          return parsed === undefined ? [] : [parsed];
        } catch {
          return [];
        }
      }),
    );
  }

  async readTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
    return projectValidatedTimeline(sessionId, await this.read(sessionId));
  }

  async project(sessionId: string): Promise<SessionProjection> {
    return projectEvents(sessionId, await this.read(sessionId));
  }

  close(): void {
    this.#database.close();
  }

  #insert<T>(event: JournalEvent<T>): void {
    this.#database
      .prepare(
        `
        INSERT INTO journal_events (
          event_id, session_id, run_id, sequence, type, created_at, payload_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        event.eventId,
        event.sessionId,
        event.runId ?? null,
        event.sequence,
        event.type,
        event.createdAt,
        JSON.stringify(event.payload),
      );
  }
}

export class JsonlSessionStore implements SessionStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  append<T>(event: JournalEvent<T>): Promise<void> {
    assertJournalEvent(event);
    return enqueueJsonl(this.path, async () => {
      await appendJsonlEvent(this.path, event);
    });
  }

  appendNext<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>> {
    return enqueueJsonl(this.path, async () => {
      const events = await readJsonlEvents(this.path, sessionId);
      const nextSequence =
        events.reduce(
          (maximum, event) => Math.max(maximum, event.sequence),
          0,
        ) + 1;
      const event = createEvent(nextSequence);
      assertAllocatedEvent(event, sessionId, nextSequence);
      await appendJsonlEvent(this.path, event);
      return event;
    });
  }

  async read(sessionId: string): Promise<DurableTimelineEvent[]> {
    await waitForJsonlAppends(this.path);
    return readJsonlEvents(this.path, sessionId);
  }

  async readTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
    return projectValidatedTimeline(sessionId, await this.read(sessionId));
  }

  async project(sessionId: string): Promise<SessionProjection> {
    return projectEvents(sessionId, await this.read(sessionId));
  }

  reconcileInterruptedRuns(
    finishedAt = new Date().toISOString(),
  ): Promise<{ recoveredRuns: number; recoveredTools: number }> {
    if (Number.isNaN(new Date(finishedAt).valueOf())) {
      throw new TypeError("Interrupted Run recovery requires a timestamp");
    }
    return enqueueJsonl(this.path, async () => {
      const events = await readAllJsonlEvents(this.path);
      const runs = new Map<
        string,
        {
          sessionId: string;
          runId: string;
          startedAt: string;
          latestStatus: RunStatePayload["status"];
          pendingToolIds: Set<string>;
        }
      >();
      const nextSequenceBySession = new Map<string, number>();
      for (const event of events) {
        nextSequenceBySession.set(
          event.sessionId,
          Math.max(
            nextSequenceBySession.get(event.sessionId) ?? 0,
            event.sequence,
          ),
        );
        if (!event.runId) continue;
        const key = `${event.sessionId}\u0000${event.runId}`;
        if (event.type === "run.state") {
          const payload = event.payload;
          const current = runs.get(key);
          runs.set(key, {
            sessionId: event.sessionId,
            runId: event.runId,
            startedAt: current?.startedAt ?? payload.startedAt,
            latestStatus: payload.status,
            pendingToolIds: current?.pendingToolIds ?? new Set(),
          });
          continue;
        }
        const current = runs.get(key);
        if (!current) continue;
        if (event.type === "tool.requested") {
          current.pendingToolIds.add(event.payload.toolCallId);
        }
        if (event.type === "tool.completed" || event.type === "tool.failed") {
          current.pendingToolIds.delete(event.payload.toolCallId);
        }
      }

      let recoveredRuns = 0;
      let recoveredTools = 0;
      const interrupted = [...runs.values()]
        .filter((run) => run.latestStatus === "started")
        .sort(
          (left, right) =>
            left.sessionId.localeCompare(right.sessionId) ||
            left.runId.localeCompare(right.runId),
        );
      for (const run of interrupted) {
        let nextSequence = nextSequenceBySession.get(run.sessionId) ?? 0;
        for (const toolCallId of [...run.pendingToolIds].sort()) {
          nextSequence += 1;
          const event: JournalEvent<ToolFailedPayload> = {
            eventId: `${run.runId}_recovery_${nextSequence}`,
            sessionId: run.sessionId,
            runId: run.runId,
            sequence: nextSequence,
            type: "tool.failed",
            createdAt: finishedAt,
            payload: {
              toolCallId,
              code: "run_interrupted",
              message: "Tool call was interrupted when OpenDesign stopped",
            },
          };
          assertJournalEvent(event);
          await appendJsonlEvent(this.path, event);
          recoveredTools += 1;
        }
        nextSequence += 1;
        const event: JournalEvent<RunStatePayload> = {
          eventId: `${run.runId}_recovery_${nextSequence}`,
          sessionId: run.sessionId,
          runId: run.runId,
          sequence: nextSequence,
          type: "run.state",
          createdAt: finishedAt,
          payload: {
            status: "error",
            startedAt: run.startedAt,
            finishedAt,
            stopReason: "error",
            failure: {
              code: "run_interrupted",
              message: "Run was interrupted when OpenDesign stopped",
              retryable: true,
            },
          },
        };
        assertJournalEvent(event);
        await appendJsonlEvent(this.path, event);
        nextSequenceBySession.set(run.sessionId, nextSequence);
        recoveredRuns += 1;
      }
      return { recoveredRuns, recoveredTools };
    });
  }
}

export function projectTimeline(
  sessionId: string,
  sourceEvents: JournalEvent[],
): SessionTimelineItem[] {
  return projectValidatedTimeline(
    sessionId,
    sourceEvents.map(requireJournalEvent),
  );
}

function projectValidatedTimeline(
  sessionId: string,
  sourceEvents: readonly DurableTimelineEvent[],
): SessionTimelineItem[] {
  const items = new Map<string, SessionTimelineItem>();
  const events = sourceEvents
    .filter((event) => event.sessionId === sessionId)
    .sort(compareEvents);

  for (const event of events) {
    if (event.type === "run.state" && event.runId) {
      const payload = event.payload;
      const key = `run:${event.runId}`;
      const current = items.get(key);
      if (current?.type === "run") {
        items.set(key, {
          ...current,
          // A Run timeline item represents its latest lifecycle fact. When the
          // Run reaches a terminal state, its presentation order must follow
          // that terminal journal event instead of retaining the start event's
          // sequence and appearing to rewrite an earlier Conversation entry.
          sequence: event.sequence,
          status: payload.status,
          updatedAt: event.createdAt,
          ...(payload.finishedAt === undefined
            ? {}
            : { finishedAt: payload.finishedAt }),
          ...(payload.stopReason === undefined
            ? {}
            : { stopReason: payload.stopReason }),
          ...(payload.modelSelection === undefined
            ? {}
            : { modelSelection: payload.modelSelection }),
          ...(payload.failure === undefined
            ? {}
            : { failure: structuredClone(payload.failure) }),
          ...(payload.continuation === undefined
            ? {}
            : { continuation: structuredClone(payload.continuation) }),
        });
      } else {
        items.set(key, {
          ...timelineBase(key, event),
          type: "run",
          runId: event.runId,
          status: payload.status,
          startedAt: payload.startedAt,
          ...(payload.finishedAt === undefined
            ? {}
            : { finishedAt: payload.finishedAt }),
          ...(payload.stopReason === undefined
            ? {}
            : { stopReason: payload.stopReason }),
          ...(payload.modelSelection === undefined
            ? {}
            : { modelSelection: payload.modelSelection }),
          ...(payload.failure === undefined
            ? {}
            : { failure: structuredClone(payload.failure) }),
          ...(payload.continuation === undefined
            ? {}
            : { continuation: structuredClone(payload.continuation) }),
        });
      }
      continue;
    }

    if (event.type === "message.user" && event.runId) {
      const payload = event.payload;
      const key = `message:${payload.messageId}`;
      items.set(key, {
        ...timelineBase(key, event),
        type: "user.message",
        runId: event.runId,
        messageId: payload.messageId,
        content: payload.content,
        ...(payload.attachments === undefined
          ? {}
          : { attachments: payload.attachments }),
        documentId: payload.documentId,
        revision: payload.revision,
        scope: payload.scope,
        ...(payload.mutationTarget === undefined
          ? {}
          : { mutationTarget: payload.mutationTarget }),
      });
      continue;
    }

    if (event.type === "message.assistant" && event.runId) {
      const payload = event.payload;
      const key = `message:${payload.messageId}`;
      const current = items.get(key);
      items.set(key, {
        ...(current?.type === "assistant.message"
          ? { ...current, updatedAt: event.createdAt }
          : timelineBase(key, event)),
        type: "assistant.message",
        runId: event.runId,
        messageId: payload.messageId,
        blocks: payload.blocks,
      });
      continue;
    }

    if (event.type === "tool.requested" && event.runId) {
      const payload = event.payload;
      const key = `tool:${payload.toolCallId}`;
      if (!items.has(key)) {
        items.set(key, {
          ...timelineBase(key, event),
          type: "tool",
          runId: event.runId,
          toolCallId: payload.toolCallId,
          toolName: payload.toolName,
          input: payload.input,
          risk: payload.risk,
          status: "requested",
        });
      }
      continue;
    }

    if (event.type === "tool.progress") {
      const payload = event.payload;
      const key = `tool:${payload.toolCallId}`;
      const current = items.get(key);
      if (current?.type === "tool") {
        items.set(key, {
          ...current,
          status: "running",
          progress: payload.progress,
          progressMessage: payload.message,
          updatedAt: event.createdAt,
        });
      }
      continue;
    }

    if (event.type === "tool.completed") {
      const payload = event.payload;
      const key = `tool:${payload.toolCallId}`;
      const current = items.get(key);
      if (current?.type === "tool") {
        items.set(key, {
          ...current,
          status: "completed",
          result: payload.result,
          updatedAt: event.createdAt,
          ...(payload.revision === undefined
            ? {}
            : { revision: payload.revision }),
          ...(payload.transactionId === undefined
            ? {}
            : { transactionId: payload.transactionId }),
        });
      }
      continue;
    }

    if (event.type === "tool.failed") {
      const payload = event.payload;
      const key = `tool:${payload.toolCallId}`;
      const current = items.get(key);
      if (current?.type === "tool") {
        items.set(key, {
          ...current,
          status: "failed",
          error: {
            code: payload.code,
            message: payload.message,
            ...(payload.retryable === undefined
              ? {}
              : { retryable: payload.retryable }),
            ...(payload.recoverable === undefined
              ? {}
              : { recoverable: payload.recoverable }),
            ...(payload.details === undefined
              ? {}
              : { details: payload.details }),
          },
          updatedAt: event.createdAt,
        });
      }
      for (const [approvalKey, item] of items) {
        if (
          item.type === "approval" &&
          item.toolCallId === payload.toolCallId &&
          item.status === "requested"
        ) {
          items.set(approvalKey, {
            ...item,
            status: "resolved",
            resolvedAt: event.createdAt,
            updatedAt: event.createdAt,
          });
        }
      }
      continue;
    }

    if (event.type === "approval.requested" && event.runId) {
      const payload = event.payload;
      const key = `approval:${payload.approvalId}`;
      if (!items.has(key)) {
        items.set(key, {
          ...timelineBase(key, event),
          type: "approval",
          runId: event.runId,
          approvalId: payload.approvalId,
          toolCallId: payload.toolCallId,
          title: payload.title,
          summary: payload.summary,
          status: "requested",
        });
      }
      continue;
    }

    if (event.type === "approval.resolved") {
      const payload = event.payload;
      const key = `approval:${payload.approvalId}`;
      const current = items.get(key);
      if (current?.type === "approval") {
        items.set(key, {
          ...current,
          status: "resolved",
          decision: payload.decision,
          resolvedAt: payload.resolvedAt,
          updatedAt: event.createdAt,
        });
      }
      continue;
    }

    if (event.type === "design.revision" && event.runId) {
      const payload = event.payload;
      const key = `revision:${payload.transactionId}`;
      items.set(key, {
        ...timelineBase(key, event),
        type: "design.revision",
        runId: event.runId,
        documentId: payload.documentId,
        previousRevision: payload.previousRevision,
        revision: payload.revision,
        transactionId: payload.transactionId,
        ...(payload.toolCallId === undefined
          ? {}
          : { toolCallId: payload.toolCallId }),
      });
    }
  }

  return [...items.values()]
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.itemId.localeCompare(right.itemId),
    )
    .map(requireTimelineItem);
}

function projectEvents(
  sessionId: string,
  events: readonly DurableTimelineEvent[],
): SessionProjection {
  const projection: SessionProjection = {
    sessionId,
    lastSequence: 0,
    messageCount: 0,
    toolCallCount: 0,
    compactedRanges: [],
  };
  const messages = new Set<string>();
  const toolCalls = new Set<string>();

  for (const event of [...events].sort(compareEvents)) {
    projection.lastSequence = Math.max(projection.lastSequence, event.sequence);
    if (event.type === "run.state" && event.runId) {
      const payload = event.payload;
      if (payload.status === "started") projection.activeRunId = event.runId;
      if (payload.status !== "started") delete projection.activeRunId;
    }
    if (event.type === "message.user") {
      messages.add(event.payload.messageId);
      projection.latestRevision = Math.max(
        projection.latestRevision ?? 0,
        event.payload.revision,
      );
    }
    if (event.type === "message.assistant") {
      messages.add(event.payload.messageId);
    }
    if (event.type === "tool.requested") {
      const payload = event.payload;
      toolCalls.add(payload.toolCallId);
    }
    if (event.type === "design.revision") {
      const payload = event.payload;
      projection.latestRevision = Math.max(
        projection.latestRevision ?? 0,
        payload.revision,
      );
    }
    if (event.type === "context.compacted") {
      const payload = event.payload;
      projection.compactedRanges.push({
        fromSequence: payload.fromSequence,
        toSequence: payload.toSequence,
      });
    }
  }

  projection.messageCount = messages.size;
  projection.toolCallCount = toolCalls.size;
  return projection;
}

function timelineBase(itemId: string, event: JournalEvent): TimelineBase {
  return {
    itemId,
    sessionId: event.sessionId,
    ...(event.runId === undefined ? {} : { runId: event.runId }),
    sequence: event.sequence,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
  };
}

function compareEvents(left: JournalEvent, right: JournalEvent): number {
  return (
    left.sequence - right.sequence ||
    left.createdAt.localeCompare(right.createdAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

const jsonlAppendQueues = new Map<string, Promise<void>>();

function enqueueJsonl<T>(
  path: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = jsonlAppendQueues.get(path) ?? Promise.resolve();
  const result = previous.then(operation);
  const queued = result.then(
    () => undefined,
    () => undefined,
  );
  jsonlAppendQueues.set(path, queued);
  void queued.then(() => {
    if (jsonlAppendQueues.get(path) === queued) jsonlAppendQueues.delete(path);
  });
  return result;
}

async function waitForJsonlAppends(path: string): Promise<void> {
  await jsonlAppendQueues.get(path);
}

async function appendJsonlEvent<T>(
  path: string,
  event: JournalEvent<T>,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const handle = await open(path, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readJsonlEvents(
  path: string,
  sessionId: string,
): Promise<DurableTimelineEvent[]> {
  return (await readAllJsonlEvents(path)).filter(
    (event) => event.sessionId === sessionId,
  );
}

async function readAllJsonlEvents(
  path: string,
): Promise<DurableTimelineEvent[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }

  return content
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const candidate: unknown = JSON.parse(line);
        const parsed = parsePersistedJournalEvent(candidate);
        return parsed === undefined ? [] : [parsed];
      } catch {
        return [];
      }
    })
    .sort(compareEvents);
}

function assertAllocatedEvent<T>(
  event: JournalEvent<T>,
  sessionId: string,
  sequence: number,
): void {
  assertJournalEvent(event);
  if (event.sessionId !== sessionId || event.sequence !== sequence) {
    throw new TypeError(
      "Allocated journal event must use the requested session and sequence",
    );
  }
}

function assertJournalEvent(value: unknown): asserts value is JournalEvent {
  requireJournalEvent(value);
}

function requireJournalEvent(value: unknown): DurableTimelineEvent {
  const parsed = DurableTimelineEventContract.parse(value);
  if (!parsed.ok) {
    throw new TypeError(
      formatRuntimeContractFailure("Journal event", parsed.issues),
    );
  }
  return parsed.value;
}

function requireTimelineItem(value: unknown): SessionTimelineItem {
  const parsed = SessionTimelineItemContract.parse(value);
  if (!parsed.ok) {
    throw new TypeError(
      formatRuntimeContractFailure("Session timeline item", parsed.issues),
    );
  }
  return parsed.value;
}

function parsePersistedJournalEvent(
  value: unknown,
): DurableTimelineEvent | undefined {
  const recovered = recoverPersistedEvent(value);
  const parsed = DurableTimelineEventContract.parse(recovered);
  return parsed.ok ? parsed.value : undefined;
}

function recoverPersistedEvent(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.payload)) return value;
  if (
    value.type === "message.assistant" &&
    Array.isArray(value.payload.blocks)
  ) {
    try {
      return {
        ...value,
        payload: {
          ...value.payload,
          blocks: normalizeAssistantTimelineBlocks(
            value.payload.blocks as AssistantTimelineBlock[],
          ),
        },
      };
    } catch {
      return value;
    }
  }
  if (value.type !== "tool.failed") return value;
  const payload = { ...value.payload };
  if (typeof payload.message === "string" && payload.message.length > 20_000) {
    payload.message = truncateLegacyToolMessage(payload.message);
  }
  if (
    payload.details !== undefined &&
    !AgentToolFailureDetailsContract.parse(payload.details).ok
  ) {
    delete payload.details;
  }
  if (
    payload.details !== undefined &&
    !TrustedToolFailureContract.parse({
      code: payload.code,
      message: payload.message,
      retryable: payload.retryable ?? false,
      recoverable: payload.recoverable ?? false,
      details: payload.details,
    }).ok
  ) {
    delete payload.details;
  }
  return { ...value, payload };
}

function truncateLegacyToolMessage(message: string): string {
  const suffix = "\n[OpenDesign truncated legacy tool diagnostics]";
  return `${message.slice(0, 20_000 - suffix.length)}${suffix}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

type ToolFailedPayload = Extract<
  DurableTimelineEvent,
  { type: "tool.failed" }
>["payload"];
