import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { MockModelGateway, type ModelRequest } from "@opendesign/model-gateway";
import {
  isTrustedToolFailure,
  type ToolExecutionEvent,
} from "@opendesign/agent-contracts";
import { OpenDesignPiRuntime } from "@opendesign/agent-runtime/pi-migration";
import { JsonlSessionStore } from "@opendesign/session-store";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import { applyDesignGenerationAndCapture } from "./design-generation-capture-orchestrator";

it("does not replay a committed design generation or request another model turn after terminal review failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "opendesign-review-failure-"));
  try {
    const requests: ModelRequest[] = [];
    let writes = 0;
    const model = new MockModelGateway([
      {
        blocks: [
          {
            id: "slice",
            type: "tool_call",
            toolCallId: "slice",
            name: "opendesign_generate_design",
            input: {},
          },
        ],
        stopReason: "tool_use",
      },
      {
        blocks: [{ id: "next", type: "text", text: "下一条消息仍可继续" }],
        stopReason: "complete",
      },
    ]);
    const runtime = new OpenDesignPiRuntime({
      sessionStore: new JsonlSessionStore(join(root, "events.jsonl")),
      modelGateway: {
        stream: (request) => {
          requests.push(request);
          return model.stream(request);
        },
      },
      toolCatalog: {
        listTools: () => [
          {
            name: "opendesign_generate_design",
            description: "Design generation orchestration test",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            risk: "design_write",
            approval: "never",
            validateInputIssues: () => [],
          },
        ],
      },
      toolExecutor: {
        async *execute(): AsyncIterable<ToolExecutionEvent> {
          try {
            const result = await applyDesignGenerationAndCapture({
              designGeneration: () => {
                writes += 1;
                return Promise.resolve({
                  content: { ok: true },
                  designRevision: {
                    previousRevision: 4,
                    revision: 5,
                    transactionId: "committed",
                  },
                });
              },
              capture: () =>
                Promise.reject(
                  designWorkflowError(
                    "visual_critic_unavailable",
                    "Committed revision 5 retained; review timed out",
                    { terminal: true },
                  ),
                ),
              getDelivery: () => ({ activeTargetId: "target" }),
            });
            yield { type: "completed", result };
          } catch (error) {
            if (!(error instanceof Error) || !isTrustedToolFailure(error.cause))
              throw error;
            yield { type: "failed", error: error.cause };
          }
        },
      },
    });
    const request = {
      runId: "failed_review",
      sessionId: "conversation",
      documentId: "document",
      revision: 4,
      prompt: "Create a design",
      scope: { kind: "document" as const, selectedNodeIds: [] },
      mutationTarget: { kind: "document" as const },
      modelSelection: { providerId: "mock", modelId: "mock" },
    };
    const events = [];
    for await (const event of runtime.run(request)) events.push(event);
    expect(events.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "error",
    });
    expect(requests).toHaveLength(1);
    expect(writes).toBe(1);
    const nextEvents = [];
    for await (const event of runtime.run({
      ...request,
      runId: "next_user",
      revision: 5,
      prompt: "继续对话",
    }))
      nextEvents.push(event);
    expect(nextEvents.at(-1)).toMatchObject({
      type: "run.completed",
      stopReason: "complete",
    });
    expect(requests).toHaveLength(2);
    expect(writes).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
