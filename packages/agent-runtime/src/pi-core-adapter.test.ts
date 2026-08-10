import { type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
  createFauxCore,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createOpenDesignPiAgent } from "./pi-core-adapter.js";

const ProbeParameters = Type.Object(
  { value: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

describe("OpenDesign Pi core adapter", () => {
  it("runs a headless sequential tool loop with only explicit design tools", async () => {
    const faux = createFauxCore({
      provider: "opendesign-test-provider",
      models: [
        {
          id: "opendesign-test-model",
          contextWindow: 200_000,
          maxTokens: 16_384,
        },
      ],
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "opendesign_probe",
          { value: "inspect" },
          { id: "probe_call_1" },
        ),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Probe completed", { stopReason: "stop" }),
    ]);
    const executions: Array<{ toolCallId: string; value: string }> = [];
    const tool: AgentTool<typeof ProbeParameters> = {
      name: "opendesign_probe",
      label: "OpenDesign probe",
      description: "Exercise the headless OpenDesign tool boundary.",
      parameters: ProbeParameters,
      execute: (toolCallId, parameters) => {
        executions.push({ toolCallId, value: parameters.value });
        return Promise.resolve({
          content: [{ type: "text", text: "Host proxy completed" }],
          details: { source: "opendesign-host-proxy" },
        });
      },
    };
    let contextTransformCount = 0;
    const agent = createOpenDesignPiAgent({
      initialState: {
        messages: [],
        model: faux.getModel(),
        systemPrompt: "OpenDesign contract probe",
        thinkingLevel: "off",
        tools: [tool],
      },
      sessionId: "conversation_pi_contract",
      streamFn: faux.streamSimple,
      transformContext: (messages) => {
        contextTransformCount += 1;
        return Promise.resolve(messages);
      },
    });
    const events: AgentEvent[] = [];
    const unsubscribe = agent.subscribe((event) => {
      events.push(event);
    });

    try {
      expect(agent.toolExecution).toBe("sequential");
      expect(agent.steeringMode).toBe("one-at-a-time");
      expect(agent.followUpMode).toBe("one-at-a-time");
      expect(agent.state.tools).toEqual([
        expect.objectContaining({
          executionMode: "sequential",
          name: "opendesign_probe",
        }),
      ]);

      await agent.prompt("Inspect through the host proxy");

      expect(faux.state.callCount).toBe(2);
      expect(contextTransformCount).toBe(2);
      expect(executions).toEqual([
        { toolCallId: "probe_call_1", value: "inspect" },
      ]);
      expect(agent.state.messages).toHaveLength(4);
      expect(JSON.stringify(agent.state.messages)).toContain(
        "Host proxy completed",
      );
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "agent_start",
          "tool_execution_start",
          "tool_execution_end",
          "agent_end",
        ]),
      );
    } finally {
      unsubscribe();
      agent.abort();
      await agent.waitForIdle();
    }
  });

  it("rejects non-OpenDesign and duplicate tool registrations", () => {
    const faux = createFauxCore({ provider: "opendesign-boundary-provider" });
    const unsafeTool: AgentTool = {
      name: "bash",
      label: "Bash",
      description: "Forbidden raw shell tool.",
      parameters: Type.Object({}, { additionalProperties: false }),
      execute: () => Promise.resolve({ content: [], details: {} }),
    };
    const baseOptions = {
      initialState: {
        messages: [],
        model: faux.getModel(),
        systemPrompt: "OpenDesign boundary probe",
        thinkingLevel: "off" as const,
      },
      streamFn: faux.streamSimple,
    };

    expect(() =>
      createOpenDesignPiAgent({
        ...baseOptions,
        initialState: { ...baseOptions.initialState, tools: [unsafeTool] },
      }),
    ).toThrow("opendesign_");

    const duplicateTool = { ...unsafeTool, name: "opendesign_duplicate" };
    expect(() =>
      createOpenDesignPiAgent({
        ...baseOptions,
        initialState: {
          ...baseOptions.initialState,
          tools: [duplicateTool, duplicateTool],
        },
      }),
    ).toThrow("Duplicate Pi Agent tool");

    const credentialOptions = {
      ...baseOptions,
      getApiKey: () => "must-not-enter-utility-process",
      initialState: {
        ...baseOptions.initialState,
        tools: [duplicateTool],
      },
    };
    expect(() => createOpenDesignPiAgent(credentialOptions)).toThrow(
      "cannot receive credentials",
    );
  });
});
