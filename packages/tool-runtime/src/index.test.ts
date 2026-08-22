import { Type } from "@sinclair/typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ToolRuntime,
  type PolicyContext,
  type ToolDefinition,
} from "./index.js";

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
    const { runtime, audit } = createRuntime("allow");

    await expect(
      runtime.execute({
        runId: "run_1",
        toolCallId: "tool_1",
        toolName: "design.read",
        input: {},
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: "failed",
        detail: { reason: "invalid input", stage: "input" },
      }),
    );
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

  it("fails closed on invalid policy and approval decisions", async () => {
    const invalidPolicy = runtimeWithTool(
      {},
      {
        evaluate: () => Promise.resolve("unexpected" as unknown as "allow"),
      },
    );
    await expect(
      invalidPolicy.execute(request("invalid_policy")),
    ).rejects.toMatchObject({ code: "POLICY_DENIED" });

    const invalidApproval = new ToolRuntime(
      { evaluate: () => Promise.resolve("ask") },
      {
        request: () => Promise.resolve("yes" as unknown as boolean),
      },
      { record: () => Promise.resolve() },
    );
    invalidApproval.register({
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
      execute: () => Promise.resolve({ ok: true }),
    });
    await expect(
      invalidApproval.execute(request("invalid_approval")),
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

  it("supports semantic input and output validators without a TypeBox schema", async () => {
    const execute = vi.fn((input: { nodeId: string }) =>
      Promise.resolve({ nodeId: input.nodeId }),
    );
    const runtime = new ToolRuntime(
      { evaluate: () => Promise.resolve("allow") },
      { request: () => Promise.resolve(true) },
      { record: () => Promise.resolve() },
    );
    runtime.register<{ nodeId: string }, { nodeId: string }>({
      name: "design.semantic-read",
      description: "Read through a semantic contract",
      validateInput: (input) =>
        typeof input === "object" &&
        input !== null &&
        "nodeId" in input &&
        typeof input.nodeId === "string",
      validateOutput: (output) =>
        typeof output === "object" &&
        output !== null &&
        "nodeId" in output &&
        typeof output.nodeId === "string",
      capability: {
        capability: "design.read",
        resources: ["document:*"],
        risk: "read",
        sideEffect: false,
        idempotent: true,
        timeoutMs: 1_000,
        outputLimitBytes: 1_024,
      },
      execute,
    });

    await expect(
      runtime.execute({
        ...request("semantic"),
        toolName: "design.semantic-read",
      }),
    ).resolves.toEqual({ nodeId: "node_1" });
    await expect(
      runtime.execute({
        ...request("invalid_semantic"),
        toolName: "design.semantic-read",
        input: { nodeId: 3 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("resolves exact resources without allowing dynamic authority changes", async () => {
    const policy = {
      evaluate: vi.fn((context: PolicyContext) => {
        void context;
        return Promise.resolve("allow" as const);
      }),
    };
    const runtime = new ToolRuntime(
      policy,
      { request: () => Promise.resolve(true) },
      { record: () => Promise.resolve() },
    );
    runtime.register({
      name: "design.dynamic-read",
      description: "Read one resolved document",
      validateInput: () => true,
      capability: {
        capability: "design.read",
        resources: ["document:*"],
        risk: "read",
        sideEffect: false,
        idempotent: true,
        timeoutMs: 1_000,
        outputLimitBytes: 1_024,
      },
      resolveCapability: () => ({
        capability: "design.read",
        resources: ["document:document_1"],
        risk: "read",
        sideEffect: false,
        idempotent: true,
        timeoutMs: 1_000,
        outputLimitBytes: 1_024,
      }),
      execute: (_input, context) =>
        Promise.resolve({
          runId: context.runId,
          toolCallId: context.toolCallId,
          toolName: context.toolName,
        }),
    });

    await expect(
      runtime.execute({
        ...request("dynamic"),
        toolName: "design.dynamic-read",
      }),
    ).resolves.toEqual({
      runId: "run_1",
      toolCallId: "dynamic",
      toolName: "design.dynamic-read",
    });
    const evaluated = policy.evaluate.mock.calls[0]?.[0];
    expect(evaluated?.capability.resources).toEqual(["document:document_1"]);

    const unsafe = runtimeWithTool({
      resolveCapability: () => ({
        capability: "design.read",
        resources: ["document:document_1"],
        risk: "destructive",
        sideEffect: false,
        idempotent: true,
        timeoutMs: 1_000,
        outputLimitBytes: 1_024,
      }),
    });
    await expect(unsafe.execute(request("unsafe_dynamic"))).rejects.toThrow(
      "Resolved tool capability changes declared authority",
    );
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
    resolveCapability?: ToolDefinition<
      { nodeId: string },
      unknown
    >["resolveCapability"];
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
    ...(overrides.resolveCapability
      ? { resolveCapability: overrides.resolveCapability }
      : {}),
  });
  return runtime;
}
