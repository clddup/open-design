import type { AgentEvent, AgentRequest } from "@opendesign/agent-contracts";
import type { IpcMainInvokeEvent } from "electron";
import { describe, expect, it, vi } from "vitest";
import { channels } from "../../shared/desktop-api.js";
import { AgentContinuationScheduler } from "./agent-continuation-scheduler.js";
import type { AgentHost, AgentHostListener } from "./agent-host.js";
import { AgentIpcRouter, type AgentIpcRegistrar } from "./agent-ipc-router.js";

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
    ).rejects.toThrow("Agent handshake is host-internal");

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

    await expect(handler(event, request)).resolves.toBeUndefined();
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
    ).rejects.toThrow("Agent process is not ready");

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
  const router = new AgentIpcRouter({
    agentHost,
    continuationScheduler: new AgentContinuationScheduler(),
    forgetRendererRun: vi.fn(),
    getServices: () => ({
      globalTaskCoordinator: null,
      modelProviderHost: null,
      projectHost: null,
      referenceHost: null,
    }),
    observeEvent,
    prepareInitialDesignInspection: vi.fn(),
    publish,
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
