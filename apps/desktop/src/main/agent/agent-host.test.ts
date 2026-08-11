import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentHost,
  createAgentEnvironment,
  FatalAgentRunError,
} from "./agent-host";

const electron = vi.hoisted(() => {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const child: Record<string, unknown> = {};
  Object.assign(child, {
    kill: vi.fn(),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, listener);
      return child;
    }),
    postMessage: vi.fn(),
    stderr: { on: vi.fn() },
  });
  return {
    child,
    fork: vi.fn(() => child),
    listeners,
  };
});

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.0",
    isPackaged: false,
  },
  utilityProcess: { fork: electron.fork },
}));

const modelRequest = {
  type: "model.request" as const,
  requestId: "model_request_1",
  request: {
    attemptId: "attempt_1",
    sessionId: "session_1",
    modelSelection: {
      providerId: "provider_1",
      modelId: "design-model",
      reasoningEffort: "medium" as const,
    },
    system: "System",
    messages: [{ role: "user" as const, content: "Hello" }],
    tools: [],
  },
};

function postToHost(message: unknown) {
  const listener = electron.listeners.get("message");
  if (!listener) throw new Error("Agent message listener was not registered");
  listener(message);
}

beforeEach(() => {
  vi.clearAllMocks();
  electron.listeners.clear();
});

