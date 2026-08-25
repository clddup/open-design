import { mkdirSync } from "node:fs";
import { mkdir, open, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  isModelSelection,
  isRunContinuation,
  isRunFailure,
  isRunStatus,
  isRunStopReason,
  type RunStatePayload,
  type RunStopReason,
  type SessionModelSelection,
  type SessionRunContinuation,
  type SessionRunFailure,
} from "./run-state.js";
export type {
  ModelReasoningEffort,
  RunStopReason,
  SessionModelSelection,
  SessionRunContinuation,
  SessionRunFailure,
} from "./run-state.js";

export type JournalEventType =
  | "session.created"
  | "run.state"
  | "message.user"
  | "message.assistant"
  | "tool.requested"
  | "tool.progress"
  | "tool.completed"
  | "tool.failed"
  | "approval.requested"
  | "approval.resolved"
  | "design.revision"
  | "context.compacted";

export interface JournalEvent<T = unknown> {
  eventId: string;
  sessionId: string;
  runId?: string;
  sequence: number;
  type: JournalEventType;
  createdAt: string;
  payload: T;
}

export interface AssistantTimelineBlock {
  blockId: string;
  type: "text" | "reasoning_summary";
  text?: string;
  status?: "streaming" | "completed" | "omitted";
  summary?: string;
}

export type SessionAttachment =
  | {
      attachmentId: string;
      name: string;
      mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
      byteSize: number;
    }
  | {
      attachmentId: string;
      name: string;
      mimeType:
        | "application/pdf"
        | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        | "text/plain"
        | "text/markdown"
        | "text/csv"
        | "text/html"
        | "application/json"
        | "application/yaml";
      byteSize: number;
    }
  | {
      attachmentId: string;
      name: string;
      mimeType: "image/svg+xml";
      byteSize: number;
    };

interface TimelineBase {
  itemId: string;
  sessionId: string;
  runId?: string;
  sequence: number;
  createdAt: string;
  updatedAt: string;
}

export type SessionTimelineItem =
  | (TimelineBase & {
      type: "user.message";
      messageId: string;
      content: string;
      attachments?: SessionAttachment[];
      documentId: string;
      revision: number;
      scope: SelectionScope;
      mutationTarget?: DesignMutationTarget;
    })
  | (TimelineBase & {
      type: "assistant.message";
      messageId: string;
      blocks: AssistantTimelineBlock[];
    })
  | (TimelineBase & {
      type: "tool";
      toolCallId: string;
      toolName: string;
      input: unknown;
      risk: ToolRisk;
      status: "requested" | "running" | "completed" | "failed";
      progress?: number;
      progressMessage?: string;
      result?: unknown;
      error?: {
        code: string;
        message: string;
        retryable?: boolean;
        recoverable?: boolean;
        details?: unknown;
      };
      revision?: number;
      transactionId?: string;
    })
  | (TimelineBase & {
      type: "approval";
      approvalId: string;
      toolCallId: string;
      title: string;
      summary: string;
      status: "requested" | "resolved";
      decision?: ApprovalDecision;
      resolvedAt?: string;
    })
  | (TimelineBase & {
      type: "design.revision";
      documentId: string;
      previousRevision: number;
      revision: number;
      transactionId: string;
      toolCallId?: string;
    })
  | (TimelineBase & {
      type: "run";
      runId: string;
      status: "started" | "completed" | "cancelled" | "error" | "budget";
      startedAt: string;
      finishedAt?: string;
      stopReason?: RunStopReason;
      modelSelection?: SessionModelSelection;
      failure?: SessionRunFailure;
      continuation?: SessionRunContinuation;
    });

export type SelectionScope =
  | {
      kind: "selection";
      selectedNodeIds: string[];
      primaryNodeId?: string;
      pageId?: string;
    }
  | {
      kind: "page";
      selectedNodeIds: string[];
      primaryNodeId?: string;
      pageId: string;
    }
  | {
      kind: "document";
      selectedNodeIds: string[];
      primaryNodeId?: string;
      pageId?: string;
    };

export type DesignMutationTarget =
  { kind: "page"; pageId: string } | { kind: "document" };

