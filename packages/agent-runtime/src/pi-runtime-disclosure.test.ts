import type { ToolExecutionEvent } from "@opendesign/agent-contracts";
import { MockModelGateway } from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import { OpenDesignPiRuntime } from "./pi-runtime.js";
import {
  request,
  MemorySessionStore,
  RecordingGateway,
  disclosureProbeTools,
  toolResponse,
  textResponse,
  collect,
} from "./pi-runtime-test-support.js";

describe("production runtime execution-fact disclosure", () => {
  it("keeps Plan allocation and post-write continuation compact", async () => {
    const store = new MemorySessionStore();
    const definitions = disclosureProbeTools();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        toolResponse("plan_call", "opendesign_plan_probe", {}),
        toolResponse("material_call", "opendesign_material_probe", {
          basic: "hero",
        }),
        textResponse("First material design is visible."),
      ]),
    );
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => definitions },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: { ok: true },
              designRevision: {
                previousRevision: context.revision,
                revision: context.revision + 1,
                transactionId: `transaction_${call.toolCallId}`,
              },
            },
          };
        },
      },
    });

    await collect(runtime, {
      ...request,
      runId: "run_pi_progressive_disclosure",
    });

    expect(gateway.requests).toHaveLength(3);
    expect(
      gateway.requests[0]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
    ]);
    expect(
      gateway.requests[1]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
    ]);
    expect(
      JSON.stringify(
        gateway.requests[1]?.tools.find(
          (candidate) => candidate.name === "opendesign_material_probe",
        )?.inputSchema,
      ),
    ).toContain('"basic"');
    expect(
      gateway.requests[2]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
      "opendesign_capabilities_probe",
    ]);
    expect(
      JSON.stringify(
        gateway.requests[2]?.tools.find(
          (candidate) => candidate.name === "opendesign_material_probe",
        )?.inputSchema,
      ),
    ).toContain('"basic"');
  });

  it("executes host-inspected Plan and the first material slice sequentially in one Provider turn", async () => {
    const store = new MemorySessionStore();
    const definitions = disclosureProbeTools();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        {
          blocks: [
            {
              id: "same_turn_plan_block",
              type: "tool_call",
              toolCallId: "same_turn_plan",
              name: "opendesign_plan_probe",
              input: { targets: [{ artboard: { mode: "create" } }] },
            },
            {
              id: "same_turn_material_block",
              type: "tool_call",
              toolCallId: "same_turn_material",
              name: "opendesign_material_probe",
              input: { basic: "hero" },
            },
          ],
          stopReason: "tool_use",
        },
        textResponse("The first real section is visible."),
      ]),
    );
    const executions: Array<{ toolName: string; revision: number }> = [];
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => definitions },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          executions.push({
            toolName: call.toolName,
            revision: context.revision,
          });
          yield {
            type: "completed",
            result: {
              content: { ok: true },
              designRevision: {
                previousRevision: context.revision,
                revision: context.revision + 1,
                transactionId: `transaction_${call.toolCallId}`,
              },
            },
          };
        },
      },
    });

    await collect(runtime, {
      ...request,
      runId: "run_pi_host_inspected_same_turn",
      initialDesignInspection: {
        version: 1,
        observedRevision: request.revision,
        content: {
          inspection: { pageId: "page_1", revision: 7 },
        },
      },
    });

    expect(gateway.requests).toHaveLength(2);
    expect(
      gateway.requests[0]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
      "opendesign_capabilities_probe",
    ]);
    expect(executions).toEqual([
      { toolName: "opendesign_plan_probe", revision: 7 },
      { toolName: "opendesign_material_probe", revision: 8 },
    ]);
    expect(
      gateway.requests[1]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
      "opendesign_capabilities_probe",
    ]);
  });

  it("expands advanced tools only after explicit capability discovery", async () => {
    const store = new MemorySessionStore();
    const definitions = disclosureProbeTools();
    const gateway = new RecordingGateway(
      new MockModelGateway([
        toolResponse("inspect_call", "opendesign_inspect_probe", {}),
        toolResponse("existing_plan_call", "opendesign_plan_probe", {
          targets: [{ artboard: { mode: "existing" } }],
        }),
        toolResponse("capabilities_call", "opendesign_capabilities_probe", {}),
        toolResponse("advanced_call", "opendesign_advanced_probe", {}),
        textResponse("Existing design updated."),
      ]),
    );
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
      toolCatalog: { listTools: () => definitions },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result:
              call.toolName === "opendesign_inspect_probe"
                ? {
                    content: { revision: context.revision },
                    observedRevision: context.revision,
                  }
                : {
                    content: { ok: true },
                    designRevision: {
                      previousRevision: context.revision,
                      revision: context.revision + 1,
                      transactionId: `transaction_${call.toolCallId}`,
                    },
                  },
          };
        },
      },
    });

    await collect(runtime, {
      ...request,
      runId: "run_pi_existing_edit_disclosure",
    });

    expect(gateway.requests[0]?.tools).toHaveLength(3);
    expect(gateway.requests[1]?.tools).toHaveLength(4);
    expect(
      gateway.requests[2]?.tools.map((candidate) => candidate.name),
    ).toEqual([
      "opendesign_inspect_probe",
      "opendesign_plan_probe",
      "opendesign_material_probe",
      "opendesign_capabilities_probe",
    ]);
    expect(
      gateway.requests[3]?.tools.map((candidate) => candidate.name),
    ).toEqual(definitions.map((definition) => definition.name));
  });
});
