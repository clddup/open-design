import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { projectAgentRunExperience } from "./agent-run-experience";

const now = "2026-08-18T02:00:00.000Z";

describe("Agent run experience projection", () => {
  it("states truthfully that the canvas has not changed before the first tool call", () => {
    expect(
      projectAgentRunExperience({
        activeRunId: "run_1",
        events: [{ type: "run.started", runId: "run_1", startedAt: now }],
        timeline: [],
      }),
    ).toMatchObject({
      phase: "waiting-model",
      hasCanvasChanges: false,
      startedAt: now,
    });
  });

  it("moves from real artboard creation to editable content using trusted delivery state", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_1",
        toolCallId: "first_slice",
        toolName: "opendesign_generate_first_slice",
        input: {},
        risk: "design_write",
      },
    ];
    expect(
      projectAgentRunExperience({
        activeRunId: "run_1",
        events,
        timeline: [],
      })?.phase,
    ).toBe("creating-artboards");

    events.push({
      type: "tool.completed",
      runId: "run_1",
      toolCallId: "first_slice",
      revision: 4,
      transactionId: "transaction_first_slice",
      result: {
        delivery: delivery("drafted"),
      },
    });
    expect(
      projectAgentRunExperience({
        activeRunId: "run_1",
        events,
        timeline: [],
      }),
    ).toMatchObject({
      phase: "first-content",
      hasCanvasChanges: true,
      hasEditableContent: true,
    });
  });

  it("shows an active conditional checkpoint as trusted review work", () => {
    expect(
      projectAgentRunExperience({
        activeRunId: "run_1",
        events: [
          { type: "run.started", runId: "run_1", startedAt: now },
          {
            type: "tool.requested",
            runId: "run_1",
            toolCallId: "checkpoint_1",
            toolName: "opendesign_design_checkpoint",
            input: { version: 1, action: "apply-and-capture" },
            risk: "design_write",
          },
        ],
        timeline: [],
      }),
    ).toMatchObject({ phase: "reviewing", active: true });
  });

  it("reports a truthful partial phase when a terminal failure follows a canvas revision", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "error",
        startedAt: now,
        finishedAt: now,
        stopReason: "error",
      },
      {
        itemId: "tool:stale",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "stale",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "failed",
        error: {
          code: "design_target_stale",
          message:
            "Design command refine-home targets content outside every declared delivery artboard",
          retryable: false,
          recoverable: true,
        },
      },
      {
        itemId: "revision:4",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "design.revision",
        documentId: "document_1",
        previousRevision: 3,
        revision: 4,
        transactionId: "transaction_4",
      },
    ];
    expect(
      projectAgentRunExperience({
        activeRunId: null,
        events: [],
        timeline,
        error: "failed",
      }),
    ).toMatchObject({
      phase: "partial",
      hasCanvasChanges: true,
    });
  });

  it("does not turn a model-complete Run into a false design completion", () => {
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:prior_delivery",
        sessionId: "conversation_1",
        runId: "run_prior",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "prior_delivery",
        toolName: "opendesign_generate_first_slice",
        input: {},
        risk: "design_write",
        status: "completed",
        result: { delivery: delivery("drafted") },
        revision: 4,
        transactionId: "transaction_prior",
      },
      {
        itemId: "run:run_1",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "completed",
        startedAt: now,
        finishedAt: now,
        stopReason: "complete",
      },
    ];
    expect(
      projectAgentRunExperience({
        activeRunId: null,
        events: [],
        timeline,
      }),
    ).toBeNull();
  });
});

function delivery(firstStatus: "drafted") {
  return {
    version: 3 as const,
    targets: [
      {
        targetId: "home",
        label: "Home",
        pageId: "page_1",
        rootNodeId: "frame_home",
        reservedNodeIds: ["frame_home"],
        status: firstStatus,
        allocatedRevision: 1,
        draftRevision: 4,
      },
      {
        targetId: "profile",
        label: "Profile",
        pageId: "page_1",
        rootNodeId: "frame_profile",
        reservedNodeIds: ["frame_profile"],
        status: "allocated" as const,
        allocatedRevision: 1,
      },
    ],
    activeTargetId: "home",
  };
}
