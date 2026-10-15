import { describe, expect, it } from "vitest";
import type { Model } from "@earendil-works/pi-ai";
import type { CanonicalMessage } from "@opendesign/model-gateway";
import { MockModelGateway } from "@opendesign/model-gateway";
import type { JournalEvent } from "@opendesign/session-store";
import {
  compactInRunMessagesForProvider,
  createContextBudget,
} from "./context-budget.js";
import { restoreModelMessages } from "./model-message-projection.js";
import {
  projectPiMessagesToCanonical,
  projectPiMessageToCanonical,
} from "./pi-model-message-projection.js";
import {
  executionContextMessage,
  isExecutionContextMessage,
} from "./context-message-origin.js";
import { prepareOpenDesignPiContext } from "./pi-context-adapter.js";
import { OpenDesignPiRuntime } from "./pi-runtime.js";
import {
  MemorySessionStore,
  RecordingGateway,
} from "./pi-runtime-test-support.js";

const request = {
  runId: "run_requirements",
  sessionId: "conversation_requirements",
  prompt: "继续完成设计",
  documentId: "document_requirements",
  revision: 7,
  scope: { kind: "document" as const, selectedNodeIds: [] },
  mutationTarget: { kind: "document" as const },
  modelSelection: { providerId: "configured", modelId: "design-model" },
};
const model: Model<"openai-responses"> = {
  id: "design-model",
  name: "Design model",
  api: "openai-responses",
  provider: "configured",
  baseUrl: "https://provider.invalid/v1",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 4096,
};
const brief = `${"完整产品背景说明。".repeat(180)}\n必须有发票入口。禁止增加会员订阅。`;
const attachment = {
  attachmentId: `image_${"a".repeat(64)}`,
  name: "reference.png",
  mimeType: "image/png",
  byteSize: 2048,
};

function event(
  sequence: number,
  type: JournalEvent["type"],
  payload: unknown,
): JournalEvent {
  return {
    eventId: `event_${sequence}`,
    sessionId: request.sessionId,
    runId: "run_prior",
    sequence,
    type,
    createdAt: new Date(sequence).toISOString(),
    payload,
  };
}

function oldEvents(): JournalEvent[] {
  return [
    event(1, "message.user", { messageId: "user_1", content: brief }),
    event(2, "message.assistant", {
      messageId: "assistant_1",
      blocks: [
        {
          blockId: "text_1",
          type: "text",
          text: "冗长执行叙述。".repeat(2000),
        },
      ],
    }),
    event(3, "run.state", { status: "completed", stopReason: "complete" }),
  ];
}

