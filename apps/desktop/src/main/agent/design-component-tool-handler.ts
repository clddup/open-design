import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_COMPONENT_TOOL_NAME,
  DesignComponentContract,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import {
  componentToolIsMaterialWrite,
  materialTargetRefsForComponentTool,
} from "./component-tool-policy.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignComponentTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute(call: ToolCallRequest): Promise<TrustedToolResult>;
  withDelivery(result: TrustedToolResult, runId: string): TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName !== DESIGN_COMPONENT_TOOL_NAME) return null;

  const parsed = DesignComponentContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("Component", parsed.issues));
  }
  const componentInput = parsed.value;
  input.coordinator.assertComponentToolAccess(input.context, componentInput);
  input.coordinator.assertDocumentInspected(input.context);
  const materialWrite = componentToolIsMaterialWrite(componentInput);
  if (materialWrite) {
    input.coordinator.assertVisualReviewBeforeWrite(input.context);
  }
  const result = await input.execute({
    ...input.call,
    input: componentInput,
  });
  if (!materialWrite) return result;

  const targetRefs = materialTargetRefsForComponentTool(componentInput);
  const targetIds = input.coordinator.resolveMaterialTargetIdsIfPlanned(
    input.context,
    targetRefs.nodeIds,
    targetRefs.parentId,
  );
  input.coordinator.recordMaterialDesignWriteCompleted(
    input.context.runId,
    targetIds,
    result.designRevision?.revision,
    targetRefs.createdNodeIds,
  );
  return input.withDelivery(result, input.context.runId);
}
