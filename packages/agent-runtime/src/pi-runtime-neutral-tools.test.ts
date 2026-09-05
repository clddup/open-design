import type { ToolExecutionEvent } from "@opendesign/agent-contracts";
import { MockModelGateway } from "@opendesign/model-gateway";
import { describe, expect, it, vi } from "vitest";
import type { AgentRunRequest, AgentRuntimeOptions } from "./index.js";
import { OpenDesignPiRuntime } from "./pi-runtime.js";
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

const scopeTool = {
  ...tool,
  name: "opendesign_scope_probe",
  modelDisclosure: { bootstrap: "available", role: "delivery-scope" },
} as const;
const definitions = [...disclosureProbeTools(), scopeTool];
const pageRequest: AgentRunRequest = {
  ...request,
  prompt: "Create a polished dashboard",
  scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page_1" },
};
const inspectedRequest: AgentRunRequest = {
  ...pageRequest,
  initialDesignInspection: {
    version: 1,
    observedRevision: request.revision,
    content: {
      inspection: {
        document: {
          documentId: request.documentId,
          revision: request.revision,
          pagesById: { page_1: { id: "page_1", rootNodeIds: [] } },
          nodesById: {},
        },
      },
    },
  },
};
const bootstrapNames = [
  "opendesign_inspect_probe",
  "opendesign_plan_probe",
  "opendesign_material_probe",
  scopeTool.name,
];
const inspectedNames = [
  ...bootstrapNames.slice(0, -1),
  "opendesign_capabilities_probe",
  scopeTool.name,
];

async function firstTurn(
  runRequest: AgentRunRequest,
  options: Partial<AgentRuntimeOptions> = {},
) {
  const gateway = new RecordingGateway(
    new MockModelGateway(textResponse("Ready.")),
  );
  const runtime = new OpenDesignPiRuntime({
    modelGateway: gateway,
    sessionStore: new MemorySessionStore(),
    toolCatalog: { listTools: () => definitions },
    systemPrompt: "One neutral design system prompt.",
    ...options,
  });
  const events = await collect(runtime, runRequest);
  expect(events.at(-1)).toMatchObject({
    type: "run.completed",
    stopReason: "complete",
  });
  expect(gateway.requests).toHaveLength(1);
  const first = gateway.requests[0];
  if (!first) throw new Error("Expected the first Provider request");
  return first;
}

describe("production runtime neutral first-turn tools", () => {
  it.each([false, true])(
    "sends identical first-turn tools for different prompts with host inspection=%s",
    async (hostInspected) => {
      const boundRequest = hostInspected ? inspectedRequest : pageRequest;
      const baseline = await firstTurn(boundRequest);
      expect(baseline.tools.map((candidate) => candidate.name)).toEqual(
        hostInspected ? inspectedNames : bootstrapNames,
      );
      for (const prompt of [
        "Create a polished dashboard",
        "继续优化当前 dashboard",
        "删除页面",
        "Inspect and refine the dashboard",
        "设计四个 Logo，选择最强方向继续完成",
        "你好",
      ]) {
        const current = await firstTurn({ ...boundRequest, prompt });
        expect(current.tools).toEqual(baseline.tools);
        expect(current.system).toBe(baseline.system);
      }
    },
  );

  it.each([
    {
      attachments: [
        {
          attachmentId: `image_${"a".repeat(64)}`,
          name: "reference.png",
          mimeType: "image/png",
          byteSize: 1024,
        },
      ],
    },
    {
      attachments: [
        {
          attachmentId: `file_${"b".repeat(64)}`,
          name: "brief.md",
          mimeType: "text/markdown",
          byteSize: 1024,
        },
      ],
    },
    {
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: ["node_1"] },
    },
    {
      continuation: {
        parentRunId: "run_parent",
        rootRunId: "run_parent",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
      },
    },
  ] satisfies Partial<AgentRunRequest>[])(
    "does not route tools by attachments, selection or continuation: %j",
    async (context) => {
      const baseline = await firstTurn(inspectedRequest);
      const current = await firstTurn({ ...inspectedRequest, ...context });
      expect(current.tools).toEqual(baseline.tools);
      expect(current.system).toBe(baseline.system);
    },
  );

  it("uses only the request for generic prompt and thinking callbacks", async () => {
    const systemPromptForRequest = vi.fn(
      (current: AgentRunRequest) => `Bound document: ${current.documentId}`,
    );
    const thinkingLevelForRequest = vi.fn(() => "high" as const);
    const first = await firstTurn(inspectedRequest, {
      systemPromptForRequest,
      thinkingLevelForRequest,
    });
    expect(systemPromptForRequest.mock.calls).toEqual([[inspectedRequest]]);
    expect(thinkingLevelForRequest.mock.calls).toEqual([[inspectedRequest]]);
    expect(first.system).toBe(`Bound document: ${inspectedRequest.documentId}`);
    expect(first.modelSelection.reasoningEffort).toBe("high");
    expect(first.tools.map((candidate) => candidate.name)).toEqual(
      inspectedNames,
    );
  });

  it("keeps scope and Plan available after scope and material execution", async () => {
    const gateway = new RecordingGateway(
      new MockModelGateway([
        toolResponse("scope_call", scopeTool.name, {}),
        toolResponse("material_call", "opendesign_material_probe", {
          basic: "hero",
        }),
        textResponse("Ready."),
      ]),
    );
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: new MemorySessionStore(),
      toolCatalog: { listTools: () => definitions },
      toolExecutor: {
        async *execute(call, context): AsyncIterable<ToolExecutionEvent> {
          await Promise.resolve();
          yield {
            type: "completed",
            result: {
              content: { ok: true },
              ...(call.toolName === "opendesign_material_probe"
                ? {
                    designRevision: {
                      previousRevision: context.revision,
                      revision: context.revision + 1,
                      transactionId: "transaction_material",
                    },
                  }
                : {}),
            },
          };
        },
      },
    });
    const events = await collect(runtime, inspectedRequest);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(gateway.requests).toHaveLength(3);
    for (const turn of gateway.requests) {
      expect(turn.tools.map((candidate) => candidate.name)).toEqual(
        inspectedNames,
      );
    }
    expect(
      events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(2);
  });
});
