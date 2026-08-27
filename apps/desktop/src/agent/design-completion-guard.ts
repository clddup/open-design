import type {
  AgentCompletionContext,
  AgentCompletionDecision,
  AgentToolCallRecord,
  CompletionGuardPort,
} from "@opendesign/agent-runtime";
import {
  isDesignDeliveryLedger,
  type DesignDeliveryLedger,
  type DesignDeliveryTarget,
} from "@opendesign/workspace-contracts";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_SYSTEM_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";

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
        "This broad brief requires a user-confirmed Delivery Plan before execution. Call opendesign_review_delivery_scope with every independently verifiable deliverable from the full brief and attachments. Do not finish, create representative-only targets, or write the canvas before the user confirms the scope.",
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
  const delivery = latestDeliveryLedger(context.toolCalls);
  if (delivery) {
    if (
      reviewedScope &&
      !deliveryIsOrderedScopePrefix(delivery, reviewedScope)
    ) {
      return {
        allow: false,
        message:
          "The host delivery ledger is not an ordered prefix of the user-confirmed Delivery Plan. Preserve completed target IDs and plan only the next confirmed target instead of skipping, replacing, or reordering scope.",
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
        message: `The current executable Plan is verified, but the confirmed delivery scope still has ${reviewedScope.targets.length - delivery.targets.length} unplanned target(s). Define the next Plan for confirmed target ${nextTarget?.targetId ?? "at the next scope position"}, create its first real editable slice, and continue. Do not repeat completed targets or claim total completion yet.`,
      };
    }
    if (
      !reviewedScope &&
      deliveryStage &&
      deliveryStage.plannedTargets < deliveryStage.totalTargets
    ) {
      return {
        allow: false,
        message: `The current executable Plan is verified, but the trusted delivery scope still has ${deliveryStage.totalTargets - deliveryStage.plannedTargets} unplanned target(s). Define the next Plan${deliveryStage.nextTargetId ? ` for confirmed target ${deliveryStage.nextTargetId}` : " from deliveryStage.nextTarget"}, create its first real editable slice, and continue without repeating completed targets.`,
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
    return {
      allow: false,
      message:
        "The host recorded a material design write without a preceding structured design plan. Inspect the current canvas, call opendesign_define_design_plan, and rebuild or correct the work inside its artboard before finishing.",
    };
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

  const planCall = context.toolCalls[planIndex];
  const plan =
    planCall?.toolName === DESIGN_FIRST_SLICE_TOOL_NAME &&
    isRecord(planCall.result)
      ? planCall.result.plan
      : planCall?.input;
  if (
    hasPlacedRaster(context.toolCalls) &&
    isEditableCreatedArtboardPlan(plan) &&
    editableInsertedLayerCount(context.toolCalls, plan) < 2
  ) {
    return {
      allow: false,
      message:
        "The editable composition is still dominated by one placed raster. Add at least two meaningful editable typography, vector, shape, control, or information layers inside the planned artboard instead of treating the image as the finished design.",
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

  const reviewIndex = context.toolCalls.findIndex(
    (call, index) =>
      index > firstCaptureIndex && call.toolName === DESIGN_REVIEW_TOOL_NAME,
  );
  if (reviewIndex < 0) {
    return {
      allow: false,
      message:
        "The first rendered draft needs a structured visual critique. Call opendesign_record_visual_review with a comparison against the latest user brief and active Plan fidelity contract, plus concrete composition, hierarchy, typography, asset-integration, surface, and refinement findings before editing again.",
    };
  }

  const refinementWriteIndex = context.toolCalls.findIndex(
    (call, index) => index > reviewIndex && isSuccessfulDesignWrite(call),
  );
  if (refinementWriteIndex < 0) {
    return {
      allow: false,
      message:
        "The first rendered draft is a review checkpoint, not completion. Based on that image, make at least one concrete refinement transaction addressing silhouette, proportion, spacing, balance, hierarchy, or layer relationships. Do not merely restate that the draft looks correct.",
    };
  }

  const finalCaptureIndex = context.toolCalls.findIndex(
    (call, index) =>
      index > refinementWriteIndex &&
      call.toolName === DESIGN_CAPTURE_TOOL_NAME,
  );
  if (finalCaptureIndex < 0) {
    return {
      allow: false,
      message:
        "The host recorded a refinement write after the first review, but no rendered verification of that refinement. Call opendesign_capture_canvas again and evaluate the updated image before finishing.",
    };
  }

  return { allow: true };
}

function latestReviewedDeliveryScope(
  toolCalls: readonly AgentToolCallRecord[],
): { targets: Array<{ targetId: string }> } | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const call = toolCalls[index];
    if (
      call?.toolName !== DESIGN_DELIVERY_SCOPE_TOOL_NAME ||
      !isRecord(call.result) ||
      !isRecord(call.result.deliveryScope)
    ) {
      continue;
    }
    const targets = call.result.deliveryScope.targets;
    if (
      Array.isArray(targets) &&
      targets.length > 0 &&
      targets.every(
        (target) => isRecord(target) && typeof target.targetId === "string",
      )
    ) {
      return {
        targets: targets.map((target) => ({
          targetId: (target as { targetId: string }).targetId,
        })),
      };
    }
  }
  return undefined;
}

type DeliveryStageProgress = {
  totalTargets: number;
  plannedTargets: number;
  nextTargetId?: string;
};

function latestDeliveryStage(
  toolCalls: readonly AgentToolCallRecord[],
): DeliveryStageProgress | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    const parsed = parseDeliveryStage(result.deliveryStage);
    if (parsed) return parsed;
  }
  return undefined;
}

