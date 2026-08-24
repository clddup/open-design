import { describe, expect, it } from "vitest";
import {
  DeliveryScopeContract,
  deliveryScopeApprovalPrompt,
} from "./design-delivery-scope";

const scope = () => ({
  version: 1 as const,
  deliverable: "ui" as const,
  objective: "Design the complete product experience",
  pageStrategy: "separate-pages" as const,
  targets: [
    {
      targetId: "login",
      label: "登录与注册",
      objective: "完成账户进入与注册流程",
      requiredContent: ["登录", "注册"],
    },
    {
      targetId: "home",
      label: "首页",
      objective: "呈现核心入口与当前状态",
      requiredContent: ["核心入口", "状态摘要"],
    },
  ],
  exclusions: ["后台管理"],
  assumptions: ["使用移动端画板"],
});

describe("delivery scope contract", () => {
  it("accepts a concise user-reviewable scope", () => {
    expect(DeliveryScopeContract.parse(scope())).toEqual({
      ok: true,
      value: scope(),
    });
  });

  it("rejects duplicate targets with a stable path", () => {
    const duplicate = scope();
    duplicate.targets[1].targetId = "login";
    const parsed = DeliveryScopeContract.parse(duplicate);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected duplicate scope target failure");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: "delivery_scope.target_id_duplicate",
        path: "/targets/1/targetId",
      }),
    );
  });

  it("projects the actual target list into the approval card", () => {
    expect(
      deliveryScopeApprovalPrompt(scope(), {
        prompt: "根据 PRD 设计完整产品",
      }),
    ).toEqual({
      title: "确认交付计划（2 项）",
      summary:
        "1. 登录与注册 — 完成账户进入与注册流程\n2. 首页 — 呈现核心入口与当前状态\n\n本次不包含: 后台管理",
    });
  });
});