export type ToolRisk = "read" | "design_write" | "external" | "destructive";
export type ApprovalDecision = "allow_once" | "allow_session" | "deny";
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

  read(sessionId: string): Promise<JournalEvent[]> {
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
          return isJournalEvent(candidate) ? [candidate] : [];
        } catch {
          return [];
        }
      }),
    );
  }

  async readTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
    return projectTimeline(sessionId, await this.read(sessionId));
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

  async read(sessionId: string): Promise<JournalEvent[]> {
    await waitForJsonlAppends(this.path);
    return readJsonlEvents(this.path, sessionId);
  }

  async readTimeline(sessionId: string): Promise<SessionTimelineItem[]> {
    return projectTimeline(sessionId, await this.read(sessionId));
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
          const payload = event.payload as RunStatePayload;
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
          current.pendingToolIds.add(
            (event.payload as ToolRequestedPayload).toolCallId,
          );
        }
        if (event.type === "tool.completed" || event.type === "tool.failed") {
          current.pendingToolIds.delete(
            (event.payload as ToolCompletedPayload | ToolFailedPayload)
              .toolCallId,
          );
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
  const items = new Map<string, SessionTimelineItem>();
  const events = sourceEvents
    .filter((event) => event.sessionId === sessionId)
    .sort(compareEvents);

  for (const event of events) {
    if (event.type === "run.state" && event.runId) {
      const payload = event.payload as RunStatePayload;
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
      const payload = event.payload as UserMessagePayload;
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
      const payload = event.payload as AssistantMessagePayload;
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
      const payload = event.payload as ToolRequestedPayload;
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
      const payload = event.payload as ToolProgressPayload;
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
      const payload = event.payload as ToolCompletedPayload;
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
      const payload = event.payload as ToolFailedPayload;
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
      const payload = event.payload as ApprovalRequestedPayload;
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
      const payload = event.payload as ApprovalResolvedPayload;
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
      const payload = event.payload as DesignRevisionPayload;
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

  return [...items.values()].sort(
    (left, right) =>
      left.sequence - right.sequence || left.itemId.localeCompare(right.itemId),
  );
}

function projectEvents(
  sessionId: string,
  events: JournalEvent[],
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

  for (const event of events.sort(compareEvents)) {
    projection.lastSequence = Math.max(projection.lastSequence, event.sequence);
    if (event.type === "run.state" && event.runId) {
      const payload = event.payload as RunStatePayload;
      if (payload.status === "started") projection.activeRunId = event.runId;
      if (payload.status !== "started") delete projection.activeRunId;
    }
    if (event.type === "message.user" || event.type === "message.assistant") {
      const payload = event.payload as { messageId: string; revision?: number };
      messages.add(payload.messageId);
      if (event.type === "message.user" && payload.revision !== undefined) {
        projection.latestRevision = Math.max(
          projection.latestRevision ?? 0,
          payload.revision,
        );
      }
    }
    if (event.type === "tool.requested") {
      const payload = event.payload as ToolRequestedPayload;
      toolCalls.add(payload.toolCallId);
    }
    if (event.type === "design.revision") {
      const payload = event.payload as DesignRevisionPayload;
      projection.latestRevision = Math.max(
        projection.latestRevision ?? 0,
        payload.revision,
      );
    }
    if (event.type === "context.compacted") {
      const payload = event.payload as ContextCompactedPayload;
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
): Promise<JournalEvent[]> {
  return (await readAllJsonlEvents(path)).filter(
    (event) => event.sessionId === sessionId,
  );
}

async function readAllJsonlEvents(path: string): Promise<JournalEvent[]> {
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
        return isJournalEvent(candidate) ? [candidate] : [];
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
  if (!isJournalEvent(value)) throw new TypeError("Invalid journal event");
}

function isJournalEvent(value: unknown): value is JournalEvent {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value.eventId) ||
    !isNonEmptyString(value.sessionId) ||
    (value.runId !== undefined && !isNonEmptyString(value.runId)) ||
    !Number.isInteger(value.sequence) ||
    (value.sequence as number) < 1 ||
    !isNonEmptyString(value.createdAt) ||
    !isJournalEventType(value.type) ||
    !isRecord(value.payload)
  ) {
    return false;
  }

  const payload = value.payload;
  switch (value.type) {
    case "session.created":
      return Object.keys(payload).length === 0;
    case "run.state":
      return (
        isNonEmptyString(value.runId) &&
        isRunStatus(payload.status) &&
        isNonEmptyString(payload.startedAt) &&
        optionalString(payload.finishedAt) &&
        (payload.stopReason === undefined ||
          isRunStopReason(payload.stopReason)) &&
        (payload.modelSelection === undefined ||
          isModelSelection(payload.modelSelection)) &&
        (payload.failure === undefined ||
          (payload.status === "error" &&
            payload.stopReason === "error" &&
            isRunFailure(payload.failure))) &&
        (payload.continuation === undefined ||
          isRunContinuation(payload.continuation))
      );
    case "message.user":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.messageId) &&
        isNonEmptyString(payload.content) &&
        (payload.attachments === undefined ||
          (Array.isArray(payload.attachments) &&
            payload.attachments.length <= 6 &&
            payload.attachments.every(isAttachment))) &&
        isNonEmptyString(payload.documentId) &&
        isRevision(payload.revision) &&
        isSelectionScope(payload.scope) &&
        (payload.mutationTarget === undefined ||
          isDesignMutationTarget(payload.mutationTarget))
      );
    case "message.assistant":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.messageId) &&
        Array.isArray(payload.blocks) &&
        payload.blocks.every(isAssistantBlock)
      );
    case "tool.requested":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.toolCallId) &&
        isNonEmptyString(payload.toolName) &&
        isToolRisk(payload.risk) &&
        "input" in payload
      );
    case "tool.progress":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.toolCallId) &&
        typeof payload.message === "string" &&
        typeof payload.progress === "number" &&
        payload.progress >= 0 &&
        payload.progress <= 1
      );
    case "tool.completed":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.toolCallId) &&
        "result" in payload &&
        (payload.revision === undefined || isRevision(payload.revision)) &&
        optionalString(payload.transactionId)
      );
    case "tool.failed":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.toolCallId) &&
        isNonEmptyString(payload.code) &&
        isNonEmptyString(payload.message) &&
        (payload.retryable === undefined ||
          typeof payload.retryable === "boolean") &&
        (payload.recoverable === undefined ||
          typeof payload.recoverable === "boolean") &&
        (payload.details === undefined || isJsonCompatible(payload.details))
      );
    case "approval.requested":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.approvalId) &&
        isNonEmptyString(payload.toolCallId) &&
        isNonEmptyString(payload.title) &&
        typeof payload.summary === "string"
      );
    case "approval.resolved":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.approvalId) &&
        isNonEmptyString(payload.toolCallId) &&
        isApprovalDecision(payload.decision) &&
        isNonEmptyString(payload.resolvedAt)
      );
    case "design.revision":
      return (
        isNonEmptyString(value.runId) &&
        isNonEmptyString(payload.documentId) &&
        isRevision(payload.previousRevision) &&
        isRevision(payload.revision) &&
        isNonEmptyString(payload.transactionId) &&
        optionalString(payload.toolCallId)
      );
    case "context.compacted":
      return (
        Number.isInteger(payload.fromSequence) &&
        (payload.fromSequence as number) >= 1 &&
        Number.isInteger(payload.toSequence) &&
        (payload.toSequence as number) >= (payload.fromSequence as number) &&
        optionalString(payload.summary)
      );
  }
}

