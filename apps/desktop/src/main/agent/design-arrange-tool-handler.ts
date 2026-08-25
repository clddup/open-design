import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  DesignArrangeContract,
  type DesignArrangeToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignArrangeTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName !== DESIGN_ARRANGE_TOOL_NAME) return null;
  const parsed = DesignArrangeContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("Arrange", parsed.issues));
  }

  const { context, coordinator } = input;
  coordinator.assertVisualReviewBeforeWrite(context);
  const targetIds = coordinator.resolveMaterialTargetIds(
    context,
    materialTargetIds(parsed.value),
  );
  const result = await input.execute({ ...input.call, input: parsed.value });
  coordinator.recordMaterialDesignWriteCompleted(
    context.runId,
    targetIds,
    result.designRevision?.revision,
    [],
  );
  return input.withDelivery(result, context.runId);
}

function materialTargetIds(input: DesignArrangeToolInput): string[] {
  if ("nodeId" in input) return [input.nodeId];
  if ("frameId" in input) return [input.frameId];
  return [...input.nodeIds];
}
