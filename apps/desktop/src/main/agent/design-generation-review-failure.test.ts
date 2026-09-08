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
import { dispatchDesignGenerationOrCapture } from "./design-generation-dispatcher";

it("returns the committed generation before explicit capture and preserves it while the Agent reports an unavailable review", async () => {
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
            id: "review_unavailable",
            type: "text",
            text: "设计与截图已保留，但审核连接失败，尚未验证。",
          },
        ],
        stopReason: "complete",
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
        listTools: () =>
          ["opendesign_generate_design", "opendesign_capture_canvas"].map(
            (name) => ({
              name,
              description: "Generation and explicit capture test",
              inputSchema: {
                type: "object",
                properties: {},
                additionalProperties: false,
              },
              risk: "design_write" as const,
              approval: "never" as const,
              validateInputIssues: () => [],
            }),
          ),
      },
      toolExecutor: {
        async *execute(call): AsyncIterable<ToolExecutionEvent> {
          try {
            const result = await dispatchDesignGenerationOrCapture(call, {
              generate: () => {
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
              captureReview: {
                handle: () =>
                  Promise.reject(
                    designWorkflowError(
                      "visual_critic_unavailable",
                      "Committed revision 5 retained; review timed out",
                    ),
                  ),
              },
            });
            if (!result) throw new Error("Unexpected tool");
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
      stopReason: "complete",
    });
    expect(requests).toHaveLength(3);
    expect(JSON.stringify(events)).toContain("审核连接失败，尚未验证");
    expect(JSON.stringify(requests[2])).toContain("review timed out");
    expect(events.some((event) => event.type === "agent.error")).toBe(false);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "tool.completed",
        toolCallId: "slice",
        revision: 5,
      }),
    );
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
    expect(requests).toHaveLength(4);
    expect(writes).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