function isSelectionScope(value: unknown): value is SelectionScope {
  if (!isRecord(value) || !Array.isArray(value.selectedNodeIds)) return false;
  if (
    value.selectedNodeIds.length > 512 ||
    !value.selectedNodeIds.every(isNonEmptyString) ||
    new Set(value.selectedNodeIds).size !== value.selectedNodeIds.length
  ) {
    return false;
  }
  if (
    (value.kind === "selection" && value.selectedNodeIds.length === 0) ||
    (value.kind === "page" && !isNonEmptyString(value.pageId)) ||
    (value.kind !== "selection" &&
      value.kind !== "page" &&
      value.kind !== "document") ||
    !optionalString(value.pageId) ||
    !optionalString(value.primaryNodeId)
  ) {
    return false;
  }
  const primaryNodeId = value.primaryNodeId;
  return (
    primaryNodeId === undefined ||
    (typeof primaryNodeId === "string" &&
      value.selectedNodeIds.includes(primaryNodeId))
  );
}

function isDesignMutationTarget(value: unknown): value is DesignMutationTarget {
  return (
    isRecord(value) &&
    ((value.kind === "document" && Object.keys(value).length === 1) ||
      (value.kind === "page" &&
        isNonEmptyString(value.pageId) &&
        Object.keys(value).length === 2))
  );
}

