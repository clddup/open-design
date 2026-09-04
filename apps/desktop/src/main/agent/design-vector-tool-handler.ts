import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_VECTOR_TOOL_NAME,
  type DesignVectorToolInput,
} from "@/shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignVectorTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  const { context, coordinator } = input;
  if (input.call.toolName !== DESIGN_VECTOR_TOOL_NAME) return null;
  const value = input.call.input as DesignVectorToolInput;

  const targetRefs = materialTargetRefs(value);
  const targetIds = coordinator.resolveMaterialTargetIdsIfPlanned(
    context,
    targetRefs.nodeIds,
    targetRefs.parentId,
  );
  const result = await input.execute({ ...input.call, input: value });
  coordinator.recordMaterialDesignWriteCompleted(
    context.runId,
    targetIds,
    result.designRevision?.revision,
    createdNodeIds(),
  );
  return input.withDelivery(result, context.runId);
}

function materialTargetRefs(input: DesignVectorToolInput): {
  nodeIds: string[];
  parentId?: string | null;
} {
  if ("nodeId" in input) return { nodeIds: [input.nodeId] };
  if ("nodeIds" in input) {
    return { nodeIds: [...input.nodeIds] };
  }
  if ("targets" in input) {
    return { nodeIds: input.targets.map((target) => target.nodeId) };
  }
  return { nodeIds: [] };
}

function createdNodeIds(): string[] {
  return [];
}
