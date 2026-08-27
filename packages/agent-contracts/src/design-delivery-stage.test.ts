import { describe, expect, it } from "vitest";
import {
  DesignDeliveryStageContract,
  type DesignDeliveryStage,
} from "./design-delivery-stage.js";

describe("Design Delivery Stage contract", () => {
  it("accepts the unplanned, active, and verified rolling-stage states", () => {
    expect(
      DesignDeliveryStageContract.parse({
        totalTargets: 2,
        plannedTargets: 0,
        verifiedTargets: 0,
        nextTarget: target("target_home", 1),
      }).ok,
    ).toBe(true);
    expect(DesignDeliveryStageContract.parse(activeStage()).ok).toBe(true);
    expect(
      DesignDeliveryStageContract.parse({
        ...activeStage(),
        verifiedTargets: 1,
        currentPlan: {
          ...activeStage().currentPlan!,
          status: "verified",
        },
        nextTarget: target("target_profile", 2),
      }).ok,
    ).toBe(true);
  });

  it("reports count and current-stage range drift at stable paths", () => {
    const input = activeStage();
    input.totalTargets = 1;
    input.plannedTargets = 2;
    input.verifiedTargets = 3;
    expect(DesignDeliveryStageContract.issues(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_delivery_stage.planned_count_invalid",
          path: "/plannedTargets",
        }),
        expect.objectContaining({
          code: "design_delivery_stage.verified_count_invalid",
          path: "/verifiedTargets",
        }),
      ]),
    );
  });

  it("rejects duplicate current targets and an out-of-order next target", () => {
    const input = activeStage();
    const currentPlan = input.currentPlan;
    const firstTarget = currentPlan?.targets[0];
    if (!currentPlan || !firstTarget) throw new Error("Expected current Plan");
    currentPlan.targets.push({ ...firstTarget });
    input.nextTarget = target("target_home", 3);
    expect(DesignDeliveryStageContract.issues(input)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_delivery_stage.current_target_duplicate",
          path: "/currentPlan/targets/1/targetId",
        }),
        expect.objectContaining({
          code: "design_delivery_stage.next_stage_invalid",
          path: "/nextTarget/stage",
        }),
        expect.objectContaining({
          code: "design_delivery_stage.next_target_while_active",
          path: "/nextTarget",
        }),
        expect.objectContaining({
          code: "design_delivery_stage.next_target_duplicate",
          path: "/nextTarget/targetId",
        }),
      ]),
    );
  });

  it("requires a current Plan whenever planned targets exist", () => {
    const input = activeStage();
    delete input.currentPlan;
    expect(DesignDeliveryStageContract.issues(input)).toContainEqual(
      expect.objectContaining({
        code: "design_delivery_stage.current_plan_required",
        path: "/currentPlan",
      }),
    );
  });
});

function activeStage(): DesignDeliveryStage {
  return {
    totalTargets: 2,
    plannedTargets: 1,
    verifiedTargets: 0,
    currentPlan: {
      stage: 1,
      status: "active",
      targets: [targetSummary("target_home")],
    },
  };
}

function targetSummary(targetId: string) {
  return {
    targetId,
    label: targetId === "target_home" ? "Home" : "Profile",
    objective: `Design ${targetId}`,
    requiredContent: [`${targetId} content`],
  };
}

function target(targetId: string, stage: number) {
  return { stage, ...targetSummary(targetId) };
}
