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

  it("rejects an invalid runtime event before it crosses the process boundary", async () => {
    const events: AgentEvent[] = [];
    const runtime = createRuntime(vi.fn(() => Promise.resolve([])));
    runtime.run = async function* () {
      await Promise.resolve();
      yield {
        type: "message.completed",
        runId: "run_invalid",
        messageId: "message_invalid",
        blocks: "invalid",
      } as unknown as AgentEvent;
    };

    await dispatchAgentRequest(
      {
        type: "run.start",
        runId: "run_invalid",
        sessionId: "session_1",
        prompt: "Create a design",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
        modelSelection: { providerId: "provider_1", modelId: "model_1" },
      },
      { runtime, postMessage: (event) => events.push(event) },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "agent.error",
      code: "request_failed",
      runId: "run_invalid",
    });
    const error = events[0];
    expect(error?.type).toBe("agent.error");
    if (error?.type !== "agent.error") return;
    expect(error.message).toContain(
      "Agent produced an invalid event: Invalid Agent event. agent_event.schema_invalid at /blocks",
    );
    expect(isAgentEvent(error)).toBe(true);
  });

  it("passes the canonical run.start payload without its wire discriminant", async () => {
    const runtime = createRuntime(vi.fn(() => Promise.resolve([])));
    let received: unknown;
    runtime.run = async function* (request) {
      received = request;
      await Promise.resolve();
      yield* [];
    };

    await dispatchAgentRequest(
      {
        type: "run.start",
        runId: "run_1",
        sessionId: "session_1",
        prompt: "Create a design",
        documentId: "document_1",
        revision: 2,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
        modelSelection: { providerId: "provider_1", modelId: "model_1" },
      },
      { runtime, postMessage: vi.fn() },
    );

    expect(received).toEqual({
      runId: "run_1",
      sessionId: "session_1",
      prompt: "Create a design",
      documentId: "document_1",
      revision: 2,
      scope: { kind: "document", selectedNodeIds: [] },
      mutationTarget: { kind: "document" },
      modelSelection: { providerId: "provider_1", modelId: "model_1" },
    });
  });

  it("routes an exact approval resolution to the pending approval controller", async () => {
    const events: AgentEvent[] = [];
    const resolveApproval = vi.fn(() => true);
    const request = {
      type: "approval.resolve" as const,
      runId: "run_1",
      toolCallId: "tool_1",
      approvalId: "approval_1",
      decision: "allow_once" as const,
    };

    await dispatchAgentRequest(request, {
      runtime: createRuntime(vi.fn(() => Promise.resolve([]))),
      postMessage: (event) => events.push(event),
      resolveApproval,
    });

    expect(resolveApproval).toHaveBeenCalledWith(request);
    expect(events).toEqual([]);
  });

  it("rejects an approval resolution that has no exact pending request", async () => {
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
        resolveApproval: () => false,
      },
    );

    expect(events).toEqual([
      {
        type: "agent.error",
        code: "request_failed",
        message: "Approval resolution does not match a pending request",
        runId: "run_1",
      },
    ]);
    expect(isAgentEvent(events[0])).toBe(true);
  });
});
