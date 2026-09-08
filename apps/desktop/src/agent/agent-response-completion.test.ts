import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type * as PiMigration from "@opendesign/agent-runtime/pi-migration";
import type { AgentRuntimeOptions } from "@opendesign/agent-runtime";
import type { AgentEvent } from "@opendesign/agent-contracts";
import { MockModelGateway } from "@opendesign/model-gateway";
import { JsonlSessionStore } from "@opendesign/session-store";

const constructed = vi.hoisted(() =>
  vi.fn<(options: AgentRuntimeOptions) => void>(),
);
vi.mock("@opendesign/agent-runtime/pi-migration", () => ({
  OpenDesignPiRuntime: class {
    constructor(options: AgentRuntimeOptions) {
      constructed(options);
    }
  },
}));

async function productionOptions(): Promise<AgentRuntimeOptions> {
  const descriptor = Object.getOwnPropertyDescriptor(process, "parentPort");
  Object.defineProperty(process, "parentPort", {
    configurable: true,
    value: { on: vi.fn(), postMessage: vi.fn() },
  });
  try {
    await import("./index");
    return constructed.mock.calls[0][0];
  } finally {
    if (descriptor) Object.defineProperty(process, "parentPort", descriptor);
    else Reflect.deleteProperty(process, "parentPort");
  }
}

async function setup(root: string) {
  const options = await productionOptions();
  const { OpenDesignPiRuntime } = await vi.importActual<typeof PiMigration>(
    "@opendesign/agent-runtime/pi-migration",
  );
  const store = new JsonlSessionStore(join(root, "events.jsonl"));
  const model = new MockModelGateway(responses);
  const stream = vi.fn(model.stream.bind(model));
  const runtime = new OpenDesignPiRuntime({
    ...options,
    modelGateway: { stream },
    sessionStore: store,
    toolCatalog: {
      listTools: () => [
        {
          name: "opendesign_capture_canvas",
          description: "Capture the design",
          validateInputIssues: () => [],
          risk: "read",
          approval: "never",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      ],
    },
    toolExecutor: {
      async *execute() {
        await Promise.resolve();
        yield {
          type: "completed",
          result: {
            observedRevision: 654,
            content: { delivery: reviewedDelivery },
          },
        };
      },
    },
  });
  return { store, stream, runtime };
}

const responses: ConstructorParameters<typeof MockModelGateway>[0] = [
  {
    blocks: [
      {
        id: "capture",
        type: "tool_call",
        toolCallId: "capture",
        name: "opendesign_capture_canvas",
        input: {},
      },
    ],
    stopReason: "tool_use",
  },
  {
    blocks: [
      {
        id: "draft",
        type: "text",
        text: "当前为首页初版，审核指出文字拥挤，尚未最终交付。",
      },
    ],
    stopReason: "complete",
  },
  {
    blocks: [{ id: "next", type: "text", text: "继续调整文字间距。" }],
    stopReason: "complete",
  },
];

it("lets the production Agent finish an honest draft response and continue the Conversation", async () => {
  const root = await mkdtemp(join(tmpdir(), "opendesign-response-completion-"));
  try {
    const { store, stream, runtime } = await setup(root);
    const request = {
      runId: "draft_run",
      sessionId: "conversation",
      documentId: "document",
      revision: 654,
      prompt: "检查当前设计",
      scope: { kind: "page" as const, pageId: "page", selectedNodeIds: [] },
      mutationTarget: { kind: "page" as const, pageId: "page" },
      modelSelection: { providerId: "mock", modelId: "mock" },
    };
    const events: AgentEvent[] = [];
    for await (const event of runtime.run(request)) events.push(event);
    expect(events.filter((event) => event.type === "agent.error")).toEqual([]);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(stream).toHaveBeenCalledTimes(2);
    const journal = await store.read(request.sessionId);
    expect(journal.some((entry) => entry.type === "completion.review")).toBe(
      false,
    );
    expect(JSON.stringify(journal)).toContain("当前为首页初版");
    expect(JSON.stringify(journal)).not.toContain("verifiedRevision");
    for await (const event of runtime.run({
      ...request,
      runId: "next_run",
      prompt: "继续调整",
    }))
      events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(stream).toHaveBeenCalledTimes(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

const reviewedDelivery = {
  version: 4,
  activeTargetId: "home",
  targets: [
    {
      targetId: "home",
      label: "首页",
      pageId: "page",
      rootNodeId: "frame_home",
      reservedNodeIds: ["frame_home"],
      status: "reviewed",
      allocatedRevision: 653,
      draftRevision: 654,
      captureRevision: 654,
      reviewRevision: 654,
    },
  ],
  planExecution: {
    planRevision: 1,
    targets: [
      {
        targetId: "home",
        steps: [
          {
            stepId: "home.build",
            label: "实现首页",
            kind: "implementation",
            status: "completed",
            startedRevision: 653,
            completedRevision: 654,
          },
          {
            stepId: "home.review-refine",
            label: "Review and refine the rendered target",
            kind: "review-refine",
            status: "in_progress",
            startedRevision: 654,
          },
        ],
      },
    ],
  },
};
