import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DesignToolBridgeRequestContract } from "@opendesign/agent-contracts";
import { OpenDesignPiRuntime } from "@opendesign/agent-runtime/pi-migration";
import { MockModelGateway, type ModelRequest } from "@opendesign/model-gateway";
import { JsonlSessionStore } from "@opendesign/session-store";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
} from "@/shared/design-agent-tools";
import { MainDesignToolRuntime } from "@/main/agent/main-design-tool-runtime";
import { parseDesignToolInput } from "@/main/agent/design-tool-input-parser";
import { handleDesignCapabilityTool } from "@/main/agent/design-capability-tool-handler";
import { ParentDesignToolExecutor } from "./parent-design-tool-executor";
import { OPENDESIGN_AGENT_SYSTEM_PROMPT } from "./system-prompt";

it.each([false, true])(
  "preserves registry and Main selection semantics at the Provider boundary; selection=%s",
  async (selectTools) => {
    const directory = await mkdtemp(
      join(tmpdir(), "opendesign-tool-selection-"),
    );
    try {
      const main = new MainDesignToolRuntime({
        parseInput: (call, context) =>
          parseDesignToolInput(
            { assertDesignToolContext: () => undefined } as never,
            call,
            context,
          ),
        dispatch: (call) => {
          const result = handleDesignCapabilityTool(call);
          if (!result) throw new Error("Unexpected tool in selection test");
          return Promise.resolve(result);
        },
        isPreauthorized: () => true,
        recordAudit: () => undefined,
      });
      const bridgeRequests: unknown[] = [];
      const executor = new ParentDesignToolExecutor({
        postMessage: (message) => {
          bridgeRequests.push(message);
          const parsed = DesignToolBridgeRequestContract.parse(message);
          if (!parsed.ok) throw new Error("Invalid selection bridge request");
          const request = parsed.value;
          void main
            .execute(
              request.call,
              request.context,
              new AbortController().signal,
              () => undefined,
            )
            .then((result) => {
              executor.handleMessage({
                type: "design-tool.response",
                requestId: request.requestId,
                ok: true,
                result,
              });
            })
            .catch((error: unknown) => {
              executor.handleMessage({
                type: "design-tool.response",
                requestId: request.requestId,
                ok: false,
                error: {
                  code: "test_main_failure",
                  message:
                    error instanceof Error ? error.message : "Selection failed",
                  retryable: false,
                  recoverable: false,
                },
              });
            });
        },
      });
      const requests: ModelRequest[] = [];
      const model = new MockModelGateway([
        {
          blocks: [
            {
              id: "select",
              type: "tool_call",
              toolCallId: "select_vector",
              name: DESIGN_CAPABILITIES_TOOL_NAME,
              input: selectTools ? { tools: [DESIGN_VECTOR_TOOL_NAME] } : {},
            },
          ],
          stopReason: "tool_use",
        },
        {
          blocks: [{ id: "ready", type: "text", text: "已准备好矢量工具。" }],
          stopReason: "complete",
        },
      ]);
      const runtime = new OpenDesignPiRuntime({
        sessionStore: new JsonlSessionStore(join(directory, "events.jsonl")),
        systemPrompt: OPENDESIGN_AGENT_SYSTEM_PROMPT,
        toolCatalog: { listTools: () => DESIGN_AGENT_TOOL_SPECS },
        toolExecutor: executor,
        modelGateway: {
          stream: (request) => {
            requests.push(request);
            return model.stream(request);
          },
        },
      });
      for await (const event of runtime.run({
        runId: "run_selection",
        sessionId: "selection",
        documentId: "document_selection",
        revision: 0,
        prompt: "准备编辑矢量轮廓",
        modelSelection: {
          providerId: "mock",
          modelId: "mock",
          reasoningEffort: "medium",
        },
        modelContext: { contextWindow: 200_000, maxOutputTokens: 16_384 },
        scope: { kind: "page", pageId: "page", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page" },
        initialDesignInspection: {
          version: 1,
          observedRevision: 0,
          content: { inspection: { pageId: "page", revision: 0 } },
        },
      }))
        expect(event.type).not.toBe("agent.error");
      expect(bridgeRequests).toHaveLength(1);
      expect(requests).toHaveLength(2);
      expect(requests[0].tools.map((tool) => tool.name)).not.toContain(
        DESIGN_VECTOR_TOOL_NAME,
      );
      if (selectTools) {
        const selected = requests[1].tools.find(
          (tool) => tool.name === DESIGN_VECTOR_TOOL_NAME,
        );
        const original = DESIGN_AGENT_TOOL_SPECS.find(
          (tool) => tool.name === DESIGN_VECTOR_TOOL_NAME,
        );
        expect(JSON.stringify(selected?.inputSchema)).toBe(
          JSON.stringify(original?.inputSchema),
        );
      } else {
        expect(requests[1].tools.map((tool) => tool.name)).not.toContain(
          DESIGN_VECTOR_TOOL_NAME,
        );
      }
      expect(requests[1].tools.map((tool) => tool.name)).not.toContain(
        DESIGN_FONT_TOOL_NAME,
      );
      expect(
        requests[1].tools.find((tool) => tool.name === DESIGN_EDIT_TOOL_NAME)
          ?.inputSchema,
      ).toEqual(
        requests[0].tools.find((tool) => tool.name === DESIGN_EDIT_TOOL_NAME)
          ?.inputSchema,
      );
      const toolMessage = requests[1].messages.find(
        (message) => message.role === "tool",
      );
      if (!toolMessage || toolMessage.role !== "tool")
        throw new Error("Missing capability result in Provider context");
      const output = (
        typeof toolMessage.content === "string"
          ? JSON.parse(toolMessage.content)
          : toolMessage.content
      ) as { toolCatalog?: { name: string }[] };
      if (selectTools) {
        expect(output).toHaveProperty("selectedTools", [
          DESIGN_VECTOR_TOOL_NAME,
        ]);
        expect(output).not.toHaveProperty("capabilities");
        expect(output).not.toHaveProperty("toolCatalog");
      } else {
        expect(output.toolCatalog?.map((tool) => tool.name)).toEqual(
          DESIGN_AGENT_TOOL_SPECS.map((tool) => tool.name),
        );
      }
      expect(requests[1].modelSelection.reasoningEffort).toBe("medium");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
