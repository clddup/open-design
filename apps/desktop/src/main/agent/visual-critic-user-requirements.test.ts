import { describe, expect, it } from "vitest";
import type {
  AgentRequest,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { visualCriticUserRequirements } from "./visual-critic-user-requirements";

const request: Extract<AgentRequest, { type: "run.start" }> = {
  type: "run.start",
  runId: "current",
  sessionId: "conversation",
  documentId: "document",
  revision: 0,
  prompt: "继续",
  scope: { kind: "page", pageId: "page", selectedNodeIds: [] },
  mutationTarget: { kind: "page", pageId: "page" },
  modelSelection: { providerId: "provider", modelId: "model" },
};
function user(
  sequence: number,
  content: string,
): Extract<SessionTimelineItem, { type: "user.message" }> {
  return {
    type: "user.message",
    itemId: `item_${sequence}`,
    messageId: `message_${sequence}`,
    runId: `run_${sequence}`,
    sessionId: request.sessionId,
    createdAt: "2026-09-06T00:00:00Z",
    updatedAt: "2026-09-06T00:00:00Z",
    sequence,
    documentId: request.documentId,
    revision: 0,
    scope: request.scope,
    content,
  };
}

describe("independent critic user requirements", () => {
  it("keeps chronological raw user corrections and filters by Conversation and Design File", () => {
    const first = user(1, "完整中文需求\n包含换行：请做黑白标志。");
    const second = user(2, "改成彩色，不要黑白。");
    const timeline = [
      second,
      { ...user(3, "Other file"), documentId: "other" },
      first,
      { ...user(4, "Other session"), sessionId: "other" },
    ];
    expect(
      visualCriticUserRequirements(request, timeline).map(
        (item) => item.content,
      ),
    ).toEqual([first.content, second.content, request.prompt]);
    expect(timeline[0]).toBe(second);
  });
  it("ignores author replies and automatic continuation prompts without text classification", () => {
    const base = user(1, "原始需求");
    const timeline: SessionTimelineItem[] = [
      base,
      {
        ...base,
        type: "assistant.message",
        messageId: "assistant",
        blocks: [
          {
            blockId: "text",
            type: "text",
            text: "作者自评",
          },
        ],
      },
      user(2, "HOST GENERATED CONTINUATION"),
      {
        itemId: "run_auto",
        type: "run",
        runId: "run_2",
        sessionId: request.sessionId,
        sequence: 3,
        createdAt: base.createdAt,
        updatedAt: base.updatedAt,
        startedAt: base.createdAt,
        status: "completed",
        continuation: {
          parentRunId: "run_1",
          rootRunId: "run_1",
          attempt: 1,
          maxAttempts: 3,
          reason: "incomplete",
        },
      },
    ];
    expect(
      visualCriticUserRequirements(request, timeline).map(
        (item) => item.content,
      ),
    ).toEqual(["原始需求", "继续"]);
  });
  it("does not duplicate a journaled current message or promote an automatic prompt", () => {
    const previous = user(1, "设计一个中文首页");
    const current = { ...user(2, request.prompt), runId: request.runId };
    expect(
      visualCriticUserRequirements(request, [previous, current]).map(
        (item) => item.content,
      ),
    ).toEqual([previous.content, request.prompt]);
    expect(
      visualCriticUserRequirements(
        {
          ...request,
          prompt: "HOST PROMPT",
          continuation: {
            parentRunId: "run_1",
            rootRunId: "run_1",
            attempt: 1,
            maxAttempts: 3,
            reason: "incomplete",
          },
        },
        [previous],
      ).map((item) => item.content),
    ).toEqual([previous.content]);
  });

  it("retains document handles without introducing unselected images as visual references", () => {
    const document = {
      attachmentId: `file_${"a".repeat(64)}`,
      name: "产品需求.md",
      mimeType: "text/markdown" as const,
      byteSize: 120,
    };
    const prior = {
      ...user(1, "按照附件"),
      attachments: [
        document,
        {
          attachmentId: `image_${"b".repeat(64)}`,
          name: "反馈.png",
          mimeType: "image/png" as const,
          byteSize: 12,
        },
      ],
    };
    const requirements = visualCriticUserRequirements(
      { ...request, attachments: [document] },
      [prior],
    );
    expect(requirements[0].documents).toEqual([document]);
    expect(requirements[1].documents).toEqual([document]);
    requirements[0].documents[0].name = "changed";
    expect(document.name).toBe("产品需求.md");
  });
});
