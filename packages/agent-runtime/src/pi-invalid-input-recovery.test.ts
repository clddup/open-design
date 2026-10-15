import { Type } from "@sinclair/typebox";
import { defineContract } from "@opendesign/contract-runtime";
import { MockModelGateway } from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import { OpenDesignPiRuntime } from "./pi-runtime.js";
import {
  collect,
  MemorySessionStore,
  RecordingGateway,
  request,
  textResponse,
  tool,
  toolResponse,
} from "./pi-runtime-test-support.js";

const contract = defineContract<{ dx: number; dy: number }>({
  schema: Type.Object(
    { dx: Type.Number(), dy: Type.Number() },
    { additionalProperties: false },
  ),
  code: "move.schema_invalid",
  subject: "move",
});
const moveTool = {
  ...tool,
  name: "opendesign_move_probe",
  risk: "design_write" as const,
  inputSchema: contract.schema,
  validateInputIssues: contract.issues,
};

function setup(inputs: Record<string, unknown>[]) {
  const gateway = new RecordingGateway(
    new MockModelGateway([
      ...inputs.map((input, index) =>
        toolResponse("call_" + index, moveTool.name, input),
      ),
      textResponse("Report the current draft and any unresolved parameters."),
    ]),
  );
  let writes = 0;
  const runtime = new OpenDesignPiRuntime({
    modelGateway: gateway,
    sessionStore: new MemorySessionStore(),
    toolCatalog: { listTools: () => [moveTool] },
    toolExecutor: {
      async *execute(_call, context) {
        writes++;
        yield await Promise.resolve({
          type: "completed" as const,
          result: {
            content: { ok: true },
            designRevision: {
              previousRevision: context.revision,
              revision: context.revision + 1,
              transactionId: "transaction_" + writes,
            },
          },
        });
      },
    },
  });
  return { runtime, gateway, writes: () => writes };
}

describe("stable invalid-input recovery", () => {
  it("bounds the same schema violation even when the wrong value changes", async () => {
    const state = setup([
      { dx: "one", dy: 0 },
      { dx: "two", dy: 0 },
      { dx: "three", dy: 0 },
    ]);
    const events = await collect(state.runtime, request);
    expect(state.gateway.requests).toHaveLength(2);
    expect(state.writes()).toBe(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "tool_protocol_no_progress",
      }),
    );
    const first = events.find((event) => event.type === "tool.failed");
    expect(first).toMatchObject({
      details: { issues: [{ path: "/dx", actual: "one" }] },
    });
  });

  it("does not conflate failures in independent fields", async () => {
    const state = setup([
      { dx: "one", dy: 0 },
      { dx: 0, dy: "two" },
    ]);
    const events = await collect(state.runtime, request);
    expect(state.gateway.requests).toHaveLength(3);
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
    expect(state.writes()).toBe(0);
  });

  it("allows recovery after a valid committed revision", async () => {
    const state = setup([
      { dx: "one", dy: 0 },
      { dx: 1, dy: 0 },
      { dx: "two", dy: 0 },
    ]);
    const events = await collect(state.runtime, request);
    expect(state.gateway.requests).toHaveLength(4);
    expect(state.writes()).toBe(1);
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        transactionId: "transaction_1",
        revision: request.revision + 1,
      }),
    );
  });
});