function initialDeliveryStage(
  serialized: string | undefined,
): DeliveryStageProgress | undefined {
  if (!serialized) return undefined;
  try {
    const content: unknown = JSON.parse(serialized);
    return isRecord(content)
      ? parseDeliveryStage(content.deliveryStage)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseDeliveryStage(value: unknown): DeliveryStageProgress | undefined {
  if (!isRecord(value)) return undefined;
  if (
    !Number.isSafeInteger(value.totalTargets) ||
    !Number.isSafeInteger(value.plannedTargets) ||
    Number(value.totalTargets) < 1 ||
    Number(value.plannedTargets) < 1 ||
    Number(value.plannedTargets) > Number(value.totalTargets)
  ) {
    return undefined;
  }
  const nextTarget = isRecord(value.nextTarget) ? value.nextTarget : undefined;
  return {
    totalTargets: Number(value.totalTargets),
    plannedTargets: Number(value.plannedTargets),
    ...(typeof nextTarget?.targetId === "string"
      ? { nextTargetId: nextTarget.targetId }
      : {}),
  };
}

function deliveryIsOrderedScopePrefix(
  delivery: DesignDeliveryLedger,
  scope: { targets: Array<{ targetId: string }> },
): boolean {
  return (
    delivery.targets.length <= scope.targets.length &&
    delivery.targets.every(
      (target, index) => scope.targets[index]?.targetId === target.targetId,
    )
  );
}

function latestDeliveryLedger(
  toolCalls: readonly AgentToolCallRecord[],
): DesignDeliveryLedger | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    if (result.deliveryDisposition === "superseded") return undefined;
    const delivery = result.delivery;
    if (isDesignDeliveryLedger(delivery)) return delivery;
    const unfinishedDelivery = result.unfinishedDelivery;
    if (isDesignDeliveryLedger(unfinishedDelivery)) return unfinishedDelivery;
  }
  return undefined;
}

function hasSupersededDelivery(
  toolCalls: readonly AgentToolCallRecord[],
): boolean {
  return toolCalls.some(
    (call) =>
      call.toolName === DESIGN_PAGE_TOOL_NAME &&
      isRecord(call.result) &&
      call.result.deliveryDisposition === "superseded",
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
            ? `Record a structured visual review for ${target.label}.`
            : target.status === "reviewed"
              ? `Apply a concrete refinement to ${target.label} based on that review.`
              : `Capture ${target.label} again to verify the refined revision.`;
  return {
    allow: false,
    message: `The current executable Plan is ${progress} verified. ${action} Finish this stage before defining the next confirmed target Plan. Do not stop or ask the user to send “continue”.`,
  };
}

function hasPlacedRaster(toolCalls: readonly AgentToolCallRecord[]): boolean {
  return toolCalls.some((call) => call.toolName === PLACE_IMAGE_TOOL_NAME);
}

function isEditableCreatedArtboardPlan(input: unknown): boolean {
  if (!isRecord(input) || input.outputMode !== "editable-composition") {
    return false;
  }
  return isRecord(input.artboard) && input.artboard.mode === "create";
}

function editableInsertedLayerCount(
  toolCalls: readonly AgentToolCallRecord[],
  plan: unknown,
): number {
  const frameId =
    isRecord(plan) && isRecord(plan.artboard)
      ? plan.artboard.frameId
      : undefined;
  let count = 0;
  for (const call of toolCalls) {
    if (call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME) {
      count += compactFirstSliceMaterialCount(call.input);
      continue;
    }
    const commands = materialNodeCommands(call);
    if (commands.length === 0) continue;
    for (const command of commands) {
      if (command.type !== "insert_element" || !isRecord(command.node)) {
        continue;
      }
      if (command.node.id === frameId || command.node.kind === "image")
        continue;
      count += 1;
    }
  }
  return count;
}

export const DESIGN_VISUAL_COMPLETION_GUARD: CompletionGuardPort = {
  review: reviewDesignCompletion,
};

function findMaterialWriteIndex(
  toolCalls: readonly AgentToolCallRecord[],
): number {
  let firstStructuralWriteIndex = -1;
  let insertedNodeCount = 0;
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    if (!call) continue;
    if (call.toolName === PLACE_IMAGE_TOOL_NAME) return index;
    if (
      call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME &&
      compactFirstSliceMaterialCount(call.input) > 0
    ) {
      return index;
    }
    const commands = materialNodeCommands(call);
    if (commands.length === 0) continue;
    if (firstStructuralWriteIndex < 0) firstStructuralWriteIndex = index;
    if (commands.some((command) => command.type === "replace_subtree")) {
      return firstStructuralWriteIndex;
    }
    insertedNodeCount += commands.filter(
      (command) => command.type === "insert_element",
    ).length;
    if (insertedNodeCount >= 2 || commands.length >= 5) {
      return firstStructuralWriteIndex;
    }
  }
  return -1;
}

