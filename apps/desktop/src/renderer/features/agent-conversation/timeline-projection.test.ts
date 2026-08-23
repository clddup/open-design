import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { translate } from "@/shared/i18n/messages";
import { projectAgentTimeline } from "./timeline-projection";

const continuation = {
  parentRunId: "run_old",
  rootRunId: "run_old",
  attempt: 1 as const,
  maxAttempts: 3 as const,
  reason: "incomplete" as const,
};

describe("Agent continuation timeline projection", () => {
  it("shows only the stopped Run outcome for cancellation cleanup failures", () => {
    const runId = "run_user_stopped";
    const items = projectAgentTimeline({
      activeRunId: null,
      events: [
        {
          type: "tool.failed",
          runId,
          toolCallId: "capture_cancelled",
          code: "run_cancelled",
          message: "Design tool request was cancelled",
          retryable: false,
          recoverable: false,
        },
        {
          type: "run.completed",
          runId,
          finishedAt: "2026-08-14T00:00:00.000Z",
          stopReason: "cancelled",
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.some((item) => item.title === "设计更改失败")).toBe(false);
    expect(items).toContainEqual(
      expect.objectContaining({ title: "任务已停止", state: "done" }),
    );
  });

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

  it("collapses repeated recoverable design failures into one active correction", () => {
    const runId = "run_first_slice_recovery";
    const events: AgentEvent[] = [
      {
        type: "tool.failed",
        runId,
        toolCallId: "first_slice_budget",
        code: "invalid_tool_input",
        message: "35 elements exceeded the compact first-screen budget",
        retryable: false,
        recoverable: true,
      },
      {
        type: "tool.failed",
        runId,
        toolCallId: "first_slice_region",
        code: "design.invalid",
        message: "Planned region footer_region must be a Frame",
        retryable: false,
        recoverable: true,
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: runId,
      events,
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.filter((item) => item.state === "error")).toEqual([]);
    expect(items).toContainEqual(
      expect.objectContaining({
        id: `design-recovery:${runId}`,
        state: "active",
        title: "正在修正设计结构 · 2 次",
      }),
    );
  });

  it("keeps assistant text before tools while hiding routine component repair failures", () => {
    const runId = "run_component_repair";
    const events: AgentEvent[] = [
      {
        type: "message.completed",
        runId,
        messageId: "claim",
        blocks: [
          {
            blockId: "claim_text",
            type: "text",
            text: "组件已补齐，正在重新捕获。",
          },
        ],
      },
      {
        type: "tool.requested",
        runId,
        toolCallId: "capture",
        toolName: "opendesign_capture_canvas",
        input: {},
        risk: "read",
      },
      {
        type: "tool.failed",
        runId,
        toolCallId: "capture",
        code: "design_component_strategy_incomplete",
        message:
          "design_workflow.component_strategy_incomplete: Declared Component Main is missing",
        retryable: false,
        recoverable: true,
      },
      {
        type: "message.completed",
        runId,
        messageId: "final",
        blocks: [
          {
            blockId: "final_text",
            type: "text",
            text: "任务需要继续修复组件绑定。",
          },
        ],
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: runId,
      events,
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toContainEqual(
      expect.objectContaining({ detail: "组件已补齐，正在重新捕获。" }),
    );
    expect(items.some((item) => item.title === "设计更改失败")).toBe(false);
    expect(items).toContainEqual(
      expect.objectContaining({ detail: "任务需要继续修复组件绑定。" }),
    );
  });

  it("keeps durable assistant text that precedes a later tool call", () => {
    const now = "2026-08-18T03:36:00.000Z";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:assistant_intro",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "assistant_intro",
        blocks: [
          {
            blockId: "assistant_intro_text",
            type: "text",
            text: "我会先落下窗口骨架和导航，再继续完善内容。",
          },
        ],
      },
      {
        itemId: "tool:apply_shell",
        sessionId: "conversation_1",
        runId: "run_1",
        sequence: 4,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "apply_shell",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "completed",
        result: { ok: true },
        revision: 1,
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: null,
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        kind: "assistant",
        detail: "我会先落下窗口骨架和导航，再继续完善内容。",
      }),
    );
  });

  it("projects one reasoning disclosure per Run without removing assistant text", () => {
    const now = "2026-08-18T03:40:00.000Z";
    const runId = "run_reasoning";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:mixed",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "mixed",
        blocks: [
          {
            blockId: "mixed_reasoning",
            type: "reasoning_summary",
            status: "completed",
            summary: "Planning the first editable structure",
          },
          {
            blockId: "mixed_text",
            type: "text",
            text: "我会先建立真实画板，再完善首屏。",
          },
        ],
      },
      {
        itemId: "tool:apply_shell",
        sessionId: "conversation_1",
        runId,
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "apply_shell",
        toolName: "opendesign_apply_transaction",
        input: {},
        risk: "design_write",
        status: "completed",
        result: { ok: true },
        revision: 1,
      },
      {
        itemId: "message:reasoning_only",
        sessionId: "conversation_1",
        runId,
        sequence: 3,
        createdAt: now,
        updatedAt: now,
        type: "assistant.message",
        messageId: "reasoning_only",
        blocks: [
          {
            blockId: "reasoning_only_block",
            type: "reasoning_summary",
            status: "completed",
            summary: "Checking hierarchy and spacing",
          },
        ],
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: null,
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.map((item) => item.id)).toEqual([
      "message:mixed",
      `reasoning:${runId}`,
      "tool:apply_shell",
    ]);
    expect(items[0]).toMatchObject({
      kind: "assistant",
      detail: "我会先建立真实画板，再完善首屏。",
    });
    expect(items[0]?.reasoning).toBeUndefined();
    expect(items[1]).toMatchObject({
      kind: "reasoning",
      reasoningCount: 2,
      title: "模型思考摘要 · 2 条",
      reasoning:
        "Planning the first editable structure\n\nChecking hierarchy and spacing",
    });
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

  it("removes reconnect projection immediately when its Run is stopping", () => {
    const now = "2026-08-13T01:00:00.000Z";
    const runId = "run_stopping_continuation";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:auto-stopping",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "user.message",
        messageId: "auto-stopping",
        content: "Automatically continue the unfinished design delivery",
        documentId: "document_1",
        revision: 4,
        scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      },
      {
        itemId: `run:${runId}`,
        sessionId: "conversation_1",
        runId,
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "run",
        status: "started",
        startedAt: now,
        continuation: { ...continuation, parentRunId: "run_old" },
      },
    ];
    const items = projectAgentTimeline({
      activeRunId: runId,
      events: [
        {
          type: "model.retrying",
          runId,
          retry: 2,
          maxRetries: 5,
          delayMs: 900,
        },
        {
          type: "run.started",
          runId,
          startedAt: now,
          continuation: { ...continuation, parentRunId: "run_old" },
        },
      ],
      locale: "zh-CN",
      stoppingRunId: runId,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.some((item) => item.title.includes("重新连接"))).toBe(false);
  });
});
