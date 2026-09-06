import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { JournalEvent, SessionStore } from "@opendesign/session-store";
import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler";
import {
  handleAgentRunControlRequest,
  startAgentRun,
} from "./agent-run-starter";
import { AgentRunAdmissionError } from "./agent-run-admission-error";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

const source: RunStartRequest = {
  type: "run.start",
  runId: "run_source",
  sessionId: "conversation_1",
  prompt: "Build the design",
  documentId: "document_1",
  revision: 4,
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
  modelSelection: { providerId: "provider", modelId: "design" },
};

const incomplete: DesignDeliveryLedger = {
  version: 4,
  activeTargetId: "target_1",
  targets: [
    {
      targetId: "target_1",
      label: "Home",
      pageId: "page_1",
      rootNodeId: "frame_1",
      reservedNodeIds: ["frame_1"],
      status: "drafted",
      allocatedRevision: 4,
      draftRevision: 5,
    },
  ],
};

function createMemorySessionStore(): SessionStore {
  const events: JournalEvent[] = [];
  return {
    append: (event) => {
      events.push(event);
      return Promise.resolve();
    },
    appendNext: (sessionId, createEvent) => {
      const event = createEvent(events.length + 1);
      if (event.sessionId !== sessionId) throw new Error("Session mismatch");
      events.push(event);
      return Promise.resolve(event);
    },
    read: (sessionId) =>
      Promise.resolve(events.filter((event) => event.sessionId === sessionId)),
    readTimeline: () => Promise.resolve([]),
    project: (sessionId) =>
      Promise.resolve({
        sessionId,
        lastSequence: events.length,
        messageCount: 0,
        toolCallCount: 0,
        compactedRanges: [],
      }),
  };
}

