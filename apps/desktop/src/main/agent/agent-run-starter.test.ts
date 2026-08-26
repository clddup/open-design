import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler";
import {
  handleAgentRunControlRequest,
  startAgentRun,
} from "./agent-run-starter";

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
  version: 3,
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

describe("Agent Run starter", () => {
  it("injects a Main-prepared inspection before sending the Run to Agent", async () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const send = vi.fn();
    const initialDesignInspection = {
      version: 1 as const,
      observedRevision: source.revision,
      content: '{"pageId":"page_1","revision":4}',
    };
    const started = await startAgentRun(source, {
      agentHost: { send } as never,
      continuationScheduler: scheduler,
      conversationIdByRunId: new Map(),
      initialInspectionControllers: new Map(),
      globalTaskCoordinator: {
        registerRun: vi.fn().mockResolvedValue({}),
        assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
      } as never,
      modelProviderHost: {
        resolveModelContext: vi.fn().mockReturnValue({
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
        }),
      } as never,
      prepareInitialDesignInspection: vi
        .fn()
        .mockResolvedValue(initialDesignInspection),
      referenceHost: {
        registerRun: vi.fn(),
        releaseRun: vi.fn(),
      } as never,
    });

    expect(started).toBe(true);
    expect(send).toHaveBeenCalledWith({
      ...source,
      deliveryScopeReview: "direct",
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
      .mockRejectedValue(new Error("agent_run.preflight_stale"));

    await expect(
      startAgentRun(source, {
        agentHost: { send } as never,
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent,
          handleAgentEvent,
        } as never,
        modelProviderHost: { resolveModelContext: vi.fn() } as never,
        prepareInitialDesignInspection: vi.fn().mockResolvedValue(undefined),
        referenceHost: {
          registerRun: vi.fn(),
          releaseRun: vi.fn(),
        } as never,
      }),
    ).rejects.toThrow("agent_run.preflight_stale");

    expect(assertRunRevisionCurrent).toHaveBeenCalledWith(source.runId);
    expect(send).not.toHaveBeenCalled();
    expect(handleAgentEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "agent.error",
        runId: source.runId,
        code: "request_rejected",
      }),
    );
  });

  it("rejects a Renderer-forged initial inspection", async () => {
    await expect(
      handleAgentRunControlRequest(
        {
          ...source,
          initialDesignInspection: {
            version: 1,
            observedRevision: source.revision,
            content: '{"forged":true}',
          },
        },
        {
          agentHost: {} as never,
          continuationScheduler: {} as never,
          conversationIdByRunId: new Map(),
          initialInspectionControllers: new Map(),
          globalTaskCoordinator: {} as never,
          modelProviderHost: {} as never,
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
        agentHost: { send } as never,
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
        } as never,
        modelProviderHost: {
          resolveModelContext: vi.fn().mockReturnValue({
            contextWindow: 200_000,
            maxOutputTokens: 16_384,
          }),
        } as never,
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
      agentHost: { send } as never,
      continuationScheduler: scheduler,
      conversationIdByRunId: new Map<string, string>(),
      initialInspectionControllers: new Map<string, AbortController>(),
      globalTaskCoordinator: {
        registerRun: vi.fn().mockResolvedValue({}),
        assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
        handleAgentEvent: vi.fn(),
      } as never,
      modelProviderHost: { resolveModelContext: vi.fn() } as never,
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
      result: { unfinishedDelivery: incomplete },
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
    const started = await startAgentRun(
      {
        ...source,
        runId: decision.nextRunId,
        continuation: decision.continuation,
      },
      {
        agentHost: { send } as never,
        continuationScheduler: scheduler,
        conversationIdByRunId: new Map(),
        initialInspectionControllers: new Map(),
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
          assertRunRevisionCurrent: vi.fn().mockResolvedValue(undefined),
          handleAgentEvent: (event: AgentEvent) => terminalEvents.push(event),
        } as never,
        modelProviderHost: { resolveModelContext: vi.fn() } as never,
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
  });
});
