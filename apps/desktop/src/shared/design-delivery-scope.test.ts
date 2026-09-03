import { describe, expect, it } from "vitest";
import { DeliveryScopeContract } from "./design-delivery-scope";

const scope = () => ({
  version: 1 as const,
  deliverable: "ui" as const,
  objective: "Design the complete product experience",
  targets: [
    {
      targetId: "login",
      label: "登录与注册",
      objective: "完成账户进入与注册流程",
      artboard: { width: 390, height: 844 },
      requiredContent: ["登录", "注册"],
    },
    {
      targetId: "home",
      label: "首页",
      objective: "呈现核心入口与当前状态",
      artboard: { width: 390, height: 844 },
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

  it("rejects Page organization as a delivery-scope concern", () => {
    const parsed = DeliveryScopeContract.parse({
      ...scope(),
      pageStrategy: "separate-pages",
    });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("Expected Page strategy rejection");
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: "delivery_scope.schema_invalid",
        path: "/pageStrategy",
      }),
    );
  });

  it("treats 24 delivery targets as artboards instead of Page requests", () => {
    const broadScope = scope();
    broadScope.targets = Array.from({ length: 24 }, (_, index) => ({
      targetId: `screen-${index + 1}`,
      label: `界面 ${index + 1}`,
      objective: `完成产品界面 ${index + 1} 的完整设计`,
      artboard: { width: 390, height: 844 },
      requiredContent: [`界面 ${index + 1} 的核心内容`],
    }));

    const parsed = DeliveryScopeContract.parse(broadScope);
    expect(parsed.ok).toBe(true);
    expect(DeliveryScopeContract.parse(broadScope)).toEqual({
      ok: true,
      value: broadScope,
    });
  });

  it("keeps the complete reviewed scope independent from one Plan budget", () => {
    const broadScope = scope();
    let remainingExtra = 97 - 24;
    broadScope.targets = Array.from({ length: 24 }, (_, index) => {
      const count = 1 + Math.min(7, remainingExtra);
      remainingExtra -= count - 1;
      return {
        targetId: `screen-${index + 1}`,
        label: `界面 ${index + 1}`,
        objective: `完成产品界面 ${index + 1} 的完整设计`,
        artboard: { width: 390, height: 844 },
        requiredContent: Array.from(
          { length: count },
          (_, contentIndex) => `界面 ${index + 1} 的内容 ${contentIndex + 1}`,
        ),
      };
    });

    expect(remainingExtra).toBe(0);
    expect(
      broadScope.targets.reduce(
        (total, target) => total + target.requiredContent.length,
        0,
      ),
    ).toBe(97);
    expect(DeliveryScopeContract.parse(broadScope)).toEqual({
      ok: true,
      value: broadScope,
    });
  });
});