describe("Agent Run starter", () => {
  it("rejects duplicate Run identity without cleaning up the existing Run", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    scheduler.registerRun(source);
    const conversationIdByRunId = new Map([[source.runId, source.sessionId]]);
    const start = vi.fn().mockResolvedValue(undefined);
    const releaseRun = vi.fn();
    const handleAgentEvent = vi.fn();
    const sessionStore = createMemorySessionStore();
    await expect(
      startAgentRun(source, {
        agentHost: { start, send: vi.fn() },
        continuationScheduler: scheduler,
        conversationIdByRunId,
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn(),
          handleAgentEvent,
        } as never,
        modelProviderHost: {} as never,
        sessionStore,
        referenceHost: { releaseRun } as never,
      }),
    ).rejects.toThrow("already registered");
    expect(scheduler.activeRunIds()).toEqual([source.runId]);
    expect(conversationIdByRunId.get(source.runId)).toBe(source.sessionId);
    expect(releaseRun).not.toHaveBeenCalled();
    expect(handleAgentEvent).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
    expect(await sessionStore.read(source.sessionId)).toEqual([]);
  });

  it("lets the original pending startup finish after a duplicate is rejected", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    let ready!: () => void;
    const start = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const send = vi.fn();
    const dependencies = {
      agentHost: { start, send },
      continuationScheduler: scheduler,
      conversationIdByRunId: new Map<string, string>(),
      initialInspectionControllers: new Map<string, AbortController>(),
      globalTaskCoordinator: {
        registerRun: vi.fn().mockResolvedValue({}),
        assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
        referenceAttachmentsForRun: vi.fn(() => []),
        handleAgentEvent: vi.fn(),
      } as never,
      referenceHost: { registerRun: vi.fn(), releaseRun: vi.fn() } as never,
      modelProviderHost: {
        resolveModelContext: () => ({
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
        }),
      } as never,
      sessionStore: createMemorySessionStore(),
    };
    const first = startAgentRun(source, dependencies);
    await expect(startAgentRun(source, dependencies)).rejects.toThrow(
      "already registered",
    );
    expect(start).toHaveBeenCalledOnce();
    ready();
    await expect(first).resolves.toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(scheduler.activeRunIds()).toEqual([source.runId]);
  });

  it.each([
    { phase: "startup", rejected: false },
    { phase: "startup", rejected: true },
    { phase: "registration", rejected: false },
    { phase: "registration", rejected: true },
    { phase: "revision", rejected: false },
    { phase: "revision", rejected: true },
  ])(
    "does not dispatch a Run cancelled during $phase; rejected=$rejected",
    async ({ phase, rejected }) => {
      const scheduler = new AgentContinuationScheduler(() => 1000);
      let release!: () => void;
      const waitAtBoundary = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            release = () =>
              rejected
                ? reject(new Error("Revision read ended after cancellation"))
                : resolve();
          }),
      );
      const send = vi.fn();
      const references = { registerRun: vi.fn(), releaseRun: vi.fn() };
      const sessionStore = createMemorySessionStore();
      const handleAgentEvent = vi.fn();
      const conversationIdByRunId = new Map<string, string>();
      const start =
        phase === "startup"
          ? waitAtBoundary
          : vi.fn().mockResolvedValue(undefined);
      const registerRun =
        phase === "registration"
          ? waitAtBoundary
          : vi.fn().mockResolvedValue({});
      const assertRunRevisionCurrent =
        phase === "revision"
          ? waitAtBoundary
          : vi.fn().mockResolvedValue(undefined);
      const dependencies = {
        agentHost: { send, start },
        continuationScheduler: scheduler,
        conversationIdByRunId,
        initialInspectionControllers: new Map<string, AbortController>(),
        globalTaskCoordinator: {
          registerRun,
          assertRunRevisionCurrent,
          handleAgentEvent,
          referenceAttachmentsForRun: vi.fn(() => []),
        } as never,
        modelProviderHost: {
          resolveModelContext: vi.fn(() => ({
            contextWindow: 200_000,
            maxOutputTokens: 16_384,
          })),
        } as never,
        sessionStore,
        referenceHost: references as never,
      };
      const pending = startAgentRun(source, dependencies);
      await vi.waitFor(() => expect(waitAtBoundary).toHaveBeenCalledOnce());
      const cancellationTarget = scheduler.requestCancellation(source.runId);
      release();
      await expect(pending).resolves.toBe(false);
      expect(cancellationTarget).toBe(source.runId);
      expect(send).not.toHaveBeenCalled();
      expect(references.registerRun).not.toHaveBeenCalled();
      if (phase === "startup") expect(registerRun).not.toHaveBeenCalled();
      expect(conversationIdByRunId.size).toBe(0);
      expect(scheduler.activeRunIds()).toEqual([]);
      expect(handleAgentEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "run.completed",
          stopReason: "cancelled",
        }),
      );
      const journal = await sessionStore.read(source.sessionId);
      expect(
        journal.filter((event) => event.type === "message.user"),
      ).toHaveLength(1);
      expect(
        journal.filter((event) => event.type === "run.state"),
      ).toMatchObject([{ payload: { status: "cancelled" } }]);
    },
  );

  it("sends Main-prepared inspection without injecting a delivery intent flag", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const send = vi.fn();
    const start = vi.fn().mockResolvedValue(undefined);
    const initialDesignInspection = {
      version: 1 as const,
      observedRevision: source.revision,
      content: {
        inspection: {
          pageId: "page_1",
          revision: source.revision,
          document: {
            documentId: source.documentId,
            revision: source.revision,
            pagesById: {
              page_1: { id: "page_1", rootNodeIds: [] },
            },
            nodesById: {},
          },
        },
      },
    };
    const started = await startAgentRun(source, {
      agentHost: { send, start },
      continuationScheduler: scheduler,
      conversationIdByRunId: new Map(),
      initialInspectionControllers: new Map(),
      globalTaskCoordinator: {
        registerRun: vi.fn().mockResolvedValue({}),
        assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
        referenceAttachmentsForRun: vi.fn().mockReturnValue([]),
      } as never,
      modelProviderHost: {
        resolveModelContext: vi.fn().mockReturnValue({
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
        }),
      } as never,
      sessionStore: createMemorySessionStore(),
      prepareInitialDesignInspection: vi
        .fn()
        .mockResolvedValue(initialDesignInspection),
      referenceHost: {
        registerRun: vi.fn(),
        releaseRun: vi.fn(),
      } as never,
    });

    expect(started).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      ...source,
      initialDesignInspection,
      modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
    });
  });

  it("revalidates the registered revision after preflight before starting Agent", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const send = vi.fn();
    const handleAgentEvent = vi.fn();
    const assertRunRevisionCurrent = vi
      .fn()
      .mockRejectedValue(
        new AgentRunAdmissionError("preflight_stale", "Design File advanced"),
      );
    const sessionStore = createMemorySessionStore();

    await expect(
      startAgentRun(source, {
        agentHost: {
          send,
          start: vi.fn().mockResolvedValue(undefined),
        },
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent,
          handleAgentEvent,
          referenceAttachmentsForRun: vi.fn().mockReturnValue([]),
        } as never,
        modelProviderHost: { resolveModelContext: vi.fn() } as never,
        sessionStore,
        prepareInitialDesignInspection: vi.fn().mockResolvedValue(undefined),
        referenceHost: {
          registerRun: vi.fn(),
          releaseRun: vi.fn(),
        } as never,
      }),
    ).rejects.toMatchObject({ code: "preflight_stale" });

    expect(assertRunRevisionCurrent).toHaveBeenCalledWith(source.runId);
    expect(send).not.toHaveBeenCalled();
    expect(handleAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.error",
        runId: source.runId,
        code: "preflight_stale",
      }),
    );
    expect(handleAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "run.completed",
        runId: source.runId,
        stopReason: "error",
      }),
    );
    await expect(sessionStore.read(source.sessionId)).resolves.toMatchObject([
      {
        type: "message.user",
        runId: source.runId,
        payload: {
          messageId: `${source.runId}_user`,
          content: source.prompt,
        },
      },
      {
        type: "run.state",
        runId: source.runId,
        payload: {
          status: "error",
          stopReason: "error",
          failure: {
            code: "preflight_stale",
            message: "Design File advanced",
          },
        },
      },
    ]);
  });

  it("rejects a Renderer-forged initial inspection", async () => {
    await expect(
      handleAgentRunControlRequest(
        {
          ...source,
          initialDesignInspection: {
            version: 1,
            observedRevision: source.revision,
            content: { inspection: { forged: true } },
          },
        },
        {
          agentHost: {} as never,
          continuationScheduler: {} as never,
          conversationIdByRunId: new Map(),
          initialInspectionControllers: new Map(),
          globalTaskCoordinator: {} as never,
          modelProviderHost: {} as never,
          sessionStore: createMemorySessionStore(),
          referenceHost: {} as never,
          publish: vi.fn(),
        },
      ),
    ).rejects.toThrow("Renderer cannot supply initial design inspection");
  });

  it("cancels an automatic continuation before starting a new user Run", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    scheduler.registerRun({
      ...source,
      runId: "run_automatic",
      continuation: {
        parentRunId: "run_parent",
        rootRunId: "run_parent",
        reason: "budget",
        attempt: 1,
        maxAttempts: 3,
      },
    });
    const send = vi.fn();
    const explicit = { ...source, runId: "run_explicit", prompt: "新消息" };

    expect(
      await handleAgentRunControlRequest(explicit, {
        agentHost: {
          send,
          start: vi.fn().mockResolvedValue(undefined),
        },
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
          referenceAttachmentsForRun: vi.fn().mockReturnValue([]),
        } as never,
        modelProviderHost: {
          resolveModelContext: vi.fn().mockReturnValue({
            contextWindow: 200_000,
            maxOutputTokens: 16_384,
          }),
        } as never,
        sessionStore: createMemorySessionStore(),
        prepareInitialDesignInspection: vi.fn().mockResolvedValue(undefined),
        referenceHost: {
          registerRun: vi.fn(),
          releaseRun: vi.fn(),
        } as never,
        publish: vi.fn(),
      }),
    ).toBe(true);

    expect(send.mock.calls[0]?.[0]).toEqual({
      type: "run.cancel",
      runId: "run_automatic",
    });
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      type: "run.start",
      runId: "run_explicit",
      prompt: "新消息",
    });
  });

  it("cancels the host inspection before the Agent Run is sent", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const send = vi.fn();
    const publish = vi.fn();
    const prepareInitialDesignInspection = vi.fn(
      (_request: RunStartRequest, signal: AbortSignal) =>
        new Promise<undefined>((resolve) => {
          signal.addEventListener("abort", () => resolve(undefined), {
            once: true,
          });
        }),
    );
    const dependencies = {
      agentHost: { send, start: vi.fn().mockResolvedValue(undefined) } as never,
      continuationScheduler: scheduler,
      conversationIdByRunId: new Map<string, string>(),
      initialInspectionControllers: new Map<string, AbortController>(),
      globalTaskCoordinator: {
        registerRun: vi.fn().mockResolvedValue({}),
        assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
        handleAgentEvent: vi.fn(),
        referenceAttachmentsForRun: vi.fn().mockReturnValue([]),
      } as never,
      modelProviderHost: { resolveModelContext: vi.fn() } as never,
      sessionStore: createMemorySessionStore(),
      prepareInitialDesignInspection,
      referenceHost: {
        registerRun: vi.fn(),
        releaseRun: vi.fn(),
      } as never,
    };
    const started = startAgentRun(source, dependencies);
    await vi.waitFor(() => {
      expect(prepareInitialDesignInspection).toHaveBeenCalledTimes(1);
    });

    expect(
      await handleAgentRunControlRequest(
        { type: "run.cancel", runId: source.runId },
        { ...dependencies, publish },
      ),
    ).toBe(true);
    expect(await started).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a scheduled continuation after the user cancels it", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    scheduler.registerRun(source);
    scheduler.record({
      type: "tool.completed",
      runId: source.runId,
      toolCallId: "inspect_source",
      result: { delivery: incomplete },
    });
    const decision = scheduler.record({
      type: "run.completed",
      runId: source.runId,
      finishedAt: "2026-08-13T01:00:00.000Z",
      stopReason: "budget",
    });
    if (!decision || decision.kind !== "schedule") {
      throw new Error("Expected a scheduled continuation");
    }
    expect(scheduler.requestCancellation(source.runId)).toBe(
      decision.nextRunId,
    );

    const terminalEvents: AgentEvent[] = [];
    const send = vi.fn();
    const sessionStore = createMemorySessionStore();
    const started = await startAgentRun(
      {
        ...source,
        runId: decision.nextRunId,
        continuation: decision.continuation,
      },
      {
        agentHost: {
          send,
          start: vi.fn().mockResolvedValue(undefined),
        },
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
          handleAgentEvent: (event: AgentEvent) => terminalEvents.push(event),
          referenceAttachmentsForRun: vi.fn().mockReturnValue([]),
        } as never,
        modelProviderHost: { resolveModelContext: vi.fn() } as never,
        sessionStore,
        referenceHost: {
          registerRun: vi.fn(),
          releaseRun: vi.fn(),
        } as never,
      },
    );

    expect(started).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(terminalEvents).toContainEqual(
      expect.objectContaining({
        type: "run.completed",
        runId: decision.nextRunId,
        stopReason: "cancelled",
      }),
    );
    await expect(sessionStore.read(source.sessionId)).resolves.toMatchObject([
      {
        type: "message.user",
        runId: decision.nextRunId,
        payload: { content: source.prompt },
      },
      {
        type: "run.state",
        runId: decision.nextRunId,
        payload: { status: "cancelled", stopReason: "cancelled" },
      },
    ]);
  });
});
