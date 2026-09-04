import type { AgentEvent } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { projectGlobalTaskLifecycle } from "./global-task-lifecycle";

describe("Global Task lifecycle", () => {
  it("keeps recoverable failures inside the Run until its terminal event", () => {
    const conflict: AgentEvent & { runId: string } = {
      type: "tool.failed",
      runId: "run_1",
      toolCallId: "edit_1",
      code: "design_target_stale",
      message: "The edited node no longer exists",
      retryable: true,
      recoverable: true,
    };
    const lateCompletion: AgentEvent & { runId: string } = {
      type: "tool.completed",
      runId: "run_1",
      toolCallId: "inspect_1",
      result: {},
    };

    expect(projectGlobalTaskLifecycle(conflict, "running")).toBe("running");
    expect(projectGlobalTaskLifecycle(lateCompletion, "running")).toBe(
      "running",
    );
  });
});
