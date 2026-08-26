import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "@/shared/desktop-api.js";
import type { AgentHost, AgentHostListener } from "./agent-host.js";
import { AgentIpcRouter, type AgentIpcRegistrar } from "./agent-ipc-router.js";
import type { AgentRunCoordinator } from "./agent-run-coordinator.js";
import { AgentRunAdmissionError } from "./agent-run-admission-error.js";

type Handler = Parameters<AgentIpcRegistrar["handle"]>[1];
const event = {} as IpcMainInvokeEvent;

describe("AgentIpcRouter", () => {
  it("validates the sender, argument shape and Agent request before routing", async () => {
    const { assertRenderer, handlers, send } = setup();
    const handler = requireAgentRequestHandler(handlers);

    expect(() => handler(event)).toThrow("Unexpected IPC arguments");
    expect(() => handler(event, { type: "unknown" })).toThrow(
      "Invalid Agent request",
    );
    await expect(
      handler(event, {
        type: "handshake",
        protocolVersion: "3.10",
        clientVersion: "0.0.0",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "request_rejected",
        message: "Agent handshake is host-internal",
      },
    });

    expect(assertRenderer).toHaveBeenCalledTimes(3);
    expect(send).not.toHaveBeenCalled();
  });

  it("checks sender identity before parsing untrusted payloads", () => {
    const assertRenderer = vi.fn(() => {
      throw new Error("Agent request from unknown renderer");
    });
    const { handlers, send } = setup({ assertRenderer });
    const handler = requireAgentRequestHandler(handlers);

    expect(() => handler(event, { type: "unknown" })).toThrow(
      "Agent request from unknown renderer",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("owns request correlations until the matching Agent event arrives", async () => {
    const { emit, handlers, observeEvent, publish, send } = setup();
    const handler = requireAgentRequestHandler(handlers);
    const request: AgentRequest = {
      type: "session.history",
      requestId: "history_1",
      sessionId: "conversation_1",
    };

    await expect(handler(event, request)).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(request);

    const historyEvent: AgentEvent = {
      type: "session.history",
      requestId: request.requestId,
      sessionId: request.sessionId,
      timeline: [],
    };
    emit(historyEvent);

    expect(observeEvent).toHaveBeenCalledWith(historyEvent, {
      conversationId: "conversation_1",
      requestId: "history_1",
    });
    expect(publish).toHaveBeenCalledWith(historyEvent);

    const lateError: AgentEvent = {
      type: "agent.error",
      code: "history_failed",
      message: "History failed after completion",
      requestId: request.requestId,
    };
    emit(lateError);
    expect(observeEvent).toHaveBeenLastCalledWith(lateError, {
      requestId: "history_1",
    });
  });

  it("rolls back a history correlation when Agent dispatch fails", async () => {
    const send = vi.fn(() => {
      throw new Error("Agent process is not ready");
    });
    const { emit, handlers, observeEvent } = setup({ send });
    const handler = requireAgentRequestHandler(handlers);

    await expect(
      handler(event, {
        type: "session.history",
        requestId: "history_2",
        sessionId: "conversation_2",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "request_rejected",
        message: "Agent process is not ready",
      },
    });

    const errorEvent: AgentEvent = {
      type: "agent.error",
      code: "history_failed",
      message: "History failed",
      requestId: "history_2",
    };
    emit(errorEvent);
    expect(observeEvent).toHaveBeenCalledWith(errorEvent, {
      requestId: "history_2",
    });
  });

  it("delegates Run requests and Agent events to the Run coordinator", async () => {
    const { emit, handleRunEvent, handleRunRequest, handlers, send } = setup();
    const handler = requireAgentRequestHandler(handlers);
    const cancel: AgentRequest = { type: "run.cancel", runId: "run_1" };

    await expect(handler(event, cancel)).resolves.toEqual({ ok: true });
    expect(handleRunRequest).toHaveBeenCalledWith(cancel);
    expect(send).not.toHaveBeenCalled();

    const completed: AgentEvent = {
      type: "run.completed",
      runId: "run_1",
      finishedAt: "2026-08-23T01:00:00.000Z",
      stopReason: "complete",
    };
    emit(completed);
    expect(handleRunEvent).toHaveBeenCalledWith(completed);
  });

  it("returns a structured admission failure without parsing Error messages", async () => {
    const handleRunRequest = vi.fn(() =>
      Promise.reject(
        new AgentRunAdmissionError(
          "conversation_busy",
          "Conversation already has an active task",
        ),
      ),
    );
    const { handlers } = setup({ handleRunRequest });
    const handler = requireAgentRequestHandler(handlers);

    await expect(
      handler(event, {
        type: "run.start",
        runId: "run_second",
        sessionId: "conversation_1",
        prompt: "继续",
        documentId: "document_1",
        revision: 4,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page_1" },
        modelSelection: { providerId: "provider_1", modelId: "model_1" },
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "conversation_busy",
        message: "Conversation already has an active task",
      },
    });
  });

  it("registers once and detaches the Agent listener on dispose", () => {
    const { emit, observeEvent, publish, router } = setup();

    expect(() =>
      router.register({
        assertRenderer: vi.fn(),
        ipc: { handle: vi.fn() },
      }),
    ).toThrow("Agent IPC router is already registered");

    router.dispose();
    emit({
      type: "agent.error",
      code: "process_exited",
      message: "Agent process exited",
    });
    expect(observeEvent).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

function setup(overrides?: {
  assertRenderer?: (event: IpcMainInvokeEvent, message?: string) => void;
  handleRunRequest?: (request: AgentRequest) => Promise<void>;
  send?: (request: AgentRequest) => void;
}) {
  const handlers = new Map<string, Handler>();
  let listener: AgentHostListener | null = null;
  const send = overrides?.send ?? vi.fn();
  const agentHost = {
    on(nextListener: AgentHostListener) {
      listener = nextListener;
      return () => {
        listener = null;
      };
    },
    send,
  } as unknown as AgentHost;
  const observeEvent = vi.fn();
  const publish = vi.fn();
  const handleRunEvent = vi.fn();
  const handleRunRequest =
    overrides?.handleRunRequest ?? vi.fn(() => Promise.resolve());
  const runCoordinator = {
    conversationIdForRun: vi.fn(),
    handleEvent: handleRunEvent,
    handleRequest: handleRunRequest,
  } as unknown as AgentRunCoordinator;
  const router = new AgentIpcRouter({
    agentHost,
    getCoordinator: () => null,
    observeEvent,
    publish,
    runCoordinator,
  });
  const assertRenderer = overrides?.assertRenderer ?? vi.fn();
  router.register({
    assertRenderer,
    ipc: {
      handle(channel, handler) {
        handlers.set(channel, handler);
      },
    },
  });
  const emit = (nextEvent: AgentEvent) => {
    listener?.(nextEvent);
  };
  return {
    assertRenderer,
    emit,
    handleRunEvent,
    handleRunRequest,
    handlers,
    observeEvent,
    publish,
    router,
    send,
  };
}

function requireAgentRequestHandler(handlers: Map<string, Handler>): Handler {
  const handler = handlers.get(channels.agentRequest);
  if (!handler) throw new Error("Agent request handler is missing");
  return handler;
}
