import { AgentRuntime } from "@opendesign/agent-runtime";
import {
  MockModelGateway,
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
  it("reaches the provider with the complete production prompt and eight tools", async () => {
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
      expect(gateway.requests[0]?.tools).toHaveLength(8);
      expect(events).not.toContainEqual(
        expect.objectContaining({ type: "agent.error" }),
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
