import type { AgentRunRequest, AgentRuntime } from "@opendesign/agent-runtime";
import {
  AGENT_PROTOCOL_VERSION,
  type AgentEvent,
  type AgentRequest,
} from "@opendesign/agent-contracts";

export interface AgentRequestHandlerOptions {
  runtime: Pick<AgentRuntime, "cancel" | "loadSessionHistory" | "run">;
  postMessage: (event: AgentEvent) => void;
}

export async function dispatchAgentRequest(
  request: AgentRequest,
  options: AgentRequestHandlerOptions,
): Promise<void> {
  try {
    await handleRequest(request, options);
  } catch (error: unknown) {
    options.postMessage({
      type: "agent.error",
      code: "request_failed",
      message: error instanceof Error ? error.message : "Agent request failed",
      ...(request.type === "run.start" ||
      request.type === "run.cancel" ||
      request.type === "approval.resolve"
        ? { runId: request.runId }
        : {}),
      ...(request.type === "session.history"
        ? { requestId: request.requestId }
        : {}),
    } satisfies AgentEvent);
  }
}

async function handleRequest(
  request: AgentRequest,
  { runtime, postMessage }: AgentRequestHandlerOptions,
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
    const runRequest: AgentRunRequest = { ...request };
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

  throw new Error("approval.resolve is not supported by the Agent utility");
}
