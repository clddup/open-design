import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  DesignHierarchyContract,
  DesignVectorContract,
  type DesignHierarchyToolInput,
  type DesignVectorToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignStructureTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  const { context, coordinator } = input;
  let value: DesignHierarchyToolInput | DesignVectorToolInput;
  if (input.call.toolName === DESIGN_HIERARCHY_TOOL_NAME) {
    const parsed = DesignHierarchyContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Hierarchy", parsed.issues));
    }
    value = parsed.value;
  } else if (input.call.toolName === DESIGN_VECTOR_TOOL_NAME) {
    const parsed = DesignVectorContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Vector", parsed.issues));
    }
    value = parsed.value;
  } else {
    return null;
  }

  coordinator.assertVisualReviewBeforeWrite(context);
  const targetRefs = materialTargetRefs(value);
  const targetIds = coordinator.resolveMaterialTargetIds(
    context,
    targetRefs.nodeIds,
    targetRefs.parentId,
  );
  const result = await input.execute({ ...input.call, input: value });
  coordinator.recordMaterialDesignWriteCompleted(
    context.runId,
    targetIds,
    result.designRevision?.revision,
    createdNodeIds(value),
  );
  return input.withDelivery(result, context.runId);
}

function materialTargetRefs(
  input: DesignHierarchyToolInput | DesignVectorToolInput,
): { nodeIds: string[]; parentId?: string | null } {
  if ("nodeId" in input) return { nodeIds: [input.nodeId] };
  if ("nodeIds" in input) {
    return {
      nodeIds: [...input.nodeIds],
      ...(input.action === "reparent" ? { parentId: input.parentId } : {}),
    };
  }
  if ("targets" in input) {
    return { nodeIds: input.targets.map((target) => target.nodeId) };
  }
  if ("maskNodeId" in input) return { nodeIds: [input.maskNodeId] };
  if ("groupId" in input) return { nodeIds: [input.groupId] };
  return { nodeIds: [input.booleanId] };
}

function createdNodeIds(
  input: DesignHierarchyToolInput | DesignVectorToolInput,
): string[] {
  if (input.action === "group" || input.action === "create-mask") {
    return [input.groupId];
  }
  if (input.action === "create-boolean") return [input.booleanId];
  return [];
}
