import {
  type AgentRunRequest,
  type AgentToolDefinition,
} from "@opendesign/agent-runtime";
import { PiRunEventAdapter } from "@opendesign/agent-runtime/pi-migration";
import type {
  JournalEvent,
  SessionProjection,
  SessionStore,
} from "@opendesign/session-store";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";

const request: AgentRunRequest = {
  runId: "run_production_tools",
  sessionId: "conversation_production_tools",
  prompt: "Inspect and improve the active design",
  documentId: "document_production_tools",
  revision: 1,
  scope: { kind: "page", selectedNodeIds: [], pageId: "page_tools" },
  mutationTarget: { kind: "page", pageId: "page_tools" },
  modelSelection: { providerId: "test", modelId: "design" },
};

describe("production Pi design-tool catalog", () => {
  it("adapts the complete public typed catalog without exposing internal host tools", () => {
    const definitions: AgentToolDefinition[] = DESIGN_AGENT_TOOL_SPECS.map(
      (tool) => ({
        ...tool,
        inputSchema: tool.inputSchema as unknown as Record<string, unknown>,
      }),
    );
    const adapter = new PiRunEventAdapter({
      request,
      sessionStore: inertSessionStore(),
      emit: () => undefined,
      toolDefinitions: definitions,
    });

    expect(adapter.tools.map((tool) => tool.name)).toEqual(
      DESIGN_AGENT_TOOL_SPECS.map((tool) => tool.name),
    );
    expect(
      adapter.tools.every((tool) => tool.executionMode === "sequential"),
    ).toBe(true);
    expect(
      adapter.tools.every(
        (tool) => !("~unsafe" in (tool.parameters as Record<string, unknown>)),
      ),
    ).toBe(true);
    expect(adapter.tools.map((tool) => tool.name)).not.toContain(
      INTERNAL_DESIGN_APPLY_TOOL_NAME,
    );
    expect(adapter.tools.map((tool) => tool.name)).not.toContain(
      INTERNAL_UPDATE_IMAGE_TOOL_NAME,
    );
    expect(adapter.tools.map((tool) => tool.name)).not.toContain(
      INTERNAL_IMPORT_SVG_TOOL_NAME,
    );
    expect(adapter.modelTools.map((tool) => tool.name)).toContain(
      DESIGN_EDIT_TOOL_NAME,
    );
    expect(adapter.modelTools.map((tool) => tool.name)).not.toContain(
      DESIGN_APPLY_TOOL_NAME,
    );
    expect(adapter.modelTools.map((tool) => tool.name)).not.toContain(
      DESIGN_HIERARCHY_TOOL_NAME,
    );
    expect(adapter.modelTools.map((tool) => tool.name)).not.toContain(
      DESIGN_ARRANGE_TOOL_NAME,
    );
  });
});

function inertSessionStore(): SessionStore {
  return {
    append: () => Promise.resolve(),
    read: () => Promise.resolve([]),
    readTimeline: () => Promise.resolve([]),
    project: (sessionId): Promise<SessionProjection> =>
      Promise.resolve({
        sessionId,
        lastSequence: 0,
        messageCount: 0,
        toolCallCount: 0,
        compactedRanges: [],
      }),
    appendNext: <T>(
      _sessionId: string,
      createEvent: (sequence: number) => JournalEvent<T>,
    ) => Promise.resolve(createEvent(1)),
  };
}
