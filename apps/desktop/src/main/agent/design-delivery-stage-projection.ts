import { formatValidationFailure } from "@/shared/contract-validation.js";
import {
  DesignDeliveryStageContract,
  type DesignDeliveryStage,
} from "@opendesign/agent-contracts";
import {
  designPlanTargets,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import type { DesignWorkflowState } from "./design-plan-registration.js";
import type { DeliveryScopeArtboardReservation } from "./delivery-scope-artboard-reservation.js";

export function projectDesignDeliveryStage(
  state: DesignWorkflowState | undefined,
  scope: DesignDeliveryScope | undefined,
  reservations?: ReadonlyMap<string, DeliveryScopeArtboardReservation>,
): DesignDeliveryStage | undefined {
  if (!state && !scope) return undefined;
  const currentTargets = state ? designPlanTargets(state.plan) : [];
  const currentPlanTargets = currentTargets.map((target) => {
    const confirmed = scope?.targets.find(
      (candidate) => candidate.targetId === target.targetId,
    );
    return {
      targetId: target.targetId,
      label: confirmed?.label ?? target.label,
      objective: confirmed?.objective ?? target.objective,
      requiredContent: [...(confirmed?.requiredContent ?? [])],
    };
  });
  const firstCurrentTargetId = currentTargets[0]?.targetId;
  const firstCurrentIndex = firstCurrentTargetId
    ? (scope?.targets.findIndex(
        (target) => target.targetId === firstCurrentTargetId,
      ) ?? -1)
    : -1;
  const currentPlanVerified =
    currentTargets.length > 0 &&
    currentTargets.every(
      (target) =>
        state?.targetsById.get(target.targetId)?.delivery.status === "verified",
    );
  const next =
    !state || currentPlanVerified
      ? scope?.targets.find(
          (target) => !state?.targetsById.has(target.targetId),
        )
      : undefined;
  const nextIndex = next
    ? (scope?.targets.findIndex(
        (target) => target.targetId === next.targetId,
      ) ?? -1)
    : -1;
  const nextArtboard = next ? reservations?.get(next.targetId) : undefined;
  const nextTarget =
    next && nextArtboard
      ? {
          stage: nextIndex >= 0 ? nextIndex + 1 : 1,
          targetId: next.targetId,
          label: next.label,
          objective: next.objective,
          requiredContent: [...next.requiredContent],
          artboard: {
            pageId: nextArtboard.pageId,
            frameId: nextArtboard.frameId,
            x: nextArtboard.x,
            y: nextArtboard.y,
            width: nextArtboard.width,
            height: nextArtboard.height,
          },
        }
      : undefined;
  return parseProjection({
    totalTargets: scope?.targets.length ?? state?.targetOrder.length ?? 0,
    plannedTargets: state?.targetOrder.length ?? 0,
    verifiedTargets:
      state?.targetOrder.filter(
        (targetId) =>
          state.targetsById.get(targetId)?.delivery.status === "verified",
      ).length ?? 0,
    ...(currentPlanTargets.length === 0
      ? {}
      : {
          currentPlan: {
            stage: firstCurrentIndex >= 0 ? firstCurrentIndex + 1 : 1,
            status: currentPlanVerified
              ? ("verified" as const)
              : ("active" as const),
            targets: currentPlanTargets,
          },
        }),
    ...(nextTarget ? { nextTarget } : {}),
  });
}

function parseProjection(value: DesignDeliveryStage): DesignDeliveryStage {
  const parsed = DesignDeliveryStageContract.parse(value);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("Design Delivery Stage", parsed.issues),
    );
  }
  return parsed.value;
}
