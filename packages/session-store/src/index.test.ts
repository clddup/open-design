import { appendFile, mkdir, mkdtemp, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_REASONING_SUMMARY_CHARACTERS } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import {
  JsonlSessionStore,
  SqliteSessionStore,
  projectTimeline,
  type JournalEvent,
  type SessionStore,
  type SessionStoreReadDiagnostic,
} from "./index.js";

function event(
  sequence: number,
  type: JournalEvent["type"],
  payload: unknown,
): JournalEvent {
  return {
    eventId: `event_${sequence}`,
    sessionId: "session_1",
    runId: "run_1",
    sequence,
    type,
    createdAt: new Date(sequence).toISOString(),
    payload,
  };
}

const events: JournalEvent[] = [
  event(1, "run.state", {
    status: "started",
    startedAt: new Date(1).toISOString(),
  }),
  event(2, "message.user", {
    messageId: "message_user_1",
    content: "Align this layer",
    attachments: [
      {
        attachmentId: `file_${"a".repeat(64)}`,
        name: "product-brief.md",
        mimeType: "text/markdown",
        byteSize: 2048,
      },
      {
        attachmentId: `svg_${"b".repeat(64)}`,
        name: "brand-mark.svg",
        mimeType: "image/svg+xml",
        byteSize: 4096,
      },
    ],
    documentId: "document_1",
    revision: 4,
    scope: {
      kind: "selection",
      selectedNodeIds: ["node_1"],
      primaryNodeId: "node_1",
    },
  }),
  event(3, "message.assistant", {
    messageId: "message_assistant_1",
    blocks: [{ blockId: "block_1", type: "text", text: "I will align it." }],
  }),
  event(4, "tool.requested", {
    toolCallId: "tool_1",
    toolName: "design.align",
    input: { alignment: "left" },
    risk: "design_write",
  }),
  event(5, "tool.progress", {
    toolCallId: "tool_1",
    message: "Applying transaction",
    progress: 0.5,
  }),
  event(6, "tool.completed", {
    toolCallId: "tool_1",
    result: { changed: true },
    revision: 5,
    transactionId: "transaction_1",
  }),
  event(7, "design.revision", {
    documentId: "document_1",
    previousRevision: 4,
    revision: 5,
    transactionId: "transaction_1",
    toolCallId: "tool_1",
  }),
  event(8, "context.compacted", {
    fromSequence: 1,
    toSequence: 3,
    summary: "Earlier context summary",
  }),
  event(9, "run.state", {
    status: "completed",
    startedAt: new Date(1).toISOString(),
    finishedAt: new Date(9).toISOString(),
    stopReason: "complete",
  }),
];

async function expectRecoveredTimeline(store: SessionStore): Promise<void> {
  for (const journalEvent of events) await store.append(journalEvent);

  const raw = await store.read("session_1");
  const timeline = await store.readTimeline("session_1");
  const projection = await store.project("session_1");

  expect(raw).toEqual(events);
  expect(timeline).toHaveLength(5);
  expect(timeline.find((item) => item.type === "user.message")).toMatchObject({
    content: "Align this layer",
    attachments: [
      {
        attachmentId: `file_${"a".repeat(64)}`,
        mimeType: "text/markdown",
      },
      {
        attachmentId: `svg_${"b".repeat(64)}`,
        mimeType: "image/svg+xml",
      },
    ],
    revision: 4,
    scope: { selectedNodeIds: ["node_1"] },
  });
  expect(
    timeline.find((item) => item.type === "assistant.message"),
  ).toMatchObject({
    blocks: [{ type: "text", text: "I will align it." }],
  });
  expect(timeline.find((item) => item.type === "tool")).toMatchObject({
    itemId: "tool:run_1:tool_1",
    status: "completed",
    progress: 0.5,
    progressMessage: "Applying transaction",
    result: { changed: true },
    revision: 5,
    transactionId: "transaction_1",
  });
  expect(
    timeline.find((item) => item.type === "design.revision"),
  ).toMatchObject({
    revision: 5,
    toolCallId: "tool_1",
    transactionId: "transaction_1",
  });
  expect(timeline.find((item) => item.type === "run")).toMatchObject({
    sequence: 9,
    status: "completed",
    stopReason: "complete",
  });
  expect(projection).toMatchObject({
    lastSequence: 9,
    latestRevision: 5,
    messageCount: 2,
    toolCallCount: 1,
    compactedRanges: [{ fromSequence: 1, toSequence: 3 }],
  });
  expect(projection.activeRunId).toBeUndefined();
}

