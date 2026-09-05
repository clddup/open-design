import type { AgentEvent } from "@opendesign/agent-contracts";
import type { ModelGateway, ModelRequest } from "@opendesign/model-gateway";
import {
  projectTimeline,
  type JournalEvent,
  type SessionProjection,
  type SessionStore,
} from "@opendesign/session-store";
import type { AgentRunRequest, AgentToolDefinition } from "./index.js";
import type { OpenDesignPiRuntime } from "./pi-runtime.js";

export const request: AgentRunRequest = {
  runId: "run_pi_runtime",
  sessionId: "conversation_pi_runtime",
  prompt: "Inspect the current design",
  documentId: "document_pi_runtime",
  revision: 7,
  scope: { kind: "document", selectedNodeIds: [] },
  mutationTarget: { kind: "document" },
  modelSelection: {
    providerId: "configured",
    modelId: "design-model",
    reasoningEffort: "medium",
  },
  modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
};

export const tool: AgentToolDefinition = {
  name: "opendesign_runtime_probe",
  description: "Exercises the production Pi runtime tool boundary.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  validateInputIssues: (input) =>
    typeof input === "object" && input !== null && !Array.isArray(input)
      ? []
      : [{ path: "/", message: "Expected an object" }],
};

export class MemorySessionStore implements SessionStore {
  readonly events: JournalEvent[] = [];

  append<T>(event: JournalEvent<T>): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }

  read(sessionId: string): Promise<JournalEvent[]> {
    return Promise.resolve(
      this.events
        .filter((event) => event.sessionId === sessionId)
        .sort((left, right) => left.sequence - right.sequence),
    );
  }

  async readTimeline(sessionId: string) {
    return projectTimeline(sessionId, await this.read(sessionId));
  }

  appendNext<T>(
    sessionId: string,
    createEvent: (sequence: number) => JournalEvent<T>,
  ): Promise<JournalEvent<T>> {
    const sequence =
      this.events
        .filter((event) => event.sessionId === sessionId)
        .reduce((maximum, event) => Math.max(maximum, event.sequence), 0) + 1;
    const event = createEvent(sequence);
    this.events.push(event);
    return Promise.resolve(event);
  }

  async project(sessionId: string): Promise<SessionProjection> {
    const events = await this.read(sessionId);
    return {
      sessionId,
      lastSequence: events.at(-1)?.sequence ?? 0,
      messageCount: events.filter((event) => event.type.startsWith("message."))
        .length,
      toolCallCount: events.filter((event) => event.type === "tool.requested")
        .length,
      compactedRanges: [],
    };
  }
}

export class RecordingGateway implements ModelGateway {
  readonly requests: ModelRequest[] = [];

  constructor(private readonly delegate: ModelGateway) {}

  stream(modelRequest: ModelRequest) {
    this.requests.push(modelRequest);
    return this.delegate.stream(modelRequest);
  }
}

export function disclosureProbeTools(): AgentToolDefinition[] {
  const emptySchema = {
    type: "object",
    properties: {},
    additionalProperties: false,
  } as const;
  return [
    {
      ...tool,
      name: "opendesign_inspect_probe",
      modelDisclosure: {
        bootstrap: "available",
        role: "inspection",
      },
    },
    {
      ...tool,
      name: "opendesign_plan_probe",
      risk: "design_write",
      inputSchema: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            items: {
              type: "object",
              properties: {
                artboard: {
                  type: "object",
                  properties: { mode: { enum: ["create", "existing"] } },
                  required: ["mode"],
                  additionalProperties: false,
                },
              },
              required: ["artboard"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
      modelDisclosure: { bootstrap: "available", role: "plan" },
    },
    {
      ...tool,
      name: "opendesign_material_probe",
      risk: "design_write",
      inputSchema: {
        type: "object",
        properties: { advanced: { type: "string" } },
        additionalProperties: false,
      },
      modelDisclosure: {
        bootstrap: "available",
        continuation: "available",
        role: "material-write",
        bootstrapInputSchema: {
          type: "object",
          properties: { basic: { type: "string" } },
          additionalProperties: false,
        },
      },
      validateInputIssues: (input) =>
        typeof input === "object" && input !== null && !Array.isArray(input)
          ? []
          : [{ path: "/", message: "Expected an object" }],
    },
    {
      ...tool,
      name: "opendesign_capabilities_probe",
      inputSchema: emptySchema,
      modelDisclosure: {
        bootstrap: "deferred",
        afterInspection: "available",
        continuation: "available",
        role: "capability-discovery",
      },
    },
    {
      ...tool,
      name: "opendesign_advanced_probe",
      inputSchema: emptySchema,
      modelDisclosure: { bootstrap: "deferred" },
    },
  ];
}

export function toolResponse(
  toolCallId: string,
  name: string,
  input: Record<string, unknown>,
) {
  return {
    blocks: [
      {
        id: `${toolCallId}_block`,
        type: "tool_call" as const,
        toolCallId,
        name,
        input,
      },
    ],
    stopReason: "tool_use" as const,
  };
}

export function textResponse(text: string) {
  return {
    blocks: [{ id: "completion_text", type: "text" as const, text }],
    stopReason: "complete" as const,
  };
}

export async function collect(
  runtime: OpenDesignPiRuntime,
  runRequest: AgentRunRequest,
): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of runtime.run(runRequest)) events.push(event);
  return events;
}
