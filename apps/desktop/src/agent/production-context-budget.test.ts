import {
  AgentRuntime,
  type ToolExecutionEvent,
} from "@opendesign/agent-runtime";
import {
  MockModelGateway,
  type MockModelResponse,
  type ModelGateway,
  type ModelRequest,
} from "@opendesign/model-gateway";
import { JsonlSessionStore } from "@opendesign/session-store";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  validateDesignAgentToolInput,
} from "../shared/design-agent-tools";
import { OPENDESIGN_AGENT_SYSTEM_PROMPT } from "./system-prompt";

class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(request: ModelRequest) {
    this.requests.push(request);
    return this.delegate.stream(request);
  }
}

describe("production Agent context budget", () => {
  it("reaches the provider with the complete production prompt and twelve tools", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-context-"));
    try {
      const gateway = new RecordingGateway(
        new MockModelGateway("Production context accepted"),
      );
      const runtime = new AgentRuntime({
        modelGateway: gateway,
        sessionStore: new JsonlSessionStore(join(directory, "events.jsonl")),
        systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
        toolCatalog: {
          listTools: () =>
            DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
              ...tool,
              inputSchema: tool.inputSchema as unknown as Record<
                string,
                unknown
              >,
              validateInput: (input: unknown) =>
                validateDesignAgentToolInput(tool.name, input),
            })),
        },
      });

      const events = [];
      for await (const event of runtime.run({
        runId: "run_production_context",
        sessionId: "conversation_production_context",
        prompt: "Inspect the current page and propose a visual refinement.",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
        modelSelection: {
          providerId: "configured",
          modelId: "design-model",
          reasoningEffort: "medium",
        },
        modelContext: {
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
        },
      })) {
        events.push(event);
      }

      expect(gateway.requests).toHaveLength(1);
      expect(gateway.requests[0]?.system).toBe(OPENDESIGN_AGENT_SYSTEM_PROMPT);
      expect(gateway.requests[0]?.tools).toHaveLength(12);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "agent.error" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compacts an eight-turn production tool loop without discarding its journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-context-loop-"));
    try {
      const responses: MockModelResponse[] = Array.from(
        { length: 7 },
        (_, index) => ({
          blocks: [
            {
              id: `capture_block_${index + 1}`,
              type: "tool_call" as const,
              toolCallId: `capture_call_${index + 1}`,
              name: "opendesign_capture_canvas",
              input: {},
            },
          ],
          stopReason: "tool_use" as const,
        }),
      );
      responses.push({
        blocks: [
          {
            id: "production_loop_complete",
            type: "text" as const,
            text: "Production loop completed after in-run compaction.",
          },
        ],
        stopReason: "complete" as const,
      });
      const gateway = new RecordingGateway(new MockModelGateway(responses));
      const sessionStore = new JsonlSessionStore(
        join(directory, "events.jsonl"),
      );
      const captureAuditMarker = "production_capture_audit_marker";
      const captureResult = {
        ok: true,
        auditMarker: captureAuditMarker,
        width: 1_440,
        height: 1_024,
        attachments: ["a", "b", "c"].map((digest) => ({
          attachmentId: `image_${digest.repeat(64)}`,
          name: `production-capture-${digest}.png`,
          mimeType: "image/png",
          byteSize: 1_024,
        })),
      };
      const runtime = new AgentRuntime({
        modelGateway: gateway,
        sessionStore,
        systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
        toolCatalog: {
          listTools: () =>
            DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
              ...tool,
              inputSchema: tool.inputSchema as unknown as Record<
                string,
                unknown
              >,
              validateInput: (input: unknown) =>
                validateDesignAgentToolInput(tool.name, input),
            })),
        },
        toolExecutor: {
          async *execute(): AsyncIterable<ToolExecutionEvent> {
            await Promise.resolve();
            yield { type: "completed", result: { content: captureResult } };
          },
        },
      });

      const events = [];
      for await (const event of runtime.run({
        runId: "run_production_context_loop",
        sessionId: "conversation_production_context_loop",
        prompt: "Inspect and refine the current design until it is complete.",
        documentId: "document_1",
        revision: 147,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
        modelSelection: {
          providerId: "configured",
          modelId: "design-model",
          reasoningEffort: "medium",
        },
        modelContext: {
          contextWindow: 200_000,
          maxOutputTokens: 16_384,
        },
      })) {
        events.push(event);
      }

      expect(gateway.requests).toHaveLength(8);
      expect(
        gateway.requests.every(
          (request) =>
            request.system === OPENDESIGN_AGENT_SYSTEM_PROMPT &&
            request.tools.length === 12,
        ),
      ).toBe(true);
      expect(
        gateway.requests.some((request) =>
          JSON.stringify(request.messages).includes(
            "OpenDesign in-run context checkpoint",
          ),
        ),
      ).toBe(true);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "agent.error" }),
      );
      expect(events).toContainEqual(
        expect.objectContaining({
          type: "run.completed",
          stopReason: "complete",
        }),
      );
      const journal = await sessionStore.read(
        "conversation_production_context_loop",
      );
      expect(
        journal.filter((event) => event.type === "tool.completed"),
      ).toHaveLength(7);
      expect(JSON.stringify(journal)).toContain(captureAuditMarker);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
