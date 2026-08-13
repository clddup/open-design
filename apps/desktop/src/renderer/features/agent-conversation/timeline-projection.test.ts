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
  it("keeps stale-node and Plan amendment recovery out of the user timeline", () => {
    const events: AgentEvent[] = [
      {
        type: "tool.requested",
        runId: "run_recovery",
        toolCallId: "stale_write",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
      },
      {
        type: "tool.failed",
        runId: "run_recovery",
        toolCallId: "stale_write",
        code: "design_target_stale",
        message:
          "Design command refine-home-button targets content outside every declared delivery artboard",
        retryable: false,
        recoverable: true,
      },
      {
        type: "tool.requested",
        runId: "run_recovery",
        toolCallId: "amend_plan",
        toolName: "opendesign_define_design_plan",
        input: {},
        risk: "design_write",
      },
      {
        type: "tool.failed",
        runId: "run_recovery",
        toolCallId: "amend_plan",
        code: "design_plan_amendment_invalid",
        message:
          "design_workflow.plan_amendment_invalid: Material target home cannot be removed from an amended plan",
        retryable: false,
        recoverable: true,
      },
    ];

    expect(
      projectAgentTimeline({
        activeRunId: "run_recovery",
        events,
        locale: "zh-CN",
        stoppingRunId: null,
        timeline: [],
        t: (key, parameters) => translate("zh-CN", key, parameters),
      }).filter((item) => item.kind === "tool"),
    ).toEqual([]);
  });

  it("shows each committed semantic design revision once across durable and live state", () => {
    const now = "2026-08-13T01:00:00.000Z";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:apply_steps",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "apply_steps",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          committedSteps: [
            { stepIds: ["navigation"], label: "构建导航", revision: 1 },
            { stepIds: ["hero"], label: "完成 Hero", revision: 2 },
          ],
        },
      },
    ];
    const projected = projectAgentTimeline({
      activeRunId: "run_1",
      events: [
        {
          type: "tool.progress",
          runId: "run_1",
          toolCallId: "apply_steps",
          message: "设计步骤：完成 Hero · r2",
          progress: 0.8,
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(
      projected.filter((item) => item.id === "design-step:apply_steps:1"),
    ).toHaveLength(1);
    expect(
      projected.filter((item) => item.id === "design-step:apply_steps:2"),
    ).toHaveLength(1);
    expect(
      projected.find((item) => item.id === "design-step:apply_steps:2"),
    ).toMatchObject({ title: "完成 Hero", time: "r2", state: "done" });
  });

  it("keeps a legacy run-start item after its user message", () => {
    const now = "2026-08-13T01:00:00.000Z";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "run:run_legacy",
        sessionId: "conversation_1",
        runId: "run_legacy",
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "started",
        startedAt: now,
      },
      {
        itemId: "message:user",
        sessionId: "conversation_1",
        runId: "run_legacy",
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "user.message",
        messageId: "user",
        content: "Create a landing page",
        documentId: "document_1",
        revision: 4,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: "run_legacy",
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.map((item) => item.kind)).toEqual(["user", "run"]);
  });

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
