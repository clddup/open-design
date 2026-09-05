import { beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_PROTOCOL_VERSION } from "@opendesign/agent-contracts";
import { modelBridgeRequestValidationError } from "@/shared/model-bridge";
import type { SessionStoreBridgeRequest } from "@/shared/session-store-bridge";
import { AgentHost, createAgentEnvironment } from "./agent-host";
import { MainDesignToolRuntime } from "./main-design-tool-runtime";
import { parseDesignToolInput } from "./design-tool-input-parser";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";

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
    void host.start();

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
    void host.start();
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const invalidRequest = {
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
    };
    const rejection = modelBridgeRequestValidationError(invalidRequest);
    if (!rejection) {
      throw new TypeError("Expected the oversized tool schema to be rejected");
    }

    postToHost(invalidRequest);

    expect(handler).not.toHaveBeenCalled();
    expect(rejection).toContain(
      "model_bridge_request.tool_schema_too_large at /request/tools/0/inputSchema",
    );
    expect(error).toHaveBeenCalledWith(
      `Rejected invalid model request: ${rejection}`,
    );
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "model.response",
      requestId: "model_request_1",
      ok: false,
      error: `Model request rejected by the host: ${rejection}`,
    });
  });

  it("forwards tool input unchanged to the single authoritative Main parser", async () => {
    const host = new AgentHost();
    const handler = vi.fn(() => Promise.resolve({ content: { ok: true } }));
    host.setDesignToolRequestHandler(handler);
    void host.start();

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

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ input: { unexpected: true } }),
      expect.objectContaining({ runId: "run_1" }),
      expect.any(AbortSignal),
      expect.any(Function),
    );
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "design-tool.response",
      requestId: "design_tool_request_1",
      ok: true,
      result: { content: { ok: true } },
    });
  });

  it("routes Session Store operations through the Main handler", async () => {
    const host = new AgentHost();
    const handler = vi.fn((request: SessionStoreBridgeRequest) =>
      Promise.resolve({
        type: "session-store.response" as const,
        requestId: request.requestId,
        operation: "read" as const,
        ok: true as const,
        result: [],
      }),
    );
    host.setSessionStoreRequestHandler(handler);
    void host.start();

    postToHost({
      type: "session-store.request",
      requestId: "session_request_1",
      operation: "read",
      sessionId: "conversation_1",
    });

    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "session-store.response",
      requestId: "session_request_1",
      operation: "read",
      ok: true,
      result: [],
    });
  });

  it("turns an invalid run event into a visible correlated Agent error", () => {
    const host = new AgentHost();
    const events: unknown[] = [];
    host.on((event) => events.push(event));
    void host.start();
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
      message:
        "Agent returned an invalid event: Invalid Agent event. agent_event.schema_invalid at /blocks: Expected array. Correct the reported Agent event field before retrying.",
      runId: "run_invalid_event",
    });
    expect(electron.child.postMessage).toHaveBeenCalledWith({
      type: "run.cancel",
      runId: "run_invalid_event",
    });
  });

  it("preserves a bounded request identity on an invalid history event", () => {
    const host = new AgentHost();
    const events: unknown[] = [];
    host.on((event) => events.push(event));
    void host.start();
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    postToHost({
      type: "session.history",
      requestId: "history_invalid_1",
      sessionId: "session_1",
      timeline: "invalid",
    });

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "invalid_event",
        requestId: "history_invalid_1",
      }),
    );
  });

  it("terminates a Run when its trusted host binding no longer exists", async () => {
    const host = new AgentHost();
    const events: unknown[] = [];
    host.on((event) => events.push(event));
    const dispatch = vi.fn(() => Promise.resolve({ content: { ok: true } }));
    const coordinator = {
      assertDesignToolContext: () => {
        throw new Error("Design tool requires an active registered Run");
      },
    };
    const runtime = new MainDesignToolRuntime({
      parseInput: (call, context) =>
        parseDesignToolInput(coordinator as never, call, context),
      dispatch,
      isPreauthorized: () => true,
      recordAudit: () => undefined,
    });
    host.setDesignToolRequestHandler((...args) => runtime.execute(...args));
    void host.start();

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
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("keeps a target-binding failure recoverable through Main parsing and the Agent bridge", async () => {
    const host = new AgentHost();
    const failure = designWorkflowError(
      "delivery_scope_mismatch",
      "The current target must be completed before creating the next artboard",
      {
        path: "/deliveryStage/nextTarget",
        recovery: "Continue the current target.",
      },
    );
    const coordinator = {
      assertDesignToolContext: () => undefined,
      authoritativeDesignPrompt: () => "Design a login page",
      firstSliceTargetBinding: () => {
        throw failure;
      },
    };
    const dispatch = vi.fn(() => Promise.resolve({ content: { ok: true } }));
    const runtime = new MainDesignToolRuntime({
      parseInput: (call, context) =>
        parseDesignToolInput(coordinator as never, call, context),
      dispatch,
      isPreauthorized: () => true,
      recordAudit: () => undefined,
    });
    host.setDesignToolRequestHandler((...args) => runtime.execute(...args));
    void host.start();
    const context = {
      runId: "run_binding_failure",
      sessionId: "session_1",
      documentId: "document_1",
      revision: 0,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId: "page_1" },
    };
    postToHost({
      type: "design-tool.request",
      requestId: "binding_failure",
      call: {
        toolCallId: "slice_failed",
        toolName: "opendesign_generate_first_slice",
        input: {},
      },
      context,
    });
    await vi.waitFor(() => {
      expect(electron.child.postMessage).toHaveBeenCalledWith({
        type: "design-tool.response",
        requestId: "binding_failure",
        ok: false,
        error: failure.cause,
      });
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(electron.child.postMessage).not.toHaveBeenCalledWith({
      type: "run.cancel",
      runId: context.runId,
    });
    postToHost({
      type: "design-tool.request",
      requestId: "inspect_after_failure",
      call: {
        toolCallId: "inspect_recovery",
        toolName: "opendesign_inspect_document",
        input: {},
      },
      context,
    });
    await vi.waitFor(() => {
      expect(electron.child.postMessage).toHaveBeenCalledWith({
        type: "design-tool.response",
        requestId: "inspect_after_failure",
        ok: true,
        result: { content: { ok: true } },
      });
    });
    expect(dispatch).toHaveBeenCalledOnce();
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
    void host.start();

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
    void host.start();
    postToHost({
      type: "agent.ready",
      protocolVersion: AGENT_PROTOCOL_VERSION,
      runtimeVersion: "0.0.0",
    });
    postToHost({
      type: "agent.connected",
      protocolVersion: AGENT_PROTOCOL_VERSION,
    });
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
