import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { DesignDeliveryLedger } from "@opendesign/workspace-contracts";
import { describe, expect, it } from "vitest";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler";

function request(
  continuation?: Extract<AgentRequest, { type: "run.start" }>["continuation"],
): Extract<AgentRequest, { type: "run.start" }> {
  return {
    type: "run.start",
    runId: continuation ? `run_${continuation.attempt}` : "run_initial",
    sessionId: "conversation_1",
    prompt: "Build the complete design",
    documentId: "document_1",
    revision: 4,
    scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
    mutationTarget: { kind: "page", pageId: "page_1" },
    modelSelection: { providerId: "provider", modelId: "design" },
    ...(continuation ? { continuation } : {}),
  };
}

const incomplete: DesignDeliveryLedger = {
  version: 1,
  activeTargetId: "target_1",
  targets: [
    {
      targetId: "target_1",
      label: "Home",
      pageId: "page_1",
      rootNodeId: "frame_1",
      status: "drafted",
      draftRevision: 5,
    },
  ],
};

function completed(
  runId: string,
  stopReason: "complete" | "cancelled" | "error" | "budget",
): AgentEvent {
  return {
    type: "run.completed",
    runId,
    finishedAt: "2026-08-12T12:00:00.000Z",
    stopReason,
  };
}

function recordDelivery(
  scheduler: AgentContinuationScheduler,
  runId: string,
  delivery: DesignDeliveryLedger = incomplete,
): void {
  scheduler.record({
    type: "tool.completed",
    runId,
    toolCallId: `inspect_${runId}`,
    result: { unfinishedDelivery: delivery },
  });
}

describe("AgentContinuationScheduler", () => {
  it("rotates an incomplete budget-limited Run without user input", () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const initial = request();
    scheduler.registerRun(initial);
    recordDelivery(scheduler, initial.runId);

    expect(scheduler.record(completed(initial.runId, "budget"))).toEqual({
      kind: "schedule",
      source: initial,
      nextRunId: "run_1000_auto_1",
      continuation: {
        parentRunId: initial.runId,
        rootRunId: initial.runId,
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      },
    });
  });

  it("preserves the root Run and increments bounded continuation attempts", () => {
    const scheduler = new AgentContinuationScheduler(() => 2000);
    const continued = request({
      parentRunId: "run_initial",
      rootRunId: "run_initial",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    });
    scheduler.registerRun(continued);
    recordDelivery(scheduler, continued.runId);

    expect(
      scheduler.record(completed(continued.runId, "complete")),
    ).toMatchObject({
      kind: "schedule",
      continuation: {
        parentRunId: continued.runId,
        rootRunId: "run_initial",
        attempt: 2,
        reason: "incomplete",
      },
    });
  });

  it("continues retryable failures but stops at non-retryable failures", () => {
    const retryable = new AgentContinuationScheduler(() => 3000);
    const retryableRequest = request();
    retryable.registerRun(retryableRequest);
    recordDelivery(retryable, retryableRequest.runId);
    retryable.record({
      type: "agent.error",
      runId: retryableRequest.runId,
      code: "provider_timeout",
      message: "Provider timed out",
      failure: {
        code: "provider_timeout",
        message: "Provider timed out",
        retryable: true,
      },
    });
    expect(
      retryable.record(completed(retryableRequest.runId, "error")),
    ).toMatchObject({
      kind: "schedule",
      continuation: { reason: "retryable-error", attempt: 1 },
    });

    const fatal = new AgentContinuationScheduler();
    const fatalRequest = request();
    fatal.registerRun(fatalRequest);
    recordDelivery(fatal, fatalRequest.runId);
    fatal.record({
      type: "agent.error",
      runId: fatalRequest.runId,
      code: "model_context_incompatible",
      message: "Model context is incompatible",
      failure: {
        code: "model_context_incompatible",
        message: "Model context is incompatible",
        retryable: false,
      },
    });
    expect(fatal.record(completed(fatalRequest.runId, "error"))).toEqual({
      kind: "needs-attention",
      attempt: 1,
      maxAttempts: 3,
      reason: "non-retryable-error",
    });
  });

  it("does not continue cancellation or a fully verified delivery", () => {
    const scheduler = new AgentContinuationScheduler();
    const cancelled = request();
    scheduler.registerRun(cancelled);
    recordDelivery(scheduler, cancelled.runId);
    expect(
      scheduler.record(completed(cancelled.runId, "cancelled")),
    ).toBeNull();

    const verified = request();
    scheduler.registerRun(verified);
    recordDelivery(scheduler, verified.runId, {
      ...incomplete,
      activeTargetId: null,
      targets: [{ ...incomplete.targets[0], status: "verified" }],
    });
    expect(scheduler.record(completed(verified.runId, "budget"))).toBeNull();
  });

  it("moves the third failed continuation to needs-attention", () => {
    const scheduler = new AgentContinuationScheduler();
    const third = request({
      parentRunId: "run_2",
      rootRunId: "run_initial",
      attempt: 3,
      maxAttempts: 3,
      reason: "budget",
    });
    scheduler.registerRun(third);
    recordDelivery(scheduler, third.runId);
    expect(scheduler.record(completed(third.runId, "budget"))).toEqual({
      kind: "needs-attention",
      attempt: 3,
      maxAttempts: 3,
      reason: "budget",
    });
  });
});
