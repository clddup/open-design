import type {
  AgentCompletionContext,
  AgentCompletionDecision,
  AgentToolCallRecord,
  CompletionGuardPort,
} from "@opendesign/agent-runtime";
import {
  type DesignDeliveryLedger,
  type DesignDeliveryTarget,
} from "@opendesign/workspace-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import {
  hasSupersededDelivery,
  initialDeliveryStage,
  latestDeliveryLedger,
  latestDeliveryStage,
  latestReviewedDeliveryScope,
} from "./design-completion-evidence.js";

export function reviewDesignCompletion(
  context: AgentCompletionContext,
): AgentCompletionDecision {
  if (hasSupersededDelivery(context.toolCalls)) return { allow: true };
  const reviewedScope = latestReviewedDeliveryScope(context.toolCalls);
  const deliveryStage =
    latestDeliveryStage(context.toolCalls) ??
    initialDeliveryStage(context.request.initialDesignInspection?.content);
  if (
    context.request.deliveryScopeReview === "required" &&
    reviewedScope === undefined &&
    deliveryStage === undefined
  ) {
    return {
      allow: false,
      message:
        "This broad brief requires a complete Delivery Plan before execution. Call opendesign_review_delivery_scope with every independently verifiable deliverable from the full brief and attachments; the host records it automatically. Do not finish, create representative-only targets, or write the canvas before the scope is defined.",
    };
  }
  const unresolvedFailure = context.unresolvedDesignWriteFailure;
  if (unresolvedFailure) {
    if (unresolvedFailure.code === "invalid_tool_input") {
      return {
        allow: false,
        message: `The latest design write has invalid structured input and no design revision was committed (${unresolvedFailure.message}). Submit a corrected tool call using the reported field path. Do not finish with a text-only explanation or ask the user to restart the request.`,
      };
    }
    const recovery = unresolvedFailure.inspectionCompleted
      ? "The document was inspected, but no corrected revision-advancing design write has succeeded yet. Submit a materially revised transaction based on the live structure, then capture and verify the affected target."
      : "Inspect the live document, then submit a materially revised transaction before attempting completion.";
    return {
      allow: false,
      message: `The latest design write is still unresolved (${unresolvedFailure.code}: ${unresolvedFailure.message}). ${recovery}`,
    };
  }
  const delivery = latestDeliveryLedger(
    context.toolCalls,
    context.request.continuation !== undefined,
  );
  if (
    context.request.deliveryScopeReview === "direct" &&
    context.request.continuation === undefined
  ) {
    return reviewDirectEditCompletion(context.toolCalls);
  }
  if (
    reviewedScope &&
    deliveryStage?.plannedTargets === 0 &&
    !context.toolCalls.some(isExecutablePlanCall)
  ) {
    const nextTarget = deliveryStage.nextTarget ?? reviewedScope.targets[0];
    return {
      allow: false,
      message: `The Delivery Scope is reserved but no executable target exists yet. Call opendesign_generate_first_slice for ${nextTarget?.targetId ?? "the first target"} using its host-owned artboard reservation; that call registers the bounded Plan and creates the Frame with meaningful editable content atomically. A reservation is not completed design.`,
    };
  }
  if (delivery) {
    if (
      reviewedScope &&
      !deliveryIsOrderedScopePrefix(delivery, reviewedScope)
    ) {
      return {
        allow: false,
        message:
          "The host delivery ledger is not an ordered prefix of the recorded Delivery Plan. Preserve completed target IDs and plan only the next target instead of skipping, replacing, or reordering scope.",
      };
    }
    if (
      context.toolCalls.some(isExecutablePlanCall) &&
      !delivery.planExecution
    ) {
      return {
        allow: false,
        message:
          "The host accepted an executable Plan but did not return its Main-owned execution ledger. This is an internal workflow-state failure; preserve committed revisions and end only this Run instead of asking the model to recreate hidden host state.",
        terminal: true,
      };
    }
    const incompletePlanStep = delivery.planExecution?.targets
      .flatMap((target) =>
        target.steps.map((step) => ({ ...step, targetId: target.targetId })),
      )
      .find((step) => step.status !== "completed");
    if (incompletePlanStep) {
      return {
        allow: false,
        message: `The executable Plan is not complete. Continue the current serial step ${incompletePlanStep.stepId} (${incompletePlanStep.label}) for target ${incompletePlanStep.targetId}; do not skip pending steps or finish the Run before Main records their execution evidence.`,
      };
    }
    const incomplete = delivery.targets.find(
      (target) => target.status !== "verified",
    );
    if (incomplete) return incompleteDeliveryDecision(delivery, incomplete);
    if (
      reviewedScope &&
      delivery.targets.length < reviewedScope.targets.length
    ) {
      const nextTarget = reviewedScope.targets[delivery.targets.length];
      return {
        allow: false,
        message: `The current executable Plan is verified, but the recorded delivery scope still has ${reviewedScope.targets.length - delivery.targets.length} unplanned target(s). Call opendesign_generate_first_slice for target ${nextTarget?.targetId ?? "at the next scope position"}; it registers that bounded stage and creates its first real editable slice atomically. Do not repeat completed targets or claim total completion yet.`,
      };
    }
    if (
      !reviewedScope &&
      deliveryStage &&
      deliveryStage.plannedTargets < deliveryStage.totalTargets
    ) {
      return {
        allow: false,
        message: `The current executable Plan is verified, but the trusted delivery scope still has ${deliveryStage.totalTargets - deliveryStage.plannedTargets} unplanned target(s). Call opendesign_generate_first_slice${deliveryStage.nextTarget ? ` for target ${deliveryStage.nextTarget.targetId}` : " with deliveryStage.nextTarget"}; it registers the next bounded stage and creates its first real editable slice atomically without repeating completed targets.`,
      };
    }
    return { allow: true };
  }
  const generationIndex = context.toolCalls.findIndex(
    (call) => call.toolName === GENERATE_IMAGE_TOOL_NAME,
  );
  const materialWriteIndex = findMaterialWriteIndex(context.toolCalls);
  if (materialWriteIndex < 0) {
    if (generationIndex < 0 && !context.toolCalls.some(isPlanBearingCall)) {
      return { allow: true };
    }
    if (generationIndex < 0) {
      return {
        allow: false,
        message:
          "A structured plan is not a completed design. No material design transaction reached the document. Inspect the live canvas, create or update the planned artboard with valid typed commands, and verify that the document revision advances before finishing.",
      };
    }
    return {
      allow: false,
      message:
        "Image generation alone did not change the design. Continue with the declared editable composition and apply it to the planned artboard before finishing.",
    };
  }

  const planIndex = context.toolCalls.findIndex(
    (call, index) => index <= materialWriteIndex && isPlanBearingCall(call),
  );
  if (planIndex < 0) {
    return { allow: true };
  }

  const inspectionIndex = context.toolCalls.findIndex(
    (call, index) =>
      index < planIndex && call.toolName === DESIGN_INSPECT_TOOL_NAME,
  );
  const usedTrustedInitialInspection =
    context.toolCalls[planIndex]?.toolName === DESIGN_FIRST_SLICE_TOOL_NAME &&
    context.request.initialDesignInspection !== undefined;
  if (inspectionIndex < 0 && !usedTrustedInitialInspection) {
    return {
      allow: false,
      message:
        "The structured design plan was not preceded by a successful document inspection. Call opendesign_inspect_document, correct the plan from the live structure and diagnostics, then continue.",
    };
  }

  const firstCaptureIndex = context.toolCalls.findIndex(
    (call, index) =>
      index > materialWriteIndex && call.toolName === DESIGN_CAPTURE_TOOL_NAME,
  );
  if (firstCaptureIndex < 0) {
    return {
      allow: false,
      message:
        "The host recorded a substantial design write but no successful rendered canvas review after it. Call opendesign_capture_canvas and inspect the actual image before finishing.",
    };
  }

  return {
    allow: false,
    message:
      "The rendered capture did not return the Main-owned delivery ledger and visual verdict required for completion. This is an internal workflow-state failure; preserve the capture and committed revision and end only this Run instead of retrying unavailable legacy review or Plan tools.",
    terminal: true,
  };
}

