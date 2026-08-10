import type {
  AgentCompletionContext,
  AgentCompletionDecision,
  AgentToolCallRecord,
  CompletionGuardPort,
} from "@opendesign/agent-runtime";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools.js";

export function reviewDesignCompletion(
  context: AgentCompletionContext,
): AgentCompletionDecision {
  const materialWriteIndex = findMaterialWriteIndex(context.toolCalls);
  if (materialWriteIndex < 0) return { allow: true };

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

  const refinementWriteIndex = context.toolCalls.findIndex(
    (call, index) => index > firstCaptureIndex && isSuccessfulDesignWrite(call),
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
    call.toolName === DESIGN_HIERARCHY_TOOL_NAME ||
    (call.toolName === DESIGN_APPLY_TOOL_NAME &&
      readCommands(call.input).length > 0)
  );
}

function readCommands(input: unknown): Array<{ type?: unknown }> {
  if (!isRecord(input) || !Array.isArray(input.commands)) return [];
  return input.commands.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
