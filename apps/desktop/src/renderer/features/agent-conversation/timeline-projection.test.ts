import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { MAX_REASONING_SUMMARY_CHARACTERS } from "@opendesign/agent-contracts";
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
  it("keeps the current executable Plan visible and updates its real delivery status", () => {
    const now = "2026-08-26T04:00:00.000Z";
    const runId = "run_visible_plan";
    const delivery = {
      version: 4 as const,
      targets: [
        {
          targetId: "target_home",
          label: "首页",
          pageId: "page_1",
          rootNodeId: "frame_home",
          reservedNodeIds: ["frame_home", "frame_home_hero"],
          status: "drafted" as const,
          allocatedRevision: 1,
          draftRevision: 2,
        },
      ],
      activeTargetId: "target_home",
      planExecution: {
        planRevision: 1,
        targets: [
          {
            targetId: "target_home",
            steps: [
              {
                stepId: "navigation_hero",
                label: "构建导航与首屏层级",
                kind: "implementation" as const,
                status: "completed" as const,
                startedRevision: 1,
                completedRevision: 2,
              },
              {
                stepId: "core_content",
                label: "完成核心内容与底部状态",
                kind: "implementation" as const,
                status: "in_progress" as const,
                startedRevision: 2,
              },
              {
                stepId: "target_home.review-refine",
                label: "Review and refine the rendered target",
                kind: "review-refine" as const,
                status: "pending" as const,
              },
            ],
          },
        ],
      },
    };
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:plan_visible",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "plan_visible",
        toolName: "opendesign_generate_first_slice",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          planRevision: 1,
          plan: {
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                objective: "建立核心信息层级与首要行动",
                implementationSteps: [
                  {
                    stepId: "navigation_hero",
                    label: "构建导航与首屏层级",
                  },
                  {
                    stepId: "core_content",
                    label: "完成核心内容与底部状态",
                  },
                ],
              },
            ],
          },
          delivery,
          deliveryStage: {
            totalTargets: 12,
            plannedTargets: 1,
            verifiedTargets: 0,
            currentPlan: {
              stage: 1,
              status: "active",
              targets: [
                {
                  targetId: "target_home",
                  label: "首页",
                  objective: "建立核心信息层级与首要行动",
                  requiredContent: ["首页核心内容"],
                },
              ],
            },
          },
        },
        revision: 2,
        transactionId: "transaction_first_slice",
      },
      {
        itemId: "tool:capture_visible",
        sessionId: "conversation_1",
        runId,
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "capture_visible",
        toolName: "opendesign_capture_canvas",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          committedSteps: [
            {
              stepIds: ["real_navigation"],
              label: "完成真实导航结构",
              revision: 3,
            },
          ],
          delivery: {
            ...delivery,
            targets: [
              {
                ...delivery.targets[0],
                status: "verified",
                captureRevision: 3,
                reviewRevision: 3,
                refinementRevision: 3,
                verifiedRevision: 3,
              },
            ],
            activeTargetId: null,
            planExecution: {
              planRevision: 1,
              targets: [
                {
                  targetId: "target_home",
                  steps: delivery.planExecution.targets[0].steps.map(
                    (step) => ({
                      ...step,
                      status: "completed" as const,
                      startedRevision:
                        step.startedRevision ??
                        (step.kind === "review-refine" ? 3 : 2),
                      completedRevision: step.completedRevision ?? 3,
                    }),
                  ),
                },
              ],
            },
          },
        },
        revision: 3,
        transactionId: "transaction_capture",
      },
    ];

    const items = projectAgentTimeline({
      activeRunId: runId,
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    const visiblePlan = items.find((item) => item.id === "plan:plan_visible");
    expect(visiblePlan).toMatchObject({
      kind: "plan",
      title: "当前计划 · 阶段 1/12",
    });
    expect(visiblePlan?.plan?.status).toBe("verified");
    expect(visiblePlan?.plan?.targets[0]).toMatchObject({
      label: "首页",
      status: "verified",
      implementationSteps: [
        { label: "构建导航与首屏层级", status: "completed" },
        { label: "完成核心内容与底部状态", status: "completed" },
        { label: "审查实际渲染并按需优化", status: "completed" },
      ],
    });
  });

  it("projects Plan state only from the latest Main delivery ledger", () => {
    const now = "2026-08-26T04:00:00.000Z";
    const runId = "run_step_state";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:plan_step_state",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "plan_step_state",
        toolName: "opendesign_generate_first_slice",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          plan: {
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                objective: "建立首页",
                implementationSteps: [
                  { stepId: "navigation", label: "构建导航" },
                  { stepId: "content", label: "完成内容" },
                ],
              },
            ],
          },
          delivery: {
            version: 4,
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "allocated",
                allocatedRevision: 1,
              },
            ],
            activeTargetId: "target_home",
            planExecution: {
              planRevision: 1,
              targets: [
                {
                  targetId: "target_home",
                  steps: [
                    {
                      stepId: "navigation",
                      label: "构建导航",
                      kind: "implementation",
                      status: "in_progress",
                      startedRevision: 1,
                    },
                    {
                      stepId: "content",
                      label: "完成内容",
                      kind: "implementation",
                      status: "pending",
                    },
                    {
                      stepId: "target_home.review-refine",
                      label: "Review and refine the rendered target",
                      kind: "review-refine",
                      status: "pending",
                    },
                  ],
                },
              ],
            },
          },
        },
        revision: 1,
        transactionId: "transaction_plan",
      },
    ];
    const input = {
      label: "构建首页",
      edits: [
        {
          kind: "node" as const,
          input: {
            label: "构建导航",
            steps: [
              {
                stepId: "navigation",
                label: "构建导航",
                commandIds: ["update_navigation"],
              },
            ],
            commands: [
              {
                commandId: "update_navigation",
                type: "update_properties" as const,
                nodeId: "navigation",
                opacity: 0.96,
              },
            ],
          },
        },
      ],
    };
    const project = (events: AgentEvent[]) =>
      projectAgentTimeline({
        activeRunId: runId,
        events,
        locale: "zh-CN",
        stoppingRunId: null,
        timeline,
        t: (key, parameters) => translate("zh-CN", key, parameters),
      }).find((item) => item.kind === "plan")?.plan?.targets[0]
        ?.implementationSteps;
    const requested: AgentEvent = {
      type: "tool.requested",
      runId,
      toolCallId: "edit_navigation",
      toolName: "opendesign_edit_design",
      input,
      risk: "design_write",
    };

    expect(project([])).toMatchObject([
      { label: "构建导航", status: "active" },
      { label: "完成内容", status: "pending" },
      { label: "审查实际渲染并按需优化", status: "pending" },
    ]);
    expect(project([requested])).toMatchObject([
      { label: "构建导航", status: "active" },
      { label: "完成内容", status: "pending" },
      { label: "审查实际渲染并按需优化", status: "pending" },
    ]);
    expect(
      project([
        requested,
        {
          type: "tool.failed",
          runId,
          toolCallId: "edit_navigation",
          code: "design.node.invalid",
          message: "Navigation is invalid",
        },
      ]),
    ).toMatchObject([
      { label: "构建导航", status: "active" },
      { label: "完成内容", status: "pending" },
      { label: "审查实际渲染并按需优化", status: "pending" },
    ]);
    expect(
      project([
        requested,
        {
          type: "tool.progress",
          runId,
          toolCallId: "edit_navigation",
          message: "设计步骤：构建导航 · r2",
          progress: 0.8,
        },
      ]),
    ).toMatchObject([
      { label: "构建导航", status: "active" },
      { label: "完成内容", status: "pending" },
      { label: "审查实际渲染并按需优化", status: "pending" },
    ]);

    const laterInput = structuredClone(input);
    laterInput.edits[0].input.steps[0] = {
      stepId: "content",
      label: "完成内容",
      commandIds: ["update_navigation"],
    };
    expect(
      project([
        {
          ...requested,
          toolCallId: "edit_content_out_of_order",
          input: laterInput,
        },
      ]),
    ).toMatchObject([
      { label: "构建导航", status: "active" },
      { label: "完成内容", status: "pending" },
      { label: "审查实际渲染并按需优化", status: "pending" },
    ]);
  });

  it("does not project a newer Plan revision onto an older Plan card", () => {
    const now = "2026-08-26T04:00:00.000Z";
    const runId = "run_plan_amendment";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "tool:old_plan",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "old_plan",
        toolName: "opendesign_define_design_plan",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          planRevision: 1,
          plan: {
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                objective: "建立首页",
                implementationSteps: [
                  { stepId: "old_content", label: "旧步骤" },
                ],
              },
            ],
          },
          delivery: {
            version: 4,
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "allocated",
                allocatedRevision: 1,
              },
            ],
            activeTargetId: "target_home",
            planExecution: {
              planRevision: 1,
              targets: [
                {
                  targetId: "target_home",
                  steps: [
                    {
                      stepId: "old_content",
                      label: "旧步骤",
                      kind: "implementation",
                      status: "in_progress",
                      startedRevision: 1,
                    },
                    {
                      stepId: "target_home.review-refine",
                      label: "Review and refine",
                      kind: "review-refine",
                      status: "pending",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
      {
        itemId: "tool:new_plan",
        sessionId: "conversation_1",
        runId,
        sequence: 2,
        createdAt: now,
        updatedAt: now,
        type: "tool",
        toolCallId: "new_plan",
        toolName: "opendesign_define_design_plan",
        input: {},
        risk: "design_write",
        status: "completed",
        result: {
          planRevision: 2,
          plan: {
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                objective: "建立首页",
                implementationSteps: [
                  { stepId: "new_content", label: "新步骤" },
                ],
              },
            ],
          },
          delivery: {
            version: 4,
            targets: [
              {
                targetId: "target_home",
                label: "首页",
                pageId: "page_1",
                rootNodeId: "frame_home",
                reservedNodeIds: ["frame_home"],
                status: "allocated",
                allocatedRevision: 1,
              },
            ],
            activeTargetId: "target_home",
            planExecution: {
              planRevision: 2,
              targets: [
                {
                  targetId: "target_home",
                  steps: [
                    {
                      stepId: "new_content",
                      label: "新步骤",
                      kind: "implementation",
                      status: "in_progress",
                      startedRevision: 1,
                    },
                    {
                      stepId: "target_home.review-refine",
                      label: "Review and refine",
                      kind: "review-refine",
                      status: "pending",
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    ];

    const plans = projectAgentTimeline({
      activeRunId: runId,
      events: [],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline,
      t: (key, parameters) => translate("zh-CN", key, parameters),
    }).filter((item) => item.kind === "plan");

    expect(plans[0]?.plan?.planRevision).toBe(1);
    expect(plans[0]?.plan?.targets[0]?.implementationSteps[0]).toMatchObject({
      stepId: "old_content",
      status: "active",
    });
    expect(plans[1]?.plan?.planRevision).toBe(2);
    expect(plans[1]?.plan?.targets[0]?.implementationSteps[0]).toMatchObject({
      stepId: "new_content",
      status: "active",
    });
  });

  it("keeps terminal failures at the end without duplicating one root cause", () => {
    const runId = "run_terminal_order";
    const startedAt = "2026-08-25T08:19:24.568Z";
    const timeline: SessionTimelineItem[] = [
      {
        itemId: "message:user_terminal_order",
        sessionId: "conversation_1",
        runId,
        sequence: 1,
        createdAt: startedAt,
        updatedAt: startedAt,
        type: "user.message",
        messageId: "user_terminal_order",
        content: "设计完整小程序",
        documentId: "document_1",
        revision: 427,
        scope: { kind: "page", pageId: "page_7", selectedNodeIds: [] },
      },
      {
        itemId: "message:scope_confirmed",
        sessionId: "conversation_1",
        runId,
        sequence: 3,
        createdAt: "2026-08-25T08:20:20.982Z",
        updatedAt: "2026-08-25T08:20:20.982Z",
        type: "assistant.message",
        messageId: "scope_confirmed",
        blocks: [
          {
            blockId: "scope_confirmed_text",
            type: "text",
            text: "先确认交付范围，再开始设计。",
          },
        ],
      },
      {
        itemId: "tool:invalid_scope",
        sessionId: "conversation_1",
        runId,
        sequence: 5,
        createdAt: "2026-08-25T08:20:21.083Z",
        updatedAt: "2026-08-25T08:20:21.182Z",
        type: "tool",
        toolCallId: "invalid_scope",
        toolName: "opendesign_review_delivery_scope",
        input: {},
        risk: "read",
        status: "failed",
        error: {
          code: "invalid_tool_input",
          message: "Delivery scope exceeded its executable fidelity budget",
          recoverable: true,
          retryable: false,
        },
      },
      {
        itemId: "message:plan_revised",
        sessionId: "conversation_1",
        runId,
        sequence: 6,
        createdAt: "2026-08-25T08:22:00.000Z",
        updatedAt: "2026-08-25T08:22:00.000Z",
        type: "assistant.message",
        messageId: "plan_revised",
        blocks: [
          {
            blockId: "plan_revised_text",
            type: "text",
            text: "已收敛交付范围。",
          },
        ],
      },
      {
        itemId: "tool:terminal_plan",
        sessionId: "conversation_1",
        runId,
        sequence: 17,
        createdAt: "2026-08-25T08:30:47.099Z",
        updatedAt: "2026-08-25T08:30:47.209Z",
        type: "tool",
        toolCallId: "terminal_plan",
        toolName: "opendesign_define_design_plan",
        input: {},
        risk: "design_write",
        status: "failed",
        error: {
          code: "tool_protocol_no_progress",
          message: "Plan produced consecutive invalid tool calls",
          recoverable: false,
          retryable: false,
        },
      },
      {
        itemId: `run:${runId}`,
        sessionId: "conversation_1",
        runId,
        sequence: 18,
        createdAt: startedAt,
        updatedAt: "2026-08-25T08:30:47.376Z",
        type: "run",
        status: "error",
        startedAt,
        finishedAt: "2026-08-25T08:30:47.376Z",
        stopReason: "error",
        failure: {
          code: "tool_protocol_no_progress",
          message: "Plan produced consecutive invalid tool calls",
          retryable: false,
        },
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
      "message:user_terminal_order",
      "message:scope_confirmed",
      `design-recovery:${runId}`,
      "message:plan_revised",
      `run:${runId}`,
    ]);
    expect(items.filter((item) => item.state === "error")).toEqual([
      expect.objectContaining({
        id: `run:${runId}`,
        title: "当前模型无法执行这个设计工具",
      }),
    ]);
    expect(
      items.find((item) => item.id === `design-recovery:${runId}`),
    ).toMatchObject({
      order: 5,
      state: "done",
      title: "设计结构修正记录 · 1 次",
    });
  });

  it("appends a live terminal result instead of rewriting the Run start", () => {
    const runId = "run_live_terminal_order";
    const failure = {
      code: "tool_protocol_no_progress",
      message: "Plan produced consecutive invalid tool calls",
      retryable: false,
    } as const;
    const items = projectAgentTimeline({
      activeRunId: null,
      events: [
        {
          type: "run.started",
          runId,
          startedAt: "2026-08-25T08:19:24.568Z",
        },
        {
          type: "message.completed",
          runId,
          messageId: "assistant_live",
          blocks: [
            {
              blockId: "assistant_live_text",
              type: "text",
              text: "正在准备设计。",
            },
          ],
        },
        {
          type: "tool.failed",
          runId,
          toolCallId: "terminal_live_tool",
          ...failure,
          recoverable: false,
        },
        {
          type: "agent.error",
          runId,
          ...failure,
          failure,
        },
        {
          type: "run.completed",
          runId,
          finishedAt: "2026-08-25T08:30:47.376Z",
          stopReason: "error",
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items.map((item) => item.id)).toEqual([
      "message:assistant_live",
      `run:${runId}`,
    ]);
    expect(items.at(-1)).toMatchObject({
      kind: "run",
      state: "error",
      title: "当前模型无法执行这个设计工具",
    });
  });

  it("keeps the Run active when agent.error arrives before its terminal event", () => {
    const runId = "run_error_before_terminal";
    const items = projectAgentTimeline({
      activeRunId: runId,
      events: [
        {
          type: "run.started",
          runId,
          startedAt: "2026-08-25T08:19:24.568Z",
        },
        {
          type: "agent.error",
          runId,
          code: "provider_timeout",
          message: "Provider timed out before the terminal event",
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toHaveLength(2);
    expect(items.find((item) => item.id === `run:${runId}`)).toMatchObject({
      kind: "run",
      state: "active",
    });
    expect(
      items.find((item) => item.id.startsWith(`run-error:${runId}:`)),
    ).toMatchObject({
      kind: "system",
      state: "error",
      failureCode: "provider_timeout",
    });
  });

  it("finalizes streamed text in place when completion has no replacement blocks", () => {
    const runId = "run_empty_completion";
    const items = projectAgentTimeline({
      activeRunId: null,
      events: [
        {
          type: "message.delta",
          runId,
          messageId: "assistant_partial",
          blockId: "text_1",
          blockType: "text",
          blockIndex: 0,
          delta: "中断前已经展示的内容",
        },
        {
          type: "message.completed",
          runId,
          messageId: "assistant_partial",
          blocks: [],
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        id: "message:assistant_partial",
        state: "done",
        assistantBlocks: [
          expect.objectContaining({
            type: "text",
            content: "中断前已经展示的内容",
            state: "done",
          }),
        ],
      }),
    );
  });

  it("merges split durable reasoning without repeating the live tail", () => {
    const runId = "run_long_reasoning";
    const messageId = "assistant_long_reasoning";
    const summary = "理".repeat(MAX_REASONING_SUMMARY_CHARACTERS + 1);
    const now = "2026-08-14T00:00:00.000Z";
    const items = projectAgentTimeline({
      activeRunId: null,
      events: [
        {
          type: "message.completed",
          runId,
          messageId,
          blocks: [
            {
              blockId: "reasoning_0",
              type: "reasoning_summary",
              status: "completed",
              summary,
            },
          ],
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [
        {
          itemId: `message:${messageId}`,
          sessionId: "conversation_1",
          runId,
          sequence: 1,
          createdAt: now,
          updatedAt: now,
          type: "assistant.message",
          messageId,
          blocks: [
            {
              blockId: "reasoning_0",
              type: "reasoning_summary",
              status: "completed",
              summary: summary.slice(0, MAX_REASONING_SUMMARY_CHARACTERS),
            },
            {
              blockId: "reasoning_0_part_1",
              type: "reasoning_summary",
              status: "completed",
              summary: summary.slice(MAX_REASONING_SUMMARY_CHARACTERS),
            },
          ],
        },
      ],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    const assistant = items.find((item) => item.id === `message:${messageId}`);
    expect(
      assistant?.assistantBlocks?.map((block) => block.content).join(""),
    ).toBe(summary);
  });

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

  it("resolves correction from an internal committed revision without showing it", () => {
    const runId = "run_recovery_resolved";
    const items = projectAgentTimeline({
      activeRunId: runId,
      events: [
        {
          type: "tool.failed",
          runId,
          toolCallId: "stale_write",
          code: "design_target_stale",
          message: "The target needs a fresh inspection",
          retryable: false,
          recoverable: true,
        },
        {
          type: "tool.progress",
          runId,
          toolCallId: "repair_write",
          message: "设计步骤：修复目标 · r3",
          progress: 0.8,
        },
      ],
      locale: "zh-CN",
      stoppingRunId: null,
      timeline: [],
      t: (key, parameters) => translate("zh-CN", key, parameters),
    });

    expect(items).toContainEqual(
      expect.objectContaining({
        id: `design-recovery:${runId}`,
        state: "done",
        title: "设计结构已修正 · 1 次",
      }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({
        id: "design-step:repair_write:3",
        revision: 3,
        time: "完成",
      }),
    );
    expect(items.some((item) => /\br\d+\b/.test(item.time))).toBe(false);
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
      expect.objectContaining({
        assistantBlocks: [
          expect.objectContaining({
            type: "text",
            content: "组件已补齐，正在重新捕获。",
          }),
        ],
      }),
    );
    expect(items.some((item) => item.title === "设计更改失败")).toBe(false);
    expect(items).toContainEqual(
      expect.objectContaining({
        assistantBlocks: [
          expect.objectContaining({
            type: "text",
            content: "任务需要继续修复组件绑定。",
          }),
        ],
      }),
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
        assistantBlocks: [
          expect.objectContaining({
            type: "text",
            content: "我会先落下窗口骨架和导航，再继续完善内容。",
          }),
        ],
      }),
    );
  });

  it("keeps each reasoning summary beside the message that produced it", () => {
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
      "tool:run_reasoning:apply_shell",
      "message:reasoning_only",
    ]);
    expect(items[0]).toMatchObject({
      kind: "assistant",
      assistantBlocks: [
        {
          blockIndex: 0,
          type: "reasoning_summary",
          content: "Planning the first editable structure",
        },
        {
          blockIndex: 1,
          type: "text",
          content: "我会先建立真实画板，再完善首屏。",
        },
      ],
    });
    expect(items[2]).toMatchObject({
      kind: "assistant",
      assistantBlocks: [
        {
          blockIndex: 0,
          type: "reasoning_summary",
          content: "Checking hierarchy and spacing",
        },
      ],
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
    ).toMatchObject({
      title: "完成 Hero",
      time: "完成",
      revision: 2,
      state: "done",
    });
    expect(projected.some((item) => /\br\d+\b/.test(item.time))).toBe(false);
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
