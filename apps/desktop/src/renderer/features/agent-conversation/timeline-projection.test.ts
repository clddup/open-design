import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { translate } from "../../../shared/i18n/messages";
import { projectAgentTimeline } from "./timeline-projection";

const continuation = {
  parentRunId: "run_old",
  rootRunId: "run_old",
  attempt: 1 as const,
  maxAttempts: 3 as const,
  reason: "incomplete" as const,
};

describe("Agent continuation timeline projection", () => {
  it("presents an automatic continuation as trusted system work, not user input", () => {
    const now = "2026-08-13T01:00:00.000Z";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_next",
        sessionId: "conversation_1",
        runId: "run_next",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "started",
        startedAt: now,
        continuation,
      },
      {
        itemId: "message:auto",
        sessionId: "conversation_1",
        runId: "run_next",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "user.message",
        messageId: "auto",
        content: "Automatically continue the unfinished design delivery",
        documentId: "document_1",
        revision: 4,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: "run_next",
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "message:auto",
          kind: "system",
          title: "正在重新连接 1/3 · 正在处理设计",
        }),
      ]),
    );
    expect(items.some((item) => item.kind === "user")).toBe(false);
  });

  it("keeps a scheduled continuation visibly active", () => {
    const events: AgentEvent[] = [
      {
        type: "run.continuation",
        runId: "run_old",
        status: "scheduled",
        attempt: 1,
        maxAttempts: 3,
        reason: "budget",
        nextRunId: "run_next",
      },
    ];

    expect(
      projectAgentTimeline({
        activeRunId: "run_next",
        events,
        locale: "zh-CN",
        stoppingRunId: null,
        timeline: [],
        t: (key, parameters) => translate("zh-CN", key, parameters),
      }),
    ).toContainEqual(
      expect.objectContaining({
        id: "continuation:run_next",
        kind: "system",
        state: "active",
      }),
    );
  });
});