async function expectHigherHostRevisionProjection(
  store: SessionStore,
): Promise<void> {
  await store.append(
    event(1, "message.user", {
      messageId: "message_revision_1",
      content: "Continue after host changes",
      documentId: "document_1",
      revision: 9,
      scope: { kind: "document", selectedNodeIds: [] },
    }),
  );
  await store.append(
    event(2, "design.revision", {
      documentId: "document_1",
      previousRevision: 4,
      revision: 5,
      transactionId: "transaction_old",
    }),
  );

  await expect(store.project("session_1")).resolves.toMatchObject({
    latestRevision: 9,
  });
}

describe("session journal recovery", () => {
  it("preserves automatic continuation provenance on the durable Run", () => {
    const continuation = {
      parentRunId: "run_parent",
      rootRunId: "run_root",
      attempt: 2 as const,
      maxAttempts: 3 as const,
      reason: "budget" as const,
    };
    expect(
      projectTimeline("session_1", [
        event(1, "run.state", {
          status: "started",
          startedAt: new Date(1).toISOString(),
          continuation,
        }),
      ]),
    ).toContainEqual(
      expect.objectContaining({
        type: "run",
        runId: "run_1",
        continuation,
      }),
    );
  });

  it("accepts the canonical non-retryable continuation reason", () => {
    const continuation = {
      parentRunId: "run_parent",
      rootRunId: "run_root",
      attempt: 3 as const,
      maxAttempts: 3 as const,
      reason: "non-retryable-error" as const,
    };
    expect(
      projectTimeline("session_1", [
        event(1, "run.state", {
          status: "error",
          startedAt: new Date(1).toISOString(),
          finishedAt: new Date(2).toISOString(),
          stopReason: "error",
          failure: {
            code: "provider_rejected",
            message: "Provider rejected the request",
            retryable: false,
          },
          continuation,
        }),
      ]),
    ).toContainEqual(expect.objectContaining({ type: "run", continuation }));
  });

  it("terminally recovers interrupted JSONL runs and pending tools once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const store = new JsonlSessionStore(join(directory, "events.jsonl"));
    await store.append(
      event(1, "run.state", {
        status: "started",
        startedAt: "2026-08-09T12:00:00.000Z",
      }),
    );
    await store.append(
      event(2, "tool.requested", {
        toolCallId: "tool_interrupted",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
      }),
    );

    await expect(
      store.reconcileInterruptedRuns("2026-08-10T01:00:00.000Z"),
    ).resolves.toEqual({ recoveredRuns: 1, recoveredTools: 1 });
    const timeline = await store.readTimeline("session_1");
    expect(timeline.find((item) => item.type === "run")).toMatchObject({
      type: "run",
      runId: "run_1",
      sequence: 4,
      status: "error",
      finishedAt: "2026-08-10T01:00:00.000Z",
      stopReason: "error",
      failure: {
        code: "run_interrupted",
        retryable: true,
      },
    });
    expect(timeline.find((item) => item.type === "tool")).toMatchObject({
      type: "tool",
      toolCallId: "tool_interrupted",
      status: "failed",
      error: { code: "run_interrupted" },
    });

    await expect(
      store.reconcileInterruptedRuns("2026-08-10T02:00:00.000Z"),
    ).resolves.toEqual({ recoveredRuns: 0, recoveredTools: 0 });
    await expect(store.read("session_1")).resolves.toHaveLength(4);
  });

  it("projects structured Provider failures while accepting legacy terminal runs", async () => {
    const store = new SqliteSessionStore(":memory:");
    await store.append(
      event(1, "run.state", {
        status: "started",
        startedAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    await store.append(
      event(2, "run.state", {
        status: "error",
        startedAt: "2026-08-11T00:00:00.000Z",
        finishedAt: "2026-08-11T00:03:00.000Z",
        stopReason: "error",
        failure: {
          code: "provider_timeout",
          message: "Provider did not start responding",
          retryable: true,
          provider: "provider_1",
          modelRequestId: "model_request_1",
          timeout: { phase: "first-response", thresholdMs: 180_000 },
        },
      }),
    );

    const timeline = await store.readTimeline("session_1");
    expect(timeline.find((item) => item.type === "run")).toMatchObject({
      type: "run",
      failure: {
        code: "provider_timeout",
        modelRequestId: "model_request_1",
        timeout: { phase: "first-response", thresholdMs: 180_000 },
      },
    });
    store.close();
  });

  it("rejects attachment metadata that contains a local path", () => {
    const store = new SqliteSessionStore(":memory:");
    expect(() =>
      store.append(
        event(1, "message.user", {
          messageId: "message_with_path",
          content: "Use this brief",
          attachments: [
            {
              attachmentId: `file_${"b".repeat(64)}`,
              name: "product-brief.md",
              mimeType: "text/markdown",
              byteSize: 2048,
              path: "/private/product-brief.md",
            },
          ],
          documentId: "document_1",
          revision: 1,
          scope: { kind: "document", selectedNodeIds: [] },
        }),
      ),
    ).toThrow(
      "durable_timeline_event.schema_invalid at /payload/attachments/0/path",
    );
    store.close();
  });

  it("reconstructs stable timeline identities from JSONL and keeps raw events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const path = join(directory, "events.jsonl");
    const diagnostics: SessionStoreReadDiagnostic[] = [];
    const store = new JsonlSessionStore(path, {
      reportReadDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    await expectRecoveredTimeline(store);

    await appendFile(
      path,
      [
        "not-json",
        JSON.stringify({ sessionId: "session_1", sequence: "bad" }),
        JSON.stringify({
          ...events[0],
          eventId: "malformed_payload",
          sequence: 10,
          payload: { status: "invented" },
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    await expect(store.read("session_1")).resolves.toEqual(events);
    expect(diagnostics).toMatchObject([
      { code: "session_event_json_invalid", lineNumber: 10 },
      { code: "session_event_contract_invalid", lineNumber: 11 },
      {
        code: "session_event_contract_invalid",
        lineNumber: 12,
        eventId: "malformed_payload",
        sequence: 10,
      },
    ]);

    await store.read("session_1");
    expect(diagnostics).toHaveLength(3);
  });

  it("reports a truncated JSONL tail while preserving earlier events", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const path = join(directory, "events.jsonl");
    const diagnostics: SessionStoreReadDiagnostic[] = [];
    await appendFile(
      path,
      `${JSON.stringify(events[0])}\n{"eventId":"partial`,
      "utf8",
    );

    const store = new JsonlSessionStore(path, {
      reportReadDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });
    await expect(store.read("session_1")).resolves.toEqual([events[0]]);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: "session_event_truncated_tail",
        storage: "jsonl",
        lineNumber: 2,
      }),
    ]);
  });

  it("keeps a persisted failed tool while removing only invalid legacy details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const path = join(directory, "events.jsonl");
    const requested = event(1, "tool.requested", {
      toolCallId: "tool_legacy_failure",
      toolName: "opendesign_edit_design",
      input: {},
      risk: "design_write",
    });
    const failed = event(2, "tool.failed", {
      toolCallId: "tool_legacy_failure",
      code: "legacy_failure",
      message: `The legacy failure remains visible\n${"x".repeat(30_000)}`,
      details: { legacy: true },
    });
    await appendFile(
      path,
      `${JSON.stringify(requested)}\n${JSON.stringify(failed)}\n`,
      "utf8",
    );

    const store = new JsonlSessionStore(path);
    const raw = await store.read("session_1");
    expect(raw).toHaveLength(2);
    expect(raw[1]?.payload).not.toHaveProperty("details");
    const timeline = await store.readTimeline("session_1");
    const tool = timeline.find((item) => item.type === "tool");
    expect(tool).toMatchObject({
      type: "tool",
      status: "failed",
      error: { code: "legacy_failure" },
    });
    if (tool?.type !== "tool") return;
    expect(tool.error?.message).toHaveLength(20_000);
    expect(tool.error?.message).toContain("The legacy failure remains visible");
    expect(tool.error?.message).toContain(
      "[OpenDesign truncated legacy tool diagnostics]",
    );
  });

  it("recovers a persisted circuit failure with stale workflow details", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const path = join(directory, "events.jsonl");
    const requested = event(1, "tool.requested", {
      toolCallId: "tool_stale_workflow_failure",
      toolName: "opendesign_capture_canvas",
      input: {},
      risk: "design_write",
    });
    const failed = event(2, "tool.failed", {
      toolCallId: "tool_stale_workflow_failure",
      code: "design_recovery_no_progress",
      message: "Recovery made no progress",
      retryable: false,
      recoverable: false,
      details: {
        kind: "design-workflow",
        fingerprint: "workflow_visual_review",
        workflowCode: "visual_review_required",
        phase: "capture",
        requiresInspection: false,
        issues: [
          {
            code: "design_workflow.visual_review_required",
            path: "/designWorkflow",
            message: "Capture and review the current material revision",
          },
        ],
        recovery: { action: "follow-workflow", required: true },
      },
    });
    await appendFile(
      path,
      `${JSON.stringify(requested)}\n${JSON.stringify(failed)}\n`,
      "utf8",
    );

    const store = new JsonlSessionStore(path);
    const raw = await store.read("session_1");
    expect(raw[1]?.payload).not.toHaveProperty("details");
    const timeline = await store.readTimeline("session_1");
    const tool = timeline.find((item) => item.type === "tool");
    expect(tool).toMatchObject({
      type: "tool",
      status: "failed",
      error: { code: "design_recovery_no_progress" },
    });
  });

  it("splits persisted oversized reasoning without hiding the assistant message", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-session-"));
    const path = join(directory, "events.jsonl");
    const summary = "reasoning".repeat(
      Math.ceil((MAX_REASONING_SUMMARY_CHARACTERS + 1) / 9),
    );
    await appendFile(
      path,
      `${JSON.stringify(
        event(1, "message.assistant", {
          messageId: "message_oversized_reasoning",
          blocks: [
            {
              blockId: "reasoning_1",
              type: "reasoning_summary",
              status: "completed",
              summary,
            },
          ],
        }),
      )}\n`,
      "utf8",
    );

    const timeline = await new JsonlSessionStore(path).readTimeline(
      "session_1",
    );
    const message = timeline.find((item) => item.type === "assistant.message");
    expect(message?.type).toBe("assistant.message");
    if (message?.type !== "assistant.message") return;
    expect(
      message.blocks
        .filter((block) => block.type === "reasoning_summary")
        .map((block) => block.summary ?? "")
        .join(""),
    ).toBe(summary);
  });

  it.each(["jsonl", "sqlite"] as const)(
    "keeps a higher host revision as the latest %s projection",
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), "opendesign-revision-"));
      const store =
        kind === "jsonl"
          ? new JsonlSessionStore(join(directory, "events.jsonl"))
          : new SqliteSessionStore(join(directory, "sessions.db"));
      try {
        await expectHigherHostRevisionProjection(store);
      } finally {
        if (store instanceof SqliteSessionStore) store.close();
      }
    },
  );

  it("keeps failed tools and resolved approvals stable by identity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-transitions-"));
    const store = new JsonlSessionStore(join(directory, "events.jsonl"));
    const transitions = [
      event(1, "tool.requested", {
        toolCallId: "tool_failed_1",
        toolName: "design.delete",
        input: { nodeId: "node_1" },
        risk: "destructive",
      }),
      event(2, "approval.requested", {
        approvalId: "approval_1",
        toolCallId: "tool_failed_1",
        title: "Allow delete",
        summary: "Delete the selected node",
      }),
      event(3, "approval.resolved", {
        approvalId: "approval_1",
        toolCallId: "tool_failed_1",
        decision: "deny",
        resolvedAt: new Date(3).toISOString(),
      }),
      event(4, "tool.failed", {
        toolCallId: "tool_failed_1",
        code: "approval_denied",
        message: "Host denied this tool call",
      }),
    ];
    for (const transition of transitions) await store.append(transition);

    await expect(store.readTimeline("session_1")).resolves.toEqual([
      expect.objectContaining({
        itemId: "tool:run_1:tool_failed_1",
        type: "tool",
        status: "failed",
        error: {
          code: "approval_denied",
          message: "Host denied this tool call",
        },
      }),
      expect.objectContaining({
        itemId: "approval:approval_1",
        type: "approval",
        status: "resolved",
        decision: "deny",
      }),
    ]);
  });

  it("keeps reused provider tool-call IDs isolated by Run", () => {
    const firstRun = event(1, "tool.requested", {
      toolCallId: "call_1",
      toolName: "design.inspect",
      input: {},
      risk: "read",
    });
    const firstCompleted = event(2, "tool.completed", {
      toolCallId: "call_1",
      result: { run: 1 },
    });
    const secondRun = {
      ...event(3, "tool.requested", {
        toolCallId: "call_1",
        toolName: "design.inspect",
        input: {},
        risk: "read",
      }),
      runId: "run_2",
    };
    const secondFailed = {
      ...event(4, "tool.failed", {
        toolCallId: "call_1",
        code: "second_failed",
        message: "Run 2 failed",
      }),
      runId: "run_2",
    };

    const tools = projectTimeline("session_1", [
      firstRun,
      firstCompleted,
      secondRun,
      secondFailed,
    ]).filter((item) => item.type === "tool");

    expect(tools[0]).toMatchObject({
      itemId: "tool:run_1:call_1",
      runId: "run_1",
      status: "completed",
      result: { run: 1 },
    });
    expect(tools[1]).toMatchObject({
      itemId: "tool:run_2:call_1",
      runId: "run_2",
      status: "failed",
    });
    expect(tools[1]?.type).toBe("tool");
    if (tools[1]?.type !== "tool") return;
    expect(tools[1].error).toMatchObject({ code: "second_failed" });
  });

  it("reconstructs the same timeline from SQLite and creates parent directories", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-sqlite-"));
    const store = new SqliteSessionStore(
      join(directory, "nested", "sessions.db"),
    );

    try {
      await expectRecoveredTimeline(store);
    } finally {
      store.close();
    }
  });

  it.each(["jsonl", "sqlite"] as const)(
    "atomically allocates concurrent same-session sequences for %s stores",
    async (kind) => {
      const directory = await mkdtemp(join(tmpdir(), "opendesign-concurrent-"));
      const path = join(
        directory,
        kind === "jsonl" ? "events.jsonl" : "sessions.db",
      );
      const stores =
        kind === "jsonl"
          ? [new JsonlSessionStore(path), new JsonlSessionStore(path)]
          : [new SqliteSessionStore(path), new SqliteSessionStore(path)];

      try {
        const allocated = await Promise.all(
          Array.from({ length: 24 }, async (_, index) => {
            const store = stores[index % stores.length]!;
            return store.appendNext("session_concurrent", (sequence) => ({
              eventId: `concurrent_${index}`,
              sessionId: "session_concurrent",
              runId: `run_${index}`,
              sequence,
              type: "run.state",
              createdAt: new Date(index + 1).toISOString(),
              payload: {
                status: "started",
                startedAt: new Date(index + 1).toISOString(),
              },
            }));
          }),
        );
        const persisted = await stores[0]!.read("session_concurrent");

        expect(
          allocated.map((item) => item.sequence).sort((a, b) => a - b),
        ).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));
        expect(persisted.map((item) => item.sequence)).toEqual(
          Array.from({ length: 24 }, (_, index) => index + 1),
        );
        expect(new Set(persisted.map((item) => item.eventId)).size).toBe(24);
      } finally {
        for (const store of stores) {
          if (store instanceof SqliteSessionStore) store.close();
        }
      }
    },
  );

  it("continues appends after an initial JSONL append failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-recovery-"));
    const blockedPath = join(directory, "blocked");
    const path = join(blockedPath, "events.jsonl");
    await appendFile(blockedPath, "file", "utf8");
    const store = new JsonlSessionStore(path);

    await expect(store.append(events[0]!)).rejects.toBeDefined();
    await unlink(blockedPath);
    await mkdir(blockedPath);
    await expect(store.append(events[1]!)).resolves.toBeUndefined();
    await expect(store.project("session_1")).resolves.toMatchObject({
      lastSequence: 2,
      messageCount: 1,
    });
  });
});
