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
  it("injects a Main-prepared inspection before sending the Run to Agent", async () => {
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
        setDeliveryScopeReview: vi.fn(),
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
      deliveryScopeReview: "required",
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
          setDeliveryScopeReview: vi.fn(),
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

  it("rejects a Renderer-forged delivery scope policy", async () => {
    await expect(
      handleAgentRunControlRequest(
        { ...source, deliveryScopeReview: "direct" },
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
    ).rejects.toThrow("Renderer cannot supply delivery scope policy");
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
          setDeliveryScopeReview: vi.fn(),
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
        setDeliveryScopeReview: vi.fn(),
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
    scheduler.setDeliveryScopeReview(source.runId, "required");
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
          setDeliveryScopeReview: vi.fn(),
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