describe("AgentHost model bridge", () => {
  it("passes only an explicit environment allowlist to the Agent process", () => {
    expect(
      createAgentEnvironment(
        {
          HOME: "/Users/example",
          LANG: "zh_CN.UTF-8",
          OPENAI_API_KEY: "must-not-leak",
          ANTHROPIC_API_KEY: "must-not-leak",
          AWS_SECRET_ACCESS_KEY: "must-not-leak",
          HTTP_PROXY: "must-not-leak",
          OPENDESIGN_AGENT_SMOKE: "unexpected",
        },
        "production",
      ),
    ).toEqual({
      HOME: "/Users/example",
      LANG: "zh_CN.UTF-8",
      NODE_ENV: "production",
    });
    expect(
      createAgentEnvironment({ OPENDESIGN_AGENT_SMOKE: "1" }, "development"),
    ).toEqual({
      NODE_ENV: "development",
      OPENDESIGN_AGENT_SMOKE: "1",
    });
  });

  it("keeps the original request authoritative when a duplicate id arrives", async () => {
    let complete: (() => void) | undefined;
    const handler = vi.fn(async function* () {
      await new Promise<void>((resolve) => {
        complete = resolve;
      });
      yield {
        type: "block.started",
        attemptId: "attempt_1",
        blockId: "block_1",
        kind: "text",
      } as const;
    });
    const host = new AgentHost();
    host.setModelRequestHandler(handler);
    host.start();

    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    postToHost(modelRequest);
    postToHost(modelRequest);

    expect(handler).toHaveBeenCalledOnce();
    expect(electron.child.postMessage).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Rejected duplicate model request: model_request_1",
    );

    complete?.();
    await vi.waitFor(() => {
      expect(electron.child.postMessage).toHaveBeenCalledWith({
        type: "model.response",
        requestId: "model_request_1",
        ok: true,
      });
    });
  });

  it("returns a terminal bridge error instead of dropping an invalid model request", () => {
    const handler = vi.fn(async function* () {
      await Promise.resolve();
      yield {
        type: "block.started",
        attemptId: "attempt_1",
        blockId: "block_1",
        kind: "text",
      } as const;
    });
    const host = new AgentHost();
    host.setModelRequestHandler(handler);
    host.start();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    postToHost({
      ...modelRequest,
      request: {
        ...modelRequest.request,
        tools: [
          {
            name: "oversized_tool",
            description: "Invalid oversized test tool",
            inputSchema: {
              type: "object",
              description: "x".repeat(512_001),
            },
          },
        ],
      },
    });

    expect(handler).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      "Rejected invalid model request: tools[0] is invalid",
    );
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "model.response",
      requestId: "model_request_1",
      ok: false,
      error: "Model request rejected by the host: tools[0] is invalid",
    });
  });

  it("returns a terminal bridge error instead of dropping an invalid design tool request", () => {
    const host = new AgentHost();
    host.start();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    postToHost({
      type: "design-tool.request",
      requestId: "design_tool_request_1",
      call: {
        toolCallId: "tool_1",
        toolName: "opendesign_inspect_document",
        input: { unexpected: true },
      },
      context: {
        runId: "run_1",
        sessionId: "session_1",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
    });

    expect(error).toHaveBeenCalledWith("Rejected invalid design tool request");
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "design-tool.response",
      requestId: "design_tool_request_1",
      ok: false,
      error: {
        code: "invalid_tool_request",
        message: "Design tool request rejected by the host",
        retryable: false,
        recoverable: false,
      },
    });
  });

  it("turns an invalid run event into a visible correlated Agent error", () => {
    const host = new AgentHost();
    const events: unknown[] = [];
    host.on((event) => events.push(event));
    host.start();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    postToHost({
      type: "message.completed",
      runId: "run_invalid_event",
      messageId: "message_1",
      blocks: "invalid",
    });

    expect(events).toContainEqual({
      type: "agent.error",
      code: "invalid_event",
      message: "Agent returned an invalid event",
      runId: "run_invalid_event",
    });
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "run.cancel",
      runId: "run_invalid_event",
    });
  });

  it("terminates a Run when its trusted host binding no longer exists", async () => {
    const host = new AgentHost();
    const events: unknown[] = [];
    host.on((event) => events.push(event));
    host.setDesignToolRequestHandler(() => {
      throw new FatalAgentRunError(
        "run_context_invalid",
        "Design tool requires an active registered Run",
      );
    });
    host.start();

    postToHost({
      type: "design-tool.request",
      requestId: "design_tool_fatal_1",
      call: {
        toolCallId: "tool_fatal_1",
        toolName: "opendesign_inspect_document",
        input: {},
      },
      context: {
        runId: "run_fatal_1",
        sessionId: "session_1",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
      },
    });

    await vi.waitFor(() => {
      expect(electron.child.postMessage).toHaveBeenCalledWith({
        type: "run.cancel",
        runId: "run_fatal_1",
      });
    });
    expect(events).toContainEqual({
      type: "agent.error",
      code: "run_context_invalid",
      message: "Design tool requires an active registered Run",
      runId: "run_fatal_1",
    });
  });

  it("keeps a reused request id cancellable after the prior request aborts", async () => {
    const signals: AbortSignal[] = [];
    const handler = vi.fn(async function* (
      _request: unknown,
      signal: AbortSignal,
    ) {
      await new Promise<void>((_resolve, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
      });
      yield {
        type: "block.started",
        attemptId: "attempt_1",
        blockId: "block_1",
        kind: "text",
      } as const;
    });
    const host = new AgentHost();
    host.setModelRequestHandler(handler);
    host.start();

    postToHost(modelRequest);
    postToHost({ type: "model.cancel", requestId: modelRequest.requestId });
    postToHost(modelRequest);
    await Promise.resolve();
    await Promise.resolve();
    postToHost({ type: "model.cancel", requestId: modelRequest.requestId });

    expect(handler).toHaveBeenCalledTimes(2);
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(electron.child.postMessage).not.toHaveBeenCalled();
  });

  it("accepts an approval decision only for the exact pending tool call", () => {
    const host = new AgentHost();
    host.start();
    postToHost({
      type: "agent.ready",
      protocolVersion: "3.6.0",
      runtimeVersion: "0.0.0",
    });
    postToHost({ type: "agent.connected", protocolVersion: "3.6.0" });
    postToHost({
      type: "tool.requested",
      runId: "run_pages",
      toolCallId: "tool_pages",
      toolName: "opendesign_request_page_structure_access",
      input: {
        actions: ["create-page"],
        reason: "Create the requested Research page",
      },
      risk: "design_write",
    });
    postToHost({
      type: "approval.requested",
      runId: "run_pages",
      toolCallId: "tool_pages",
      approvalId: "approval_pages",
      title: "Allow Page structure changes",
      summary: "Allow this task to update Pages.",
    });
    const resolution = {
      type: "approval.resolve" as const,
      runId: "run_pages",
      toolCallId: "tool_pages",
      approvalId: "approval_pages",
      decision: "allow_once" as const,
    };

    expect(() =>
      host.prepareApprovalResolution({
        ...resolution,
        toolCallId: "tool_wrong",
      }),
    ).toThrow("does not match a pending request");
    expect(host.prepareApprovalResolution(resolution)).toMatchObject({
      input: {
        actions: ["create-page"],
        reason: "Create the requested Research page",
      },
      toolName: "opendesign_request_page_structure_access",
      risk: "design_write",
    });
    host.send(resolution);

    expect(electron.child.postMessage).toHaveBeenCalledWith(resolution);
    expect(() => host.prepareApprovalResolution(resolution)).toThrow(
      "does not match a pending request",
    );
  });
});
