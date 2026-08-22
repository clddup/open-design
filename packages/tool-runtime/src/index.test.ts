import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolRuntime, type ToolDefinition } from "./index.js";

afterEach(() => {
  vi.useRealTimers();
});

function createRuntime(decision: "allow" | "ask" | "deny", approved = true) {
  const audit = { record: vi.fn(() => Promise.resolve()) };
  const runtime = new ToolRuntime(
    { evaluate: vi.fn(() => Promise.resolve(decision)) },
    { request: vi.fn(() => Promise.resolve(approved)) },
    audit,
  );

  runtime.register({
    name: "design.read",
    description: "Read the current design",
    inputSchema: Type.Object({ nodeId: Type.String() }),
    capability: {
      capability: "design.read",
      resources: ["document:*"],
      risk: "read",
      sideEffect: false,
      idempotent: true,
      timeoutMs: 1_000,
      outputLimitBytes: 1_024,
    },
    execute: (input: { nodeId: string }) =>
      Promise.resolve({ nodeId: input.nodeId }),
  });

  return { runtime, audit };
}

describe("ToolRuntime", () => {
  it("validates, authorizes, executes and audits a tool", async () => {
    const { runtime, audit } = createRuntime("allow");

    await expect(
      runtime.execute({
        runId: "run_1",
        toolCallId: "tool_1",
        toolName: "design.read",
        input: { nodeId: "node_1" },
      }),
    ).resolves.toEqual({ nodeId: "node_1" });

    expect(audit.record).toHaveBeenCalledTimes(4);
  });

  it("never executes invalid input", async () => {
    const { runtime } = createRuntime("allow");

    await expect(
      runtime.execute({
        runId: "run_1",
        toolCallId: "tool_1",
        toolName: "design.read",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces approval after policy evaluation", async () => {
    const { runtime } = createRuntime("ask", false);

    await expect(
      runtime.execute({
        runId: "run_1",
        toolCallId: "tool_1",
        toolName: "design.read",
        input: { nodeId: "node_1" },
      }),
    ).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  });

  it("enforces a hard timeout when a tool ignores its AbortSignal", async () => {
    vi.useFakeTimers();
    const runtime = runtimeWithTool({
      capability: { timeoutMs: 50 },
      execute: () => new Promise(() => undefined),
    });

    const execution = runtime.execute(request("tool_timeout"));
    const rejected = expect(execution).rejects.toMatchObject({
      code: "TOOL_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(50);

    await rejected;
  });

  it("propagates caller cancellation through policy and execution", async () => {
    const neverStarted = vi.fn(() => Promise.resolve({ ok: true }));
    const alreadyCancelled = runtimeWithTool({ execute: neverStarted });
    const cancelledController = new AbortController();
    cancelledController.abort();
    await expect(
      alreadyCancelled.execute(request("already_cancelled"), {
        signal: cancelledController.signal,
      }),
    ).rejects.toMatchObject({ code: "TOOL_CANCELLED" });
    expect(neverStarted).not.toHaveBeenCalled();

    const policyController = new AbortController();
    const policyRuntime = runtimeWithTool(
      {},
      {
        evaluate: () => new Promise(() => undefined),
      },
    );
    const policyExecution = policyRuntime.execute(request("policy_cancel"), {
      signal: policyController.signal,
    });
    const policyRejected = expect(policyExecution).rejects.toMatchObject({
      code: "TOOL_CANCELLED",
    });
    policyController.abort();
    await policyRejected;

    const toolController = new AbortController();
    let toolStarted = false;
    const toolRuntime = runtimeWithTool({
      execute: () => {
        toolStarted = true;
        return new Promise(() => undefined);
      },
    });
    const toolExecution = toolRuntime.execute(request("tool_cancel"), {
      signal: toolController.signal,
    });
    const toolRejected = expect(toolExecution).rejects.toMatchObject({
      code: "TOOL_CANCELLED",
    });
    await vi.waitFor(() => expect(toolStarted).toBe(true));
    toolController.abort();
    await toolRejected;
  });

  it("rejects concurrent executions sharing a capability lease", async () => {
    let complete!: () => void;
    let executions = 0;
    const runtime = runtimeWithTool({
      capability: { concurrencyKey: "document:1" },
      execute: () => {
        executions += 1;
        return executions === 1
          ? new Promise<{ ok: boolean }>((resolve) => {
              complete = () => resolve({ ok: true });
            })
          : Promise.resolve({ ok: true });
      },
    });
    const first = runtime.execute(request("first"));
    await vi.waitFor(() => expect(complete).toBeTypeOf("function"));

    await expect(runtime.execute(request("second"))).rejects.toMatchObject({
      code: "TOOL_CONFLICT",
    });
    complete();
    await expect(first).resolves.toEqual({ ok: true });
    await expect(runtime.execute(request("third"))).resolves.toEqual({
      ok: true,
    });
  });

  it("forwards only bounded progress and rejects non-serializable output", async () => {
    const reportProgress = vi.fn();
    const progressRuntime = runtimeWithTool({
      execute: (_input, context) => {
        context.reportProgress("Applying design", 0.5);
        return Promise.resolve({ ok: true });
      },
    });
    await progressRuntime.execute(request("progress"), { reportProgress });
    expect(reportProgress).toHaveBeenCalledWith("Applying design", 0.5);

    const invalidProgress = runtimeWithTool({
      execute: (_input, context) => {
        context.reportProgress("", 2);
        return Promise.resolve({ ok: true });
      },
    });
    await expect(
      invalidProgress.execute(request("invalid_progress")),
    ).rejects.toThrow("Tool progress is invalid");

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const invalidOutput = runtimeWithTool({
      execute: () => Promise.resolve(cyclic),
    });
    await expect(
      invalidOutput.execute(request("invalid_output")),
    ).rejects.toMatchObject({ code: "INVALID_OUTPUT" });
  });
});

function request(toolCallId: string) {
  return {
    runId: "run_1",
    toolCallId,
    toolName: "design.read",
    input: { nodeId: "node_1" },
  };
}

function runtimeWithTool(
  overrides: {
    capability?: Partial<
      ToolDefinition<{ nodeId: string }, unknown>["capability"]
    >;
    execute?: ToolDefinition<{ nodeId: string }, unknown>["execute"];
  } = {},
  policy: { evaluate: () => Promise<"allow" | "ask" | "deny"> } = {
    evaluate: () => Promise.resolve("allow"),
  },
) {
  const runtime = new ToolRuntime(
    policy,
    {
      request: () => Promise.resolve(true),
    },
    { record: () => Promise.resolve() },
  );
  runtime.register({
    name: "design.read",
    description: "Read the current design",
    inputSchema: Type.Object({ nodeId: Type.String() }),
    capability: {
      capability: "design.read",
      resources: ["document:1"],
      risk: "read",
      sideEffect: false,
      idempotent: true,
      timeoutMs: 1_000,
      outputLimitBytes: 1_024,
      ...overrides.capability,
    },
    execute:
      overrides.execute ??
      ((input: { nodeId: string }) =>
        Promise.resolve({ nodeId: input.nodeId })),
  });
  return runtime;
}
