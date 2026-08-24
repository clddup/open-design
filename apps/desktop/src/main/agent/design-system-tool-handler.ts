import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DesignStyleContract,
  DesignVariableContract,
  DESIGN_STYLE_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignSystemTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  const { context, coordinator } = input;
  let call = input.call;
  let materialNodeIds: string[];
  if (call.toolName === DESIGN_VARIABLE_TOOL_NAME) {
    const parsed = DesignVariableContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Variable", parsed.issues));
    }
    call = { ...call, input: parsed.value };
    materialNodeIds =
      parsed.value.action === "set-binding"
        ? [parsed.value.target.nodeId]
        : parsed.value.action === "set-mode" &&
            parsed.value.target.kind === "node"
          ? [parsed.value.target.id]
          : [];
  } else if (call.toolName === DESIGN_STYLE_TOOL_NAME) {
    const parsed = DesignStyleContract.parse(call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Style", parsed.issues));
    }
    call = { ...call, input: parsed.value };
    materialNodeIds =
      parsed.value.action === "create-from-node" ||
      parsed.value.action === "update-from-node" ||
      parsed.value.action === "set-reference"
        ? [parsed.value.nodeId]
        : [];
  } else return null;

  coordinator.assertDocumentInspected(context);
  if (materialNodeIds.length > 0) {
    coordinator.assertVisualReviewBeforeWrite(context);
  }
  const result = await input.execute(call);
  if (materialNodeIds.length > 0) {
    const targetIds = coordinator.resolveMaterialTargetIdsIfPlanned(
      context,
      materialNodeIds,
    );
    coordinator.recordMaterialDesignWriteCompleted(
      context.runId,
      targetIds,
      result.designRevision?.revision,
      [],
    );
  }
  return input.withDelivery(result, context.runId);
}
