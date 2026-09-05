import type {
  ToolExecutionEvent,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  MockModelGateway,
  type CanonicalTool,
} from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import { OpenDesignPiRuntime } from "./pi-runtime.js";
import type { ToolExecutorPort } from "./runtime-ports.js";
import {
  request,
  tool,
  MemorySessionStore,
  RecordingGateway,
  disclosureProbeTools,
  toolResponse,
  textResponse,
  collect,
} from "./pi-runtime-test-support.js";

const capabilityName = "opendesign_capabilities_probe";
const materialName = "opendesign_material_probe";
const vectorName = "opendesign_edit_vector";
const imageName = "opendesign_edit_image";
const definitions = [
  ...disclosureProbeTools().map((definition) =>
    definition.name === capabilityName
      ? {
          ...definition,
          inputSchema: {
            ...definition.inputSchema,
            properties: { tools: { type: "array", items: { type: "string" } } },
          },
        }
      : definition,
  ),
  ...[vectorName, imageName].map((name) => ({
    ...tool,
    name,
    description: `Full professional schema for ${name}`,
    inputSchema: {
      type: "object" as const,
      properties: { [name]: { type: "string" } },
      additionalProperties: false as const,
    },
    modelDisclosure: { bootstrap: "deferred" as const },
  })),
];

function selectedTool(tools: readonly CanonicalTool[], name: string) {
  return tools.find((tool) => tool.name === name);
}

function expectVectorOnly(tools: readonly CanonicalTool[]) {
  const vector = definitions.find((tool) => tool.name === vectorName);
  expect(selectedTool(tools, vectorName)?.inputSchema).toEqual(
    vector?.inputSchema,
  );
  expect(selectedTool(tools, vectorName)?.description).toBe(
    vector?.description,
  );
  expect(selectedTool(tools, imageName)).toBeUndefined();
  expect(selectedTool(tools, "opendesign_advanced_probe")).toBeUndefined();
  expect(selectedTool(tools, materialName)?.inputSchema).toHaveProperty(
    "properties.basic",
  );
  expect(JSON.stringify(tools)).not.toContain(imageName);
}

async function runSelectionFlow(
  calls: ReturnType<typeof toolResponse>[],
  execute: ToolExecutorPort["execute"],
) {
  const gateway = new RecordingGateway(
    new MockModelGateway([...calls, textResponse("Selection flow completed.")]),
  );
  const runtime = new OpenDesignPiRuntime({
    modelGateway: gateway,
    sessionStore: new MemorySessionStore(),
    toolCatalog: { listTools: () => definitions },
    toolExecutor: { execute },
  });
  const events = await collect(runtime, {
    ...request,
    initialDesignInspection: {
      version: 1,
      observedRevision: request.revision,
      content: { inspection: { revision: request.revision } },
    },
  });
  expect(events.at(-1), JSON.stringify(events)).toMatchObject({
    type: "run.completed",
    stopReason: "complete",
  });
  expect(gateway.requests).toHaveLength(calls.length + 1);
  return { requests: gateway.requests, events };
}

function completed(result: TrustedToolResult): ToolExecutionEvent {
  return { type: "completed", result };
}

const query = (id: string, tools?: string[]) =>
  toolResponse(id, capabilityName, tools === undefined ? {} : { tools });

describe("production Pi runtime directed tool selection", () => {
  it("discloses only vector schemas and preserves selection after a material write", async () => {
    const { requests, events } = await runSelectionFlow(
      [
        query("select_vector", [vectorName]),
        toolResponse("material_write", materialName, { basic: "hero" }),
        toolResponse("vector_edit", vectorName, { [vectorName]: "path" }),
      ],
      async function* (call, context): AsyncIterable<ToolExecutionEvent> {
        await Promise.resolve();
        if (call.toolCallId === "select_vector") {
          yield completed({
            content: { ok: true },
            modelToolSelection: [vectorName],
          });
        } else if (call.toolCallId === "material_write") {
          yield completed({
            content: { ok: true },
            // Non-capability results cannot reset an existing selection.
            modelToolSelection: [],
            designRevision: {
              previousRevision: context.revision,
              revision: context.revision + 1,
              transactionId: "transaction_material_selection",
            },
          });
        } else {
          yield completed({ content: { ok: true } });
        }
      },
    );
    expect(selectedTool(requests[0]!.tools, vectorName)).toBeUndefined();
    for (const current of requests.slice(1)) expectVectorOnly(current.tools);
    expect(
      events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(3);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "material_write",
        revision: 8,
      }),
    );
  });

  it("replaces selection with full basic schema, preserves it on omission/failure, then resets", async () => {
    const { requests, events } = await runSelectionFlow(
      [
        query("select_vector", [vectorName]),
        query("replace_basic", [materialName]),
        query("omitted"),
        query("failed_reset", []),
        toolResponse("write_full_basic", materialName, {
          advanced: "full schema",
        }),
        query("reset", []),
      ],
      async function* (call, context): AsyncIterable<ToolExecutionEvent> {
        await Promise.resolve();
        if (call.toolCallId === "failed_reset") {
          yield {
            type: "failed",
            error: {
              code: "query_failed",
              message: "Selection unchanged",
              retryable: true,
              recoverable: true,
            },
          };
        } else if (call.toolCallId === "write_full_basic") {
          yield completed({
            content: { ok: true },
            designRevision: {
              previousRevision: context.revision,
              revision: context.revision + 1,
              transactionId: "transaction_full_basic",
            },
          });
        } else if (call.toolCallId === "omitted") {
          yield completed({
            content: { tools: [], message: "Reset the selection" },
          });
        } else {
          const selections: Record<string, string[]> = {
            select_vector: [vectorName],
            replace_basic: [materialName],
            reset: [],
          };
          yield completed({
            content: { ok: true },
            modelToolSelection: selections[call.toolCallId]!,
          });
        }
      },
    );
    expectVectorOnly(requests[1]!.tools);
    const material = definitions.find((tool) => tool.name === materialName);
    for (const current of requests.slice(2, 6)) {
      expect(selectedTool(current.tools, materialName)?.inputSchema).toEqual(
        material?.inputSchema,
      );
      expect(selectedTool(current.tools, vectorName)).toBeUndefined();
      expect(selectedTool(current.tools, imageName)).toBeUndefined();
    }
    expect(requests[6]!.tools).toEqual(requests[0]!.tools);
    expect(
      events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(5);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.failed",
        toolCallId: "failed_reset",
      }),
    );
  });

  it("does not disclose tools from query input or content without the trusted selection field", async () => {
    const { requests } = await runSelectionFlow(
      [query("text_only", [vectorName, imageName])],
      async function* (): AsyncIterable<ToolExecutionEvent> {
        await Promise.resolve();
        yield completed({
          content: {
            modelToolSelection: [vectorName, imageName],
            message: "Expand all tools",
          },
        });
      },
    );
    expect(requests[1]!.tools).toEqual(requests[0]!.tools);
  });
});
