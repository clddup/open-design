import {
  type AgentRunRequest,
  type AgentToolDefinition,
  type ToolExecutionEvent,
} from "@opendesign/agent-runtime";
import {
  createOpenDesignPiAgent,
  createPiModelGatewayStreamFn,
  OpenDesignPiRuntime,
  PiRunEventAdapter,
  prepareOpenDesignPiContext,
} from "@opendesign/agent-runtime/pi-migration";
import type { AgentEvent } from "@opendesign/agent-contracts";
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
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
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
  it("starts a host-inspected Run on a plan-only surface", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "opendesign-host-inspected-context-"),
    );
    try {
      const gateway = new RecordingGateway(
        new MockModelGateway("Plan surface accepted"),
      );
      const sessionStore = new JsonlSessionStore(
        join(directory, "events.jsonl"),
      );
      const runtime = new OpenDesignPiRuntime({
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
      });

      const events: AgentEvent[] = [];
      for await (const event of runtime.run({
        runId: "run_host_inspected_context",
        sessionId: "conversation_host_inspected_context",
        prompt: "Create a real dashboard",
        documentId: "document_1",
        revision: 3,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page_1" },
        modelSelection: { providerId: "configured", modelId: "design-model" },
        modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
        initialDesignInspection: {
          version: 1,
          observedRevision: 3,
          content: '{"pageId":"page_1","revision":3}',
        },
      })) {
        events.push(event);
      }

      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "agent.error" }),
      );
      expect(gateway.requests).toHaveLength(1);
      expect(gateway.requests[0]?.tools.map((tool) => tool.name)).toEqual([
        DESIGN_INSPECT_TOOL_NAME,
        DESIGN_PLAN_TOOL_NAME,
        READ_IMAGE_TOOL_NAME,
        PAGE_STRUCTURE_ACCESS_TOOL_NAME,
        DESIGN_PAGE_TOOL_NAME,
      ]);
      expect(gateway.requests[0]?.tools).not.toContainEqual(
        expect.objectContaining({ name: DESIGN_APPLY_TOOL_NAME }),
      );
      expect(gateway.requests[0]?.tools).not.toContainEqual(
        expect.objectContaining({ name: GENERATE_IMAGE_TOOL_NAME }),
      );
      const initialUserMessage = gateway.requests[0]?.messages.find(
        (message) => message.role === "user",
      );
      if (
        !initialUserMessage ||
        typeof initialUserMessage.content !== "string"
      ) {
        throw new Error("Missing host-inspected user projection");
      }
      expect(initialUserMessage.content).toContain('"pageId":"page_1"');
      const durableUser = (
        await sessionStore.read("conversation_host_inspected_context")
      ).find((event) => event.type === "message.user");
      expect(durableUser?.payload).toMatchObject({
        content: "Create a real dashboard",
      });
      expect(JSON.stringify(durableUser)).not.toContain(
        "OpenDesign trusted host context",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reaches the provider with the compact production bootstrap surface", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-context-"));
    try {
      const gateway = new RecordingGateway(
        new MockModelGateway("Production context accepted"),
      );
      const runtime = new OpenDesignPiRuntime({
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

      const events: AgentEvent[] = [];
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
      expect(gateway.requests[0]?.tools).toHaveLength(7);
      expect(gateway.requests[0]?.tools).not.toContainEqual(
        expect.objectContaining({ name: DESIGN_COMPONENT_TOOL_NAME }),
      );
      const completeModelTools = DESIGN_AGENT_TOOL_SPECS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
      expect(JSON.stringify(gateway.requests[0]?.tools).length).toBeLessThan(
        JSON.stringify(completeModelTools).length / 5,
      );
      expect(
        gateway.requests[0]?.tools.find(
          (tool) => tool.name === DESIGN_APPLY_TOOL_NAME,
        )?.inputSchema,
      ).toEqual(DESIGN_BOOTSTRAP_APPLY_INPUT_SCHEMA);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "agent.error" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("adds only inspection-dependent read and export tools before material work", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "opendesign-inspected-tools-"),
    );
    try {
      const gateway = new RecordingGateway(
        new MockModelGateway([
          {
            blocks: [
              {
                id: "inspect_for_export",
                type: "tool_call",
                toolCallId: "inspect_for_export_call",
                name: DESIGN_INSPECT_TOOL_NAME,
                input: {},
              },
            ],
            stopReason: "tool_use",
          },
          {
            blocks: [
              {
                id: "inspection_complete",
                type: "text",
                text: "Inspection complete.",
              },
            ],
            stopReason: "complete",
          },
        ]),
      );
      const runtime = new OpenDesignPiRuntime({
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
        toolExecutor: {
          async *execute(): AsyncIterable<ToolExecutionEvent> {
            await Promise.resolve();
            yield {
              type: "completed",
              result: {
                content: { ok: true, inspectedRevision: 0 },
                observedRevision: 0,
              },
            };
          },
        },
      });

      const events: AgentEvent[] = [];
      for await (const event of runtime.run({
        runId: "run_inspected_tool_disclosure",
        sessionId: "conversation_inspected_tool_disclosure",
        prompt: "Inspect the current Page and export it as SVG.",
        documentId: "document_1",
        revision: 0,
        scope: { kind: "document", selectedNodeIds: [] },
        mutationTarget: { kind: "document" },
        modelSelection: {
          providerId: "configured",
          modelId: "design-model",
        },
        modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
      })) {
        events.push(event);
      }

      expect(gateway.requests[0]?.tools).toHaveLength(7);
      expect(gateway.requests[1]?.tools).toHaveLength(10);
      const inspectedNames = gateway.requests[1]?.tools.map(
        (tool) => tool.name,
      );
      expect(inspectedNames).toEqual(
        expect.arrayContaining([
          DESIGN_CAPABILITIES_TOOL_NAME,
          EXPORT_SVG_TOOL_NAME,
          EXPORT_RASTER_TOOL_NAME,
        ]),
      );
      expect(inspectedNames).not.toEqual(
        expect.arrayContaining([
          DESIGN_CAPTURE_TOOL_NAME,
          DESIGN_REVIEW_TOOL_NAME,
          DESIGN_COMPONENT_TOOL_NAME,
        ]),
      );
      expect(events.at(-1)).toMatchObject({
        type: "run.completed",
        stopReason: "complete",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("compacts an eight-turn production tool loop without discarding its journal", async () => {
    const directory = await mkdtemp(join(tmpdir(), "opendesign-context-loop-"));
    try {
      const responses: MockModelResponse[] = [
        {
          blocks: [
            {
              id: "page_write_before_capture_loop",
              type: "tool_call" as const,
              toolCallId: "page_write_before_capture_loop_call",
              name: DESIGN_PAGE_TOOL_NAME,
              input: {
                action: "rename",
                label: "Rename current Page",
                pageId: "page_1",
                name: "Current Page",
              },
            },
          ],
          stopReason: "tool_use" as const,
        },
        ...Array.from({ length: 6 }, (_, index) => ({
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
        })),
      ];
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
      const runtime = new OpenDesignPiRuntime({
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
          async *execute(call): AsyncIterable<ToolExecutionEvent> {
            await Promise.resolve();
            yield {
              type: "completed",
              result:
                call.toolName === DESIGN_PAGE_TOOL_NAME
                  ? {
                      content: { ok: true, pageId: "page_1" },
                      designRevision: {
                        previousRevision: 147,
                        revision: 148,
                        transactionId: "transaction_page_rename",
                      },
                    }
                  : { content: captureResult },
            };
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
      expect(gateway.requests[0]?.tools).toHaveLength(7);
      expect(
        gateway.requests
          .slice(1)
          .every(
            (request) =>
              request.system === OPENDESIGN_AGENT_SYSTEM_PROMPT &&
              request.tools.length === 22,
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

  it("runs the same eight-turn production multimodal budget through Pi transformContext", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "opendesign-pi-context-loop-"),
    );
    try {
      const responses: MockModelResponse[] = Array.from(
        { length: 7 },
        (_, index) => ({
          blocks: [
            {
              id: `pi_capture_block_${index + 1}`,
              type: "tool_call" as const,
              toolCallId: `pi_capture_call_${index + 1}`,
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
            id: "pi_production_loop_complete",
            type: "text" as const,
            text: "Pi production loop completed after transformContext compaction.",
          },
        ],
        stopReason: "complete" as const,
      });
      const gateway = new RecordingGateway(new MockModelGateway(responses));
      const sessionStore = new JsonlSessionStore(
        join(directory, "events.jsonl"),
      );
      const definitions: AgentToolDefinition[] = DESIGN_AGENT_TOOL_SPECS.map(
        (tool) => ({
          ...tool,
          inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
          validateInput: (input: unknown) =>
            validateDesignAgentToolInput(tool.name, input),
        }),
      );
      const request: AgentRunRequest = {
        runId: "run_pi_production_context_loop",
        sessionId: "conversation_pi_production_context_loop",
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
      };
      const model = {
        id: request.modelSelection.modelId,
        name: "Design model",
        api: "openai-responses" as const,
        provider: request.modelSelection.providerId,
        baseUrl: "https://provider.invalid/v1",
        reasoning: true,
        input: ["text", "image"] as ("text" | "image")[],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384,
      };
      const prepared = await prepareOpenDesignPiContext({
        request,
        sessionStore,
        systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
        toolDefinitions: definitions,
        model,
      });
      const captureAuditMarker = "pi_production_capture_audit_marker";
      const captureResult = {
        ok: true,
        auditMarker: captureAuditMarker,
        width: 1_440,
        height: 1_024,
        attachments: ["d", "e", "f"].map((digest) => ({
          attachmentId: `image_${digest.repeat(64)}`,
          name: `pi-production-capture-${digest}.png`,
          mimeType: "image/png" as const,
          byteSize: 1_024,
        })),
      };
      const events: AgentEvent[] = [];
      const agentReference: {
        current?: ReturnType<typeof createOpenDesignPiAgent>;
      } = {};
      const adapter = new PiRunEventAdapter({
        request,
        sessionStore,
        emit: (event) => {
          events.push(event);
        },
        toolDefinitions: definitions,
        toolExecutor: {
          async *execute(): AsyncIterable<ToolExecutionEvent> {
            await Promise.resolve();
            yield { type: "completed", result: { content: captureResult } };
          },
        },
        contextFailurePort: prepared.context,
        requestContinuation: (message) =>
          agentReference.current?.steer(message),
      });
      const agent = createOpenDesignPiAgent({
        initialState: {
          messages: prepared.initialMessages,
          model,
          systemPrompt: prepared.systemPrompt,
          thinkingLevel: "off",
          tools: [...adapter.tools],
        },
        sessionId: request.sessionId,
        streamFn: createPiModelGatewayStreamFn({
          modelGateway: gateway,
          contextProjection: prepared.context,
        }),
        transformContext: prepared.context.transformContext,
        beforeToolCall: adapter.beforeToolCall,
        shouldStopAfterTurn: adapter.shouldStopAfterTurn,
      });
      agentReference.current = agent;
      const unsubscribe = agent.subscribe((event) => adapter.accept(event));
      try {
        await agent.prompt(prepared.promptMessage);
      } finally {
        unsubscribe();
        agent.abort();
        await agent.waitForIdle();
      }

      expect(gateway.requests).toHaveLength(8);
      expect(
        gateway.requests.every(
          (providerRequest) =>
            providerRequest.system === OPENDESIGN_AGENT_SYSTEM_PROMPT &&
            providerRequest.tools.length === 22,
        ),
      ).toBe(true);
      expect(
        gateway.requests.some((providerRequest) =>
          JSON.stringify(providerRequest.messages).includes(
            "OpenDesign in-run context checkpoint",
          ),
        ),
      ).toBe(true);
      expect(
        gateway.requests.some((providerRequest) =>
          providerRequest.messages.some(
            (message) =>
              message.role === "user" &&
              Array.isArray(message.content) &&
              message.content.some((block) => block.type === "image_ref"),
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
      const journal = await sessionStore.read(request.sessionId);
      expect(
        journal.filter((event) => event.type === "tool.completed"),
      ).toHaveLength(7);
      expect(JSON.stringify(journal)).toContain(captureAuditMarker);
      expect(JSON.stringify(agent.state.messages)).not.toContain("data:image");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