function isAssistantBlock(value: unknown): value is AssistantTimelineBlock {
  if (!isRecord(value) || !isNonEmptyString(value.blockId)) return false;
  if (value.type === "text") return typeof value.text === "string";
  return (
    value.type === "reasoning_summary" &&
    (value.status === "streaming" ||
      value.status === "completed" ||
      value.status === "omitted") &&
    optionalString(value.summary)
  );
}

function isJournalEventType(value: unknown): value is JournalEventType {
  return (
    value === "session.created" ||
    value === "run.state" ||
    value === "message.user" ||
    value === "message.assistant" ||
    value === "tool.requested" ||
    value === "tool.progress" ||
    value === "tool.completed" ||
    value === "tool.failed" ||
    value === "approval.requested" ||
    value === "approval.resolved" ||
    value === "design.revision" ||
    value === "context.compacted"
  );
}

function isToolRisk(value: unknown): value is ToolRisk {
  return (
    value === "read" ||
    value === "design_write" ||
    value === "external" ||
    value === "destructive"
  );
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  return (
    value === "allow_once" || value === "allow_session" || value === "deny"
  );
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonCompatible(value: unknown, depth = 0): boolean {
  if (depth > 12) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) {
    return (
      value.length <= 256 &&
      value.every((child) => isJsonCompatible(child, depth + 1))
    );
  }
  if (!isRecord(value) || Object.keys(value).length > 256) return false;
  return Object.values(value).every((child) =>
    isJsonCompatible(child, depth + 1),
  );
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

interface UserMessagePayload {
  messageId: string;
  content: string;
  attachments?: SessionAttachment[];
  documentId: string;
  revision: number;
  scope: SelectionScope;
  mutationTarget?: DesignMutationTarget;
}

function isAttachment(value: unknown): value is SessionAttachment {
  if (!isRecord(value) || typeof value.attachmentId !== "string") return false;
  const kind = value.attachmentId.startsWith("image_")
    ? "image"
    : value.attachmentId.startsWith("file_")
      ? "document"
      : value.attachmentId.startsWith("svg_")
        ? "svg"
        : null;
  const validId =
    kind === "image"
      ? /^image_[a-f0-9]{64}$/.test(value.attachmentId)
      : kind === "document"
        ? /^file_[a-f0-9]{64}$/.test(value.attachmentId)
        : kind === "svg"
          ? /^svg_[a-f0-9]{64}$/.test(value.attachmentId)
          : false;
  const imageMimeTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const documentMimeTypes = [
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "text/markdown",
    "text/csv",
    "text/html",
    "application/json",
    "application/yaml",
  ];
  return (
    validId &&
    Object.keys(value).length === 4 &&
    Object.keys(value).every((key) =>
      ["attachmentId", "name", "mimeType", "byteSize"].includes(key),
    ) &&
    isNonEmptyString(value.name) &&
    value.name.length <= 255 &&
    (kind === "image"
      ? imageMimeTypes.includes(String(value.mimeType))
      : kind === "document"
        ? documentMimeTypes.includes(String(value.mimeType))
        : value.mimeType === "image/svg+xml") &&
    Number.isInteger(value.byteSize) &&
    Number(value.byteSize) > 0 &&
    Number(value.byteSize) <= 16 * 1024 * 1024
  );
}

interface AssistantMessagePayload {
  messageId: string;
  blocks: AssistantTimelineBlock[];
}

interface ToolRequestedPayload {
  toolCallId: string;
  toolName: string;
  input: unknown;
  risk: ToolRisk;
}

interface ToolProgressPayload {
  toolCallId: string;
  message: string;
  progress: number;
}

interface ToolCompletedPayload {
  toolCallId: string;
  result: unknown;
  revision?: number;
  transactionId?: string;
}

interface ToolFailedPayload {
  toolCallId: string;
  code: string;
  message: string;
  retryable?: boolean;
  recoverable?: boolean;
  details?: unknown;
}

interface ApprovalRequestedPayload {
  approvalId: string;
  toolCallId: string;
  title: string;
  summary: string;
}

interface ApprovalResolvedPayload {
  approvalId: string;
  toolCallId: string;
  decision: ApprovalDecision;
  resolvedAt: string;
}

interface DesignRevisionPayload {
  documentId: string;
  previousRevision: number;
  revision: number;
  transactionId: string;
  toolCallId?: string;
}

interface ContextCompactedPayload {
  fromSequence: number;
  toSequence: number;
  summary?: string;
}
