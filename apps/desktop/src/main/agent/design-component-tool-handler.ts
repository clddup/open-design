import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import type { DesignComponentToolInput } from "@/shared/design-agent-tools.js";
import {
  componentToolIsMaterialWrite,
  materialTargetRefsForComponentTool,
} from "./component-tool-policy.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleCanonicalDesignComponentTool(
  input: {
    call: ToolCallRequest;
    context: TrustedToolContext;
    coordinator: GlobalTaskCoordinator;
    execute(call: ToolCallRequest): Promise<TrustedToolResult>;
    withDelivery(result: TrustedToolResult, runId: string): TrustedToolResult;
  },
  componentInput: DesignComponentToolInput,
): Promise<TrustedToolResult> {
  input.coordinator.assertComponentToolAccess(input.context, componentInput);
  input.coordinator.assertDocumentInspected(input.context);
  const materialWrite = componentToolIsMaterialWrite(componentInput);
  if (materialWrite) {
    input.coordinator.assertVisualReviewBeforeWrite(input.context);
  }
  const result = await input.execute({ ...input.call, input: componentInput });
  if (!materialWrite) return result;
  const refs = materialTargetRefsForComponentTool(componentInput);
  const targetIds = input.coordinator.resolveMaterialTargetIdsIfPlanned(
    input.context,
    refs.nodeIds,
    refs.parentId,
  );
  input.coordinator.recordMaterialDesignWriteCompleted(
    input.context.runId,
    targetIds,
    result.designRevision?.revision,
    refs.createdNodeIds,
  );
  return input.withDelivery(result, input.context.runId);
}