describe("complete user requirements during context compaction", () => {
  it("compacts old tool image projections but keeps original user image requirements", () => {
    const originalUser: CanonicalMessage = {
      role: "user",
      content: [
        { type: "text", text: brief },
        { type: "image_ref", ...attachment },
      ],
    };
    const generated = projectPiMessageToCanonical(
      {
        role: "toolResult",
        toolCallId: "capture",
        toolName: "capture",
        content: [{ type: "text", text: "Capture complete" }],
        isError: false,
        timestamp: 0,
      },
      1,
      { attachmentsFor: () => [{ ...attachment, mimeType: "image/png" }] },
    );
    const current: CanonicalMessage = { role: "user", content: request.prompt };
    const compacted = compactInRunMessagesForProvider(
      [originalUser, ...generated, current],
      current,
      "",
      [],
      createContextBudget(undefined, "", [], 16_000),
    );
    expect(compacted).toBeDefined();
    expect(compacted).toContain(originalUser);
    expect(compacted).not.toContain(generated[1]);
    expect(JSON.stringify(compacted)).toContain("禁止增加会员订阅");
  });

  it("keeps execution provenance across Pi projection without inferring it from text", async () => {
    const prepared = await prepareOpenDesignPiContext({
      request,
      model,
      sessionStore: new MemorySessionStore(),
      systemPrompt: "",
      toolDefinitions: [],
    });
    const content =
      "[OpenDesign in-run context checkpoint] This is a user's quoted requirement.";
    const actualUser: CanonicalMessage = { role: "user", content };
    const execution = executionContextMessage({ role: "user", content });
    const roundTrip = projectPiMessagesToCanonical(
      prepared.context.projectCanonicalMessages([execution, actualUser]),
      prepared.context,
    );
    const [executionRoundTrip, userRoundTrip] = roundTrip;
    if (!executionRoundTrip || !userRoundTrip)
      throw new Error("Missing projected messages");
    expect(isExecutionContextMessage(executionRoundTrip)).toBe(true);
    expect(isExecutionContextMessage(userRoundTrip)).toBe(false);
    expect(userRoundTrip).toEqual(actualUser);
  });

  it("compacts execution detail without losing the end of a prior brief", async () => {
    const store = new MemorySessionStore();
    store.events.push(...oldEvents());
    const prepared = await prepareOpenDesignPiContext({
      request,
      model,
      sessionStore: store,
      systemPrompt: "Design using the full user brief",
      toolDefinitions: [],
      maxContextCharacters: 4500,
    });
    expect(prepared.compactedThroughSequence).toBe(3);
    expect(prepared.context.consumeFailure()).toBeUndefined();
    const projected = JSON.stringify(prepared.initialMessages);
    expect(projected).toContain("必须有发票入口");
    expect(projected).toContain("禁止增加会员订阅");
    expect(projected).not.toContain("冗长执行叙述。".repeat(2000));
    expect(store.events[0]).toEqual(oldEvents()[0]);
    const restarted = await prepareOpenDesignPiContext({
      request: { ...request, runId: "run_restarted" },
      model,
      sessionStore: store,
      systemPrompt: "Design using the full user brief",
      toolDefinitions: [],
      maxContextCharacters: 4500,
    });
    expect(JSON.stringify(restarted.initialMessages)).toContain(
      "禁止增加会员订阅",
    );
  });

  it("recovers all original requests and attachments from a legacy excerpt checkpoint", () => {
    const events = Array.from({ length: 14 }, (_, index) =>
      event(index + 1, "message.user", {
        messageId: `user_${index + 1}`,
        content: index === 0 ? brief : `需求更正 ${index + 1}`,
        ...(index === 0 ? { attachments: [attachment] } : {}),
      }),
    );
    events.push(
      event(15, "context.compacted", {
        fromSequence: 1,
        toSequence: 14,
        summary: JSON.stringify({
          version: 1,
          userRequests: [{ sequence: 1, text: brief.slice(0, 600) }],
          assistantOutcomes: [],
        }),
      }),
    );
    const messages = restoreModelMessages(events);
    const userMessages = messages.filter((message) => message.role === "user");
    const serialized = JSON.stringify(userMessages);
    expect(serialized).toContain("必须有发票入口");
    expect(serialized).toContain(attachment.attachmentId);
    for (let index = 2; index <= 14; index++) {
      expect(serialized).toContain(`需求更正 ${index}`);
    }
    expect(serialized.indexOf("需求更正 2")).toBeLessThan(
      serialized.indexOf("需求更正 14"),
    );
    expect(serialized).not.toContain("userRequests");
  });

  it("preserves prior user facts and attachment references in an in-run projection", () => {
    const previousUser: CanonicalMessage = {
      role: "user",
      content: [
        { type: "text", text: brief },
        { type: "image_ref", ...attachment },
      ],
    };
    const current: CanonicalMessage = { role: "user", content: request.prompt };
    const messages: CanonicalMessage[] = [
      previousUser,
      {
        role: "assistant",
        blocks: [
          { id: "old_text", type: "text", text: "执行详情。".repeat(3000) },
        ],
      },
      current,
    ];
    const compacted = compactInRunMessagesForProvider(
      messages,
      current,
      "",
      [],
      createContextBudget(undefined, "", [], 16_000),
    );
    expect(compacted).toBeDefined();
    expect(compacted).toContain(previousUser);
    expect(compacted).toContain(current);
    expect(JSON.stringify(compacted)).toContain("禁止增加会员订阅");
    expect(messages[0]).toBe(previousUser);
  });

  it("does not send an incomplete brief when user requirements alone exceed the budget", async () => {
    const store = new MemorySessionStore();
    store.events.push(
      event(1, "message.user", {
        messageId: "large_brief",
        content: brief.repeat(5),
      }),
    );
    const gateway = new RecordingGateway(
      new MockModelGateway("must not be called"),
    );
    const runtime = new OpenDesignPiRuntime({
      modelGateway: gateway,
      sessionStore: store,
      limits: { maxContextCharacters: 2000 },
    });
    const events = [];
    for await (const item of runtime.run(request)) events.push(item);
    expect(gateway.requests).toHaveLength(0);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "agent.error",
        code: "context_budget_exceeded",
      }),
    );
    expect(JSON.stringify(store.events)).toContain("禁止增加会员订阅");
  });
});
