import type { AgentEvent } from "@opendesign/agent-contracts";
import type {
  DesignDeliveryLedger,
  DesignDeliveryStatus,
} from "@opendesign/workspace-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
} from "../../shared/design-agent-tools";
import { DesignGenerationPerformanceTracker } from "./design-generation-performance";

const baseTime = Date.parse("2026-08-12T00:00:00.000Z");

describe("DesignGenerationPerformanceTracker", () => {
  it.each([1, 4, 12])(
    "records deterministic milestones for a %i-target generation run",
    (targetCount) => {
      let now = baseTime;
      const tracker = new DesignGenerationPerformanceTracker(() => now);
      const runId = `run_${targetCount}_targets`;
      tracker.recordAgentEvent({
        type: "run.started",
        runId,
        startedAt: new Date(baseTime).toISOString(),
      });

      now = baseTime + 10;
      requested(tracker, runId, "plan", DESIGN_PLAN_TOOL_NAME);
      now = baseTime + 100;
      completed(tracker, runId, "plan", ledger(targetCount, 0, "pending"));

      tracker.recordModelProvider({
        attemptId: `${runId}_attempt_1`,
        status: "completed",
        totalMs: 80,
        firstProviderEventMs: 20,
        firstContentEventMs: 35,
        retries: 1,
      });
      tracker.recordRendererTool({
        runId,
        toolCallId: "apply",
        toolName: "opendesign_apply_design",
        status: "completed",
        canvasWaitCount: 3,
        canvasWaitMs: 100,
        configuredStageDelayMs: 90,
        totalMs: 120,
        firstResponseMs: 5,
        phaseDurationMs: {
          accepted: 5,
          applying: 100,
          capturing: 0,
          persisting: 15,
        },
        phaseProgressEvents: {
          accepted: 1,
          applying: 4,
          capturing: 0,
          persisting: 1,
        },
      });

      now = baseTime + 150;
      requested(tracker, runId, "apply", "opendesign_apply_design");
      now = baseTime + 250;
      completed(tracker, runId, "apply", ledger(targetCount, 0, "drafted"), 1);

      now = baseTime + 300;
      requested(tracker, runId, "review", DESIGN_REVIEW_TOOL_NAME);
      now = baseTime + 400;
      completed(tracker, runId, "review", ledger(targetCount, 0, "reviewed"));

      now = baseTime + 500;
      requested(tracker, runId, "capture", DESIGN_CAPTURE_TOOL_NAME);
      now = baseTime + 600;
      completed(
        tracker,
        runId,
        "capture",
        ledger(targetCount, 1, "pending"),
        5,
      );

      const allFinishedAt = baseTime + 600 + (targetCount - 1) * 100;
      if (targetCount > 1) {
        now = allFinishedAt;
        completed(
          tracker,
          runId,
          "remaining-targets",
          ledger(targetCount, targetCount, "pending"),
          targetCount * 5,
        );
      }
      now = allFinishedAt + 50;
      const summary = tracker.recordAgentEvent({
        type: "run.completed",
        runId,
        finishedAt: new Date(now).toISOString(),
        stopReason: "complete",
      });

      expect(summary).toMatchObject({
        version: 1,
        runId,
        targetCount,
        terminal: "completed",
        milestonesMs: {
          T_plan: 100,
          T0: null,
          T1: 250,
          T2: 600,
          T_all: allFinishedAt - baseTime,
          firstReviewed: 400,
        },
        unavailable: { T0: "no-allocated-ledger-state" },
        provider: {
          attempts: 1,
          completed: 1,
          retries: 1,
          totalMs: { count: 1, maxMs: 80, totalMs: 80 },
          firstProviderEventMs: { count: 1, maxMs: 20, totalMs: 20 },
          firstContentMs: { count: 1, maxMs: 35, totalMs: 35 },
        },
        renderer: {
          canvasWaitCount: 3,
          canvasWaitMs: 100,
          completed: 1,
          configuredStageDelayMs: 90,
          reportedCanvasWaitTools: 1,
          totalMs: { count: 1, maxMs: 120, totalMs: 120 },
          phaseProgressEvents: { applying: 4 },
          phaseDurationMs: {
            applying: { count: 1, maxMs: 100, totalMs: 100 },
          },
        },
      });
    },
  );

  it("does not emit a design-generation sample for a run without a plan", () => {
    const tracker = new DesignGenerationPerformanceTracker(() => baseTime);
    tracker.recordAgentEvent({
      type: "run.started",
      runId: "run_chat_only",
      startedAt: new Date(baseTime).toISOString(),
    });
    expect(
      tracker.recordAgentEvent({
        type: "run.completed",
        runId: "run_chat_only",
        finishedAt: new Date(baseTime + 100).toISOString(),
        stopReason: "complete",
      }),
    ).toBeNull();
  });
});

function requested(
  tracker: DesignGenerationPerformanceTracker,
  runId: string,
  toolCallId: string,
  toolName: string,
): void {
  tracker.recordAgentEvent({
    type: "tool.requested",
    runId,
    toolCallId,
    toolName,
    input: {},
    risk: "design_write",
  });
}

function completed(
  tracker: DesignGenerationPerformanceTracker,
  runId: string,
  toolCallId: string,
  delivery: DesignDeliveryLedger,
  revision?: number,
): void {
  tracker.recordAgentEvent({
    type: "tool.completed",
    runId,
    toolCallId,
    result: { ok: true, delivery },
    ...(revision === undefined ? {} : { revision }),
  } satisfies AgentEvent);
}

function ledger(
  targetCount: number,
  verifiedCount: number,
  activeStatus: DesignDeliveryStatus,
): DesignDeliveryLedger {
  const targets = Array.from({ length: targetCount }, (_, index) => {
    const status = index < verifiedCount ? "verified" : activeStatus;
    const revisions = revisionsFor(status);
    return {
      targetId: `target_${index + 1}`,
      label: `Target ${index + 1}`,
      pageId: `page_${index + 1}`,
      rootNodeId: `frame_${index + 1}`,
      status,
      ...revisions,
    };
  });
  const firstUnverified = targets.find(
    (target) => target.status !== "verified",
  );
  return {
    version: 1,
    targets,
    activeTargetId: firstUnverified?.targetId ?? null,
  };
}

function revisionsFor(status: DesignDeliveryStatus) {
  if (status === "pending") return {};
  if (status === "drafted") return { draftRevision: 1 };
  if (status === "captured") {
    return { draftRevision: 1, captureRevision: 2 };
  }
  if (status === "reviewed") {
    return { draftRevision: 1, captureRevision: 2, reviewRevision: 2 };
  }
  if (status === "refined") {
    return {
      draftRevision: 1,
      captureRevision: 2,
      reviewRevision: 2,
      refinementRevision: 3,
    };
  }
  return {
    draftRevision: 1,
    captureRevision: 2,
    reviewRevision: 2,
    refinementRevision: 3,
    verifiedRevision: 4,
  };
}
