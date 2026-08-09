import {
  isAgentEvent,
  type AgentEvent,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchAgentRequest,
  type AgentRequestHandlerOptions,
} from "./request-handler.js";

const timestamp = "2026-08-07T12:00:00.000Z";

function createRuntime(
  loadSessionHistory: AgentRequestHandlerOptions["runtime"]["loadSessionHistory"],
): AgentRequestHandlerOptions["runtime"] {
  return {
    cancel: vi.fn(() => false),
    loadSessionHistory,
    async *run() {},
  };
}

describe("dispatchAgentRequest", () => {
  it("loads and posts session history with request correlation", async () => {
    const timeline: SessionTimelineItem[] = [
      {
        type: "run",
        itemId: "run_1",
        sessionId: "session_1",
        runId: "run_1",
        sequence: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        status: "completed",
        startedAt: timestamp,
        finishedAt: timestamp,
        stopReason: "complete",
      },
    ];
    const loadSessionHistory = vi.fn(() => Promise.resolve(timeline));
    const events: AgentEvent[] = [];

    await dispatchAgentRequest(
      {
        type: "session.history",
        requestId: "history_1",
        sessionId: "session_1",
      },
      {
        runtime: createRuntime(loadSessionHistory),
        postMessage: (event) => events.push(event),
      },
    );

    expect(loadSessionHistory).toHaveBeenCalledOnce();
    expect(loadSessionHistory).toHaveBeenCalledWith("session_1");
    expect(events).toEqual([
      {
        type: "session.history",
        requestId: "history_1",
        sessionId: "session_1",
        timeline,
      },
    ]);
    expect(isAgentEvent(events[0])).toBe(true);
  });

  it("correlates session history errors with the request", async () => {
    const events: AgentEvent[] = [];

    await dispatchAgentRequest(
      {
        type: "session.history",
        requestId: "history_failed",
        sessionId: "session_1",
      },
      {
        runtime: createRuntime(
          vi.fn(() => Promise.reject(new Error("History unavailable"))),
        ),
        postMessage: (event) => events.push(event),
      },
    );

    expect(events).toEqual([
      {
        type: "agent.error",
        code: "request_failed",
        message: "History unavailable",
        requestId: "history_failed",
      },
    ]);
    expect(isAgentEvent(events[0])).toBe(true);
  });

  it("reports approval resolution as unsupported", async () => {
    const events: AgentEvent[] = [];

    await dispatchAgentRequest(
      {
        type: "approval.resolve",
        runId: "run_1",
        toolCallId: "tool_1",
        approvalId: "approval_1",
        decision: "allow_once",
      },
      {
        runtime: createRuntime(vi.fn(() => Promise.resolve([]))),
        postMessage: (event) => events.push(event),
      },
    );

    expect(events).toEqual([
      {
        type: "agent.error",
        code: "request_failed",
        message: "approval.resolve is not supported by the Agent utility",
        runId: "run_1",
      },
    ]);
    expect(isAgentEvent(events[0])).toBe(true);
  });
});
