import type { AgentEvent } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  projectAgentActiveRunId,
  projectAgentRunFileBinding,
  type AgentRunFileTarget,
} from "./continuation-binding";

const target: AgentRunFileTarget = {
  projectId: "project_1",
  designFileId: "file_1",
  documentId: "document_1",
};

function scheduled(): AgentEvent {
  return {
    type: "run.continuation",
    runId: "run_old",
    status: "scheduled",
    attempt: 1,
    maxAttempts: 3,
    reason: "retryable-error",
    nextRunId: "run_next",
  };
}

describe("Agent continuation renderer binding", () => {
  it("retains the file and keeps the conversation active across Run rotation", () => {
    const conversations = new Map([["run_old", "conversation_1"]]);
    const files = new Map([["run_old", target]]);
    const workspace = {
      releaseFileForRun: vi.fn(),
      retainFileForRun: vi.fn(),
    };
    const event = scheduled();

    projectAgentRunFileBinding(event, conversations, files, workspace);

    expect(conversations.get("run_next")).toBe("conversation_1");
    expect(files.get("run_next")).toEqual(target);
    expect(workspace.retainFileForRun).toHaveBeenCalledWith(
      "project_1",
      "file_1",
      "run_next",
    );
    expect(projectAgentActiveRunId("run_old", event, "run_old")).toBe(
      "run_next",
    );
  });

  it("retains a Run until the terminal event after a provider error", () => {
    const files = new Map([["run_old", target]]);
    const workspace = {
      releaseFileForRun: vi.fn(),
      retainFileForRun: vi.fn(),
    };
    const event: AgentEvent = {
      type: "agent.error",
      runId: "run_old",
      code: "provider_timeout",
      message: "Provider timed out",
      failure: {
        code: "provider_timeout",
        message: "Provider timed out",
        retryable: true,
      },
    };

    projectAgentRunFileBinding(event, new Map(), files, workspace);

    expect(files.get("run_old")).toEqual(target);
    expect(workspace.releaseFileForRun).not.toHaveBeenCalled();
    expect(projectAgentActiveRunId("run_old", event, "run_old")).toBe(
      "run_old",
    );
  });

  it("retains a Run while it recovers from a revision conflict", () => {
    const conversations = new Map([["run_old", "conversation_1"]]);
    const files = new Map([["run_old", target]]);
    const workspace = {
      releaseFileForRun: vi.fn(),
      retainFileForRun: vi.fn(),
    };
    const event: AgentEvent = {
      type: "tool.failed",
      runId: "run_old",
      toolCallId: "edit_1",
      code: "design_revision_conflict",
      message: "The canvas changed before the edit was applied",
      retryable: true,
      recoverable: true,
    };

    const eventRunId = projectAgentRunFileBinding(
      event,
      conversations,
      files,
      workspace,
    );

    expect(eventRunId).toBe("run_old");
    expect(files.get("run_old")).toEqual(target);
    expect(conversations.get("run_old")).toBe("conversation_1");
    expect(workspace.releaseFileForRun).not.toHaveBeenCalled();
    expect(projectAgentActiveRunId("run_old", event, eventRunId)).toBe(
      "run_old",
    );
  });

  it("releases and deactivates a Run only on run.completed", () => {
    const files = new Map([["run_old", target]]);
    const workspace = {
      releaseFileForRun: vi.fn(),
      retainFileForRun: vi.fn(),
    };
    const event: AgentEvent = {
      type: "run.completed",
      runId: "run_old",
      finishedAt: "2026-09-04T10:00:00.000Z",
      stopReason: "error",
    };

    projectAgentRunFileBinding(event, new Map(), files, workspace);

    expect(files.has("run_old")).toBe(false);
    expect(workspace.releaseFileForRun).toHaveBeenCalledWith(
      "project_1",
      "file_1",
      "run_old",
    );
    expect(projectAgentActiveRunId("run_old", event, "run_old")).toBeNull();
  });

  it("releases a reserved next Run when scheduling needs attention", () => {
    const conversations = new Map([["run_next", "conversation_1"]]);
    const files = new Map([["run_next", target]]);
    const workspace = {
      releaseFileForRun: vi.fn(),
      retainFileForRun: vi.fn(),
    };
    const event: Extract<AgentEvent, { type: "run.continuation" }> = {
      type: "run.continuation",
      runId: "run_old",
      status: "needs_attention",
      attempt: 1,
      maxAttempts: 3,
      reason: "retryable-error",
      nextRunId: "run_next",
    };

    projectAgentRunFileBinding(event, conversations, files, workspace);

    expect(files.has("run_next")).toBe(false);
    expect(conversations.has("run_next")).toBe(false);
    expect(workspace.releaseFileForRun).toHaveBeenCalledWith(
      "project_1",
      "file_1",
      "run_next",
    );
    expect(projectAgentActiveRunId("run_next", event, "run_old")).toBeNull();
  });
});
