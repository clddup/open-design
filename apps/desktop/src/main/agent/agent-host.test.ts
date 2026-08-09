import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentHost, createAgentEnvironment } from "./agent-host";

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
});
