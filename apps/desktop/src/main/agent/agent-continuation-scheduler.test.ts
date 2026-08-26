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
  it("lets an explicit user Run supersede queued and active automatic continuations", () => {
    const scheduler = new AgentContinuationScheduler();
    const automatic = request({
      parentRunId: "run_initial",
      rootRunId: "run_initial",
      attempt: 1,
      maxAttempts: 3,
      reason: "retryable-error",
    });
    scheduler.registerRun(automatic);

    expect(
      scheduler.supersedeAutomaticContinuations(automatic.sessionId),
    ).toEqual([automatic.runId]);
    expect(scheduler.isCancellationRequested(automatic.runId)).toBe(true);
    expect(
      scheduler.supersedeAutomaticContinuations("conversation_other"),
    ).toEqual([]);
  });

  it("rotates an incomplete budget-limited Run without user input", () => {
    const scheduler = new AgentContinuationScheduler(() => 1000);
    const initial = request();
    scheduler.registerRun(initial);
    recordDelivery(scheduler, initial.runId);
    expect(scheduler.activeRunIds()).toEqual([initial.runId]);

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
    expect(scheduler.activeRunIds()).toEqual(["run_1000_auto_1"]);
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

  it("does not auto-continue an incomplete delivery after the Renderer circuit opens", () => {
    const scheduler = new AgentContinuationScheduler();
    const active = request();
    scheduler.registerRun(active);
    recordDelivery(scheduler, active.runId);
    scheduler.record({
      type: "agent.error",
      runId: active.runId,
      code: "renderer_circuit_open",
      message: "Canvas renderer repeatedly stalled",
      failure: {
        code: "renderer_circuit_open",
        message: "Canvas renderer repeatedly stalled",
        retryable: false,
      },
    });

    expect(scheduler.record(completed(active.runId, "error"))).toEqual({
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

  it("continues when the current Plan is verified but confirmed scope remains", () => {
    const scheduler = new AgentContinuationScheduler(() => 4000);
    const rolling = request();
    scheduler.registerRun(rolling);
    scheduler.record({
      type: "tool.completed",
      runId: rolling.runId,
      toolCallId: "verify_stage_1",
      revision: 6,
      result: {
        delivery: {
          ...incomplete,
          activeTargetId: null,
          targets: [
            {
              ...incomplete.targets[0],
              status: "verified",
              captureRevision: 6,
              reviewRevision: 6,
              refinementRevision: 6,
              verifiedRevision: 6,
            },
          ],
        },
        deliveryStage: {
          totalTargets: 12,
          plannedTargets: 1,
          verifiedTargets: 1,
          nextTarget: { targetId: "target_2" },
        },
      },
    });

    expect(scheduler.record(completed(rolling.runId, "budget"))).toMatchObject({
      kind: "schedule",
      nextRunId: "run_4000_auto_1",
      continuation: { reason: "budget", attempt: 1 },
    });
  });

  it("does not continue a delivery superseded by an explicit Page clear", () => {
    const scheduler = new AgentContinuationScheduler();
    const active = request();
    scheduler.registerRun(active);
    recordDelivery(scheduler, active.runId);
    scheduler.record({
      type: "tool.completed",
      runId: active.runId,
      toolCallId: "clear_page",
      revision: 5,
      result: { deliveryDisposition: "superseded" },
    });

    expect(scheduler.record(completed(active.runId, "complete"))).toBeNull();
  });

  it("honors user cancellation intent even if the Run reports another terminal reason", () => {
    const scheduler = new AgentContinuationScheduler();
    const active = request();
    scheduler.registerRun(active);
    recordDelivery(scheduler, active.runId);

    expect(scheduler.requestCancellation(active.runId)).toBe(active.runId);
    expect(scheduler.isCancellationRequested(active.runId)).toBe(true);
    expect(scheduler.record(completed(active.runId, "complete"))).toBeNull();
    expect(scheduler.isCancellationRequested(active.runId)).toBe(false);
  });

  it("redirects a late parent cancellation to its scheduled continuation", () => {
    const scheduler = new AgentContinuationScheduler(() => 4000);
    const initial = request();
    scheduler.registerRun(initial);
    recordDelivery(scheduler, initial.runId);
    const decision = scheduler.record(completed(initial.runId, "budget"));
    if (!decision || decision.kind !== "schedule") {
      throw new Error("Expected a scheduled continuation");
    }

    expect(scheduler.requestCancellation(initial.runId)).toBe(
      decision.nextRunId,
    );
    expect(scheduler.isCancellationRequested(decision.nextRunId)).toBe(true);
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