function isSuccessfulDesignWrite(call: AgentToolCallRecord): boolean {
  return (
    call.toolName === PLACE_IMAGE_TOOL_NAME ||
    call.toolName === IMPORT_SVG_TOOL_NAME ||
    call.toolName === UPDATE_IMAGE_TOOL_NAME ||
    call.toolName === EDIT_IMAGE_TOOL_NAME ||
    call.toolName === DESIGN_ARRANGE_TOOL_NAME ||
    call.toolName === DESIGN_HIERARCHY_TOOL_NAME ||
    call.toolName === DESIGN_EDIT_TOOL_NAME ||
    call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME ||
    (call.toolName === DESIGN_SYSTEM_TOOL_NAME &&
      isMaterialDesignSystemWrite(call.input)) ||
    (call.toolName === DESIGN_APPLY_TOOL_NAME &&
      readCommands(call.input).length > 0)
  );
}

function materialNodeCommands(call: AgentToolCallRecord) {
  if (call.toolName === DESIGN_APPLY_TOOL_NAME) return readCommands(call.input);
  if (call.toolName !== DESIGN_EDIT_TOOL_NAME || !isRecord(call.input)) {
    return [];
  }
  const edits = call.input.edits;
  if (!Array.isArray(edits)) return [];
  return edits.flatMap((edit) =>
    isRecord(edit) && edit.kind === "node" && isRecord(edit.input)
      ? readCommands(edit.input)
      : [],
  );
}

function isPlanBearingCall(call: AgentToolCallRecord): boolean {
  return (
    call.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME ||
    call.toolName === DESIGN_PLAN_TOOL_NAME ||
    call.toolName === DESIGN_FIRST_SLICE_TOOL_NAME
  );
}

function compactFirstSliceMaterialCount(input: unknown): number {
  if (!isRecord(input) || !isRecord(input.firstSlice)) return 0;
  const stages = input.firstSlice.stages;
  if (!Array.isArray(stages)) return 0;
  let count = 0;
  for (const stage of stages as unknown[]) {
    if (!isRecord(stage) || !Array.isArray(stage.elements)) continue;
    for (const element of stage.elements as unknown[]) {
      if (
        isRecord(element) &&
        element.kind !== "group" &&
        element.kind !== "frame"
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function isMaterialComponentWrite(input: unknown): boolean {
  if (!isRecord(input)) return false;
  if (
    input.action === "create-instance" ||
    input.action === "reset-overrides"
  ) {
    return true;
  }
  if (input.action !== "set-override" || !isRecord(input.patch)) return false;
  return Object.keys(input.patch).some((key) => key !== "name");
}

function isMaterialDesignSystemWrite(input: unknown): boolean {
  if (!isRecord(input) || !isRecord(input.input)) return false;
  if (input.kind === "component") {
    return isMaterialComponentWrite(input.input);
  }
  if (input.kind === "variable") {
    return (
      input.input.action === "set-binding" ||
      (input.input.action === "set-mode" &&
        isRecord(input.input.target) &&
        input.input.target.kind === "node")
    );
  }
  return (
    input.kind === "style" &&
    (input.input.action === "create-from-node" ||
      input.input.action === "update-from-node" ||
      input.input.action === "set-reference")
  );
}

function readCommands(
  input: unknown,
): Array<{ type?: unknown; node?: unknown }> {
  if (!isRecord(input) || !Array.isArray(input.commands)) return [];
  return input.commands.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
