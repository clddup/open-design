import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_VECTOR_TOOL_NAME,
  DesignVectorContract,
  type DesignVectorToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
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
  const parsed = DesignVectorContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("Vector", parsed.issues));
  }
  const value = parsed.value;

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
