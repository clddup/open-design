import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import {
  DESIGN_STYLE_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
  isDesignStyleToolInput,
  isDesignVariableToolInput,
} from "../../shared/design-agent-tools.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignSystemTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  const { call, context, coordinator } = input;
  let materialNodeIds: string[];
  if (call.toolName === DESIGN_VARIABLE_TOOL_NAME) {
    if (!isDesignVariableToolInput(call.input)) {
      throw new TypeError("Invalid Variables tool input");
    }
    materialNodeIds =
      call.input.action === "set-binding"
        ? [call.input.target.nodeId]
        : call.input.action === "set-mode" && call.input.target.kind === "node"
          ? [call.input.target.id]
          : [];
  } else if (call.toolName === DESIGN_STYLE_TOOL_NAME) {
    if (!isDesignStyleToolInput(call.input)) {
      throw new TypeError("Invalid Styles tool input");
    }
    materialNodeIds =
      call.input.action === "create-from-node" ||
      call.input.action === "update-from-node" ||
      call.input.action === "set-reference"
        ? [call.input.nodeId]
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
