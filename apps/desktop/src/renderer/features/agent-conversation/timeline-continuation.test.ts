import { expect, it } from "vitest";
import type { AgentEvent } from "@opendesign/agent-contracts";
import { translate } from "@/shared/i18n/messages";
import { projectAgentTimeline } from "./timeline-projection";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";

it("presents a no-progress continuation as paused work, not a failed model request", () => {
  const events: AgentEvent[] = [
    {
      type: "run.continuation",
      runId: "run_paused",
      status: "needs_attention",
      attempt: 1,
      maxAttempts: 3,
      reason: "budget",
    },
  ];
  const items = projectAgentTimeline({
    activeRunId: null,
    events,
    locale: "zh-CN",
    stoppingRunId: null,
    timeline: [],
    t: (key, parameters) => translate("zh-CN", key, parameters),
  });
  expect(items).toContainEqual(
    expect.objectContaining({
      title: "自动推进已暂停，已有成果保留",
    }),
  );
  expect(JSON.stringify(items)).not.toContain("请求失败");
});

it("keeps a review limit visible without claiming review passed or capture is running", () => {
  const failure = designWorkflowError(
    "visual_review_no_progress",
    "Repeated evidence",
  ).cause;
  if (!isTrustedToolFailure(failure)) throw new Error("Invalid test failure");
  const events: AgentEvent[] = [
    {
      type: "tool.requested",
      runId: "run_review",
      toolCallId: "capture",
      toolName: "opendesign_capture_canvas",
      input: {},
      risk: "read",
    },
    {
      type: "tool.failed",
      runId: "run_review",
      toolCallId: "capture",
      ...failure,
    },
  ];
  const items = projectAgentTimeline({
    activeRunId: "run_review",
    events,
    locale: "zh-CN",
    stoppingRunId: null,
    timeline: [],
    t: (key, parameters) => translate("zh-CN", key, parameters),
  });
  expect(items).toContainEqual(
    expect.objectContaining({
      state: "error",
      title: "自动视觉审核已暂停",
    }),
  );
  expect(
    items.find((item) => item.title === "自动视觉审核已暂停")?.detail,
  ).toContain("当前结果不代表审核通过");
  expect(JSON.stringify(items)).not.toContain("正在截取");
});
