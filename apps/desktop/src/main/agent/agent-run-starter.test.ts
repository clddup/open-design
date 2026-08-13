import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import { describe, expect, it, vi } from "vitest";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler";
import { startAgentRun } from "./agent-run-starter";

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
  version: 2,
  activeTargetId: "target_1",
  targets: [
    {
      targetId: "target_1",
      label: "Home",
      pageId: "page_1",
      rootNodeId: "frame_1",
      status: "drafted",
      allocatedRevision: 4,
      draftRevision: 5,
    },
  ],
};

describe("Agent Run starter", () => {
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
        globalTaskCoordinator: {
          registerRun: vi.fn().mockResolvedValue({}),
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
