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
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools.js";

export function reviewDesignCompletion(
  context: AgentCompletionContext,
): AgentCompletionDecision {
  const delivery = latestDeliveryLedger(context.toolCalls);
  if (delivery) {
    const incomplete = delivery.targets.find(
      (target) => target.status !== "verified",
    );
    if (incomplete) return incompleteDeliveryDecision(delivery, incomplete);
  }
  const generationIndex = context.toolCalls.findIndex(
    (call) => call.toolName === GENERATE_IMAGE_TOOL_NAME,
  );
  const materialWriteIndex = findMaterialWriteIndex(context.toolCalls);
  if (materialWriteIndex < 0) {
    if (generationIndex < 0) return { allow: true };
    return {
      allow: false,
      message:
        "Image generation alone did not change the design. Continue with the declared editable composition and apply it to the planned artboard before finishing.",
    };
  }

  const planIndex = context.toolCalls.findIndex(
    (call, index) =>
      index < materialWriteIndex && call.toolName === DESIGN_PLAN_TOOL_NAME,
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
  if (inspectionIndex < 0) {
    return {
      allow: false,
      message:
        "The structured design plan was not preceded by a successful document inspection. Call opendesign_inspect_document, correct the plan from the live structure and diagnostics, then continue.",
    };
  }

  const plan = context.toolCalls[planIndex]?.input;
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
        "The first rendered draft needs a structured visual critique. Call opendesign_record_visual_review with concrete composition, hierarchy, typography, asset-integration, surface, and refinement findings before editing again.",
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

function latestDeliveryLedger(
  toolCalls: readonly AgentToolCallRecord[],
): DesignDeliveryLedger | undefined {
  for (let index = toolCalls.length - 1; index >= 0; index -= 1) {
    const result = toolCalls[index]?.result;
    if (!isRecord(result)) continue;
    const delivery = result.delivery;
    if (isDesignDeliveryLedger(delivery)) return delivery;
    const unfinishedDelivery = result.unfinishedDelivery;
    if (isDesignDeliveryLedger(unfinishedDelivery)) return unfinishedDelivery;
  }
  return undefined;
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
      : target.status === "drafted"
        ? `Capture ${target.label} from its bound Frame and inspect the rendered result.`
        : target.status === "captured"
          ? `Record a structured visual review for ${target.label}.`
          : target.status === "reviewed"
            ? `Apply a concrete refinement to ${target.label} based on that review.`
            : `Capture ${target.label} again to verify the refined revision.`;
  return {
    allow: false,
    message: `The host delivery ledger is ${progress} verified. ${action} Do not stop or ask the user to send “continue”; complete every declared target in this Run.`,
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
    if (call.toolName !== DESIGN_APPLY_TOOL_NAME) continue;
    for (const command of readCommands(call.input)) {
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
    if (call.toolName !== DESIGN_APPLY_TOOL_NAME) continue;
    const commands = readCommands(call.input);
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
    call.toolName === DESIGN_ARRANGE_TOOL_NAME ||
    call.toolName === DESIGN_HIERARCHY_TOOL_NAME ||
    (call.toolName === DESIGN_COMPONENT_TOOL_NAME &&
      isMaterialComponentWrite(call.input)) ||
    (call.toolName === DESIGN_APPLY_TOOL_NAME &&
      readCommands(call.input).length > 0)
  );
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

function readCommands(
  input: unknown,
): Array<{ type?: unknown; node?: unknown }> {
  if (!isRecord(input) || !Array.isArray(input.commands)) return [];
  return input.commands.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