function reviewDirectEditCompletion(
  toolCalls: readonly AgentToolCallRecord[],
): AgentCompletionDecision {
  const materialWriteIndex = findMaterialWriteIndex(toolCalls);
  if (materialWriteIndex >= 0) return { allow: true };
  const generatedImage = toolCalls.some(
    (call) => call.toolName === GENERATE_IMAGE_TOOL_NAME,
  );
  if (generatedImage) {
    return {
      allow: false,
      message:
        "Image generation alone did not change the design. Place the generated asset or apply the intended editable composition before finishing.",
    };
  }
  if (toolCalls.some(isPlanBearingCall)) {
    return {
      allow: false,
      message:
        "A structured plan is not a completed edit. Apply the requested material change to the current document before finishing.",
    };
  }
  return { allow: true };
}

function deliveryIsOrderedScopePrefix(
  delivery: DesignDeliveryLedger,
  scope: DesignDeliveryScope,
): boolean {
  return (
    delivery.targets.length <= scope.targets.length &&
    delivery.targets.every(
      (target, index) => scope.targets[index]?.targetId === target.targetId,
    )
  );
}

function incompleteDeliveryDecision(
  ledger: DesignDeliveryLedger,
  target: DesignDeliveryTarget,
): AgentCompletionDecision {
  const completed = ledger.targets.filter(
    (candidate) => candidate.status === "verified",
  ).length;
  const progress = `${completed}/${ledger.targets.length}`;
  const action =
    target.status === "pending"
      ? `Build the required ${target.label} target inside root Frame ${target.rootNodeId}.`
      : target.status === "allocated"
        ? `Add real editable design content inside the allocated root Frame ${target.rootNodeId} for ${target.label}; the empty Frame is not a draft.`
        : target.status === "drafted"
          ? `Capture ${target.label} from its bound Frame and inspect the rendered result.`
          : target.status === "captured"
            ? `Capture ${target.label} again so Main can complete its independent visual review.`
            : target.status === "reviewed"
              ? `Apply a concrete refinement to ${target.label} based on that review.`
              : `Capture ${target.label} again to verify the refined revision.`;
  return {
    allow: false,
    message: `The current executable Plan is ${progress} verified. ${action} Finish this stage before defining the next target Plan. Do not stop or ask the user to send “continue”.`,
  };
}

export const DESIGN_VISUAL_COMPLETION_GUARD: CompletionGuardPort = {
  review: reviewDesignCompletion,
};

function findMaterialWriteIndex(
  toolCalls: readonly AgentToolCallRecord[],
): number {
  return toolCalls.findIndex((call) => call.revisionAdvanced === true);
}

function isPlanBearingCall(call: AgentToolCallRecord): boolean {
  return (
    call.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME ||
    call.toolName === DESIGN_PLAN_TOOL_NAME ||
    call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME
  );
}

function isExecutablePlanCall(call: AgentToolCallRecord): boolean {
  return (
    call.toolName === DESIGN_PLAN_TOOL_NAME ||
    call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME
  );
}
