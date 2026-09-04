import type { AgentRunRequest } from "@opendesign/agent-runtime";
import {
  AGENT_PROTOCOL_VERSION,
  AgentEventContract,
  formatRuntimeContractFailure,
  type AgentEvent,
  type AgentRequest,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";

export interface AgentRuntimePort {
  cancel(runId: string): boolean;
  loadSessionHistory(sessionId: string): Promise<SessionTimelineItem[]>;
  run(input: AgentRunRequest): AsyncIterable<AgentEvent>;
}

export interface AgentRequestHandlerOptions {
  runtime: AgentRuntimePort;
  postMessage: (event: AgentEvent) => void;
  resolveApproval?: (
    request: Extract<AgentRequest, { type: "approval.resolve" }>,
  ) => boolean;
}

export async function dispatchAgentRequest(
  request: AgentRequest,
  options: AgentRequestHandlerOptions,
): Promise<void> {
  let runCompleted = false;
  const postValidated = (event: AgentEvent): void => {
    const result = AgentEventContract.parse(event);
    if (!result.ok) {
      throw new TypeError(
        `Agent produced an invalid event: ${formatRuntimeContractFailure(
          "Agent event",
          result.issues,
        )}`,
      );
    }
    if (
      request.type === "run.start" &&
      event.type === "run.completed" &&
      event.runId === request.runId
    ) {
      runCompleted = true;
    }
    options.postMessage(result.value);
  };
  try {
    await handleRequest(request, { ...options, postMessage: postValidated });
    if (request.type === "run.start" && !runCompleted) {
      throw new Error("Agent Run ended without run.completed");
    }
  } catch (error: unknown) {
    const message = (
      error instanceof Error ? error.message : "Agent request failed"
    ).slice(0, 20_000);
    options.postMessage({
      type: "agent.error",
      code: "request_failed",
      message,
      ...(request.type === "run.start" ||
      request.type === "run.cancel" ||
      request.type === "approval.resolve"
        ? { runId: request.runId }
        : {}),
      ...(request.type === "session.history"
        ? { requestId: request.requestId }
        : {}),
    } satisfies AgentEvent);
    if (request.type === "run.start" && !runCompleted) {
      options.postMessage({
        type: "run.completed",
        runId: request.runId,
        finishedAt: new Date().toISOString(),
        stopReason: "error",
      });
    }
  }
}

async function handleRequest(
  request: AgentRequest,
  { runtime, postMessage, resolveApproval }: AgentRequestHandlerOptions,
): Promise<void> {
  if (request.type === "handshake") {
    if (request.protocolVersion !== AGENT_PROTOCOL_VERSION) {
      throw new Error(
        `Agent protocol mismatch: ${request.protocolVersion} != ${AGENT_PROTOCOL_VERSION}`,
      );
    }
    postMessage({
      type: "agent.connected",
      protocolVersion: AGENT_PROTOCOL_VERSION,
    } satisfies AgentEvent);
    return;
  }

  if (request.type === "run.cancel") {
    runtime.cancel(request.runId);
    return;
  }

  if (request.type === "run.start") {
    const { type: requestType, ...runRequest } = request;
    requestType satisfies "run.start";
    for await (const event of runtime.run(runRequest)) {
      postMessage(event);
    }
    return;
  }

  if (request.type === "session.history") {
    const timeline = await runtime.loadSessionHistory(request.sessionId);
    postMessage({
      type: "session.history",
      requestId: request.requestId,
      sessionId: request.sessionId,
      timeline,
    } satisfies AgentEvent);
    return;
  }

  if (request.type === "approval.resolve") {
    if (!resolveApproval?.(request)) {
      throw new Error("Approval resolution does not match a pending request");
    }
    return;
  }

  request satisfies never;
}
