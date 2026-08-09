import { Type } from "@sinclair/typebox";
import { describe, expect, it, vi } from "vitest";
import { ToolRuntime } from "./index.js";

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
});
