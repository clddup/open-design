import { describe, expect, it } from "vitest";
import { normalizeSessionHistory } from "./session-history.js";

const timestamp = "2026-08-18T12:00:00.000Z";

describe("Agent session history validation", () => {
  it("keeps valid structured failure details and the containing message", () => {
    const timeline = normalizeSessionHistory([
      {
        type: "tool",
        itemId: "tool:call_structured",
        sessionId: "session_1",
        runId: "run_1",
        sequence: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
        toolCallId: "call_structured",
        toolName: "opendesign_edit_design",
        input: {},
        risk: "design_write",
        status: "failed",
        error: {
          code: "design_target_stale",
          message: "The selected node was removed",
          recoverable: true,
          details: {
            kind: "design-workflow",
            fingerprint: "workflow_target_stale",
            workflowCode: "target_stale",
            phase: "inspection",
            requiresInspection: true,
            issues: [
              {
                code: "design_workflow.target_stale",
                path: "/targetSet",
                message: "The selected node was removed",
              },
            ],
            recovery: { action: "follow-workflow", required: true },
          },
        },
      },
    ]);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      type: "tool",
      status: "failed",
      error: {
        code: "design_target_stale",
        details: {
          kind: "design-workflow",
          workflowCode: "target_stale",
        },
      },
    });
  });

  it("rejects a non-canonical item instead of maintaining a second parser", () => {
    expect(() => normalizeSessionHistory([{ type: "invented" }])).toThrow(
      "Session history item 0 (invented) is incompatible",
    );
  });
});
