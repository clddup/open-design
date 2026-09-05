import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentRunRequest } from "@opendesign/agent-runtime";
import { OpenDesignPiRuntime } from "@opendesign/agent-runtime/pi-migration";
import { MockModelGateway, type ModelRequest } from "@opendesign/model-gateway";
import { JsonlSessionStore } from "@opendesign/session-store";
import { agentSystemPromptForRequest } from "./system-prompt";

describe("Conversation design context at the Provider boundary", () => {
  it("sends unchanged history and stable design methods without a preflight model call", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "opendesign-conversation-context-"),
    );
    try {
      const requests: ModelRequest[] = [];
      const delegate = new MockModelGateway("已收到需求");
      const store = new JsonlSessionStore(join(directory, "events.jsonl"));
      const runtime = new OpenDesignPiRuntime({
        sessionStore: store,
        systemPromptForRequest: agentSystemPromptForRequest,
        modelGateway: {
          stream(request) {
            requests.push(request);
            return delegate.stream(request);
          },
        },
      });
      const prompts = [
        "为我的咖啡品牌设计彩色 Logo，字标使用英文，说明使用中文。",
        "继续",
        "另外设计一个登录页面，不沿用之前的品牌色。",
      ];
      for (const [index, prompt] of prompts.entries()) {
        const request: AgentRunRequest = {
          runId: `run_context_${index}`,
          sessionId: "conversation_context",
          documentId: "document_context",
          revision: 0,
          scope: { kind: "document", selectedNodeIds: [] },
          mutationTarget: { kind: "document" },
          modelSelection: {
            providerId: "mock",
            modelId: "mock",
            reasoningEffort: "medium",
          },
          prompt,
        };
        for await (const event of runtime.run(request)) {
          expect(event.type).not.toBe("agent.error");
        }
        expect(requests).toHaveLength(index + 1);
        const sent = requests[index];
        expect(sent.system).toBe(requests[0].system);
        expect(sent.system).toContain('id="logo-visual-direction"');
        expect(sent.system).toContain('id="ui-visual-direction"');
        expect(sent.system).not.toContain("咖啡品牌");
        expect(sent.modelSelection.reasoningEffort).toBe("medium");
        for (const earlier of prompts.slice(0, index + 1)) {
          expect(JSON.stringify(sent.messages)).toContain(earlier);
        }
      }
      const timeline = await store.readTimeline("conversation_context");
      expect(
        timeline
          .filter((item) => item.type === "user.message")
          .map((item) => item.content),
      ).toEqual(prompts);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
