import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_FONT_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DesignFontContract,
  DesignTextRangeContract,
  type DesignFontToolInput,
  type DesignTextRangeToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export async function handleDesignTypographyTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  let value: DesignFontToolInput | DesignTextRangeToolInput;
  if (input.call.toolName === DESIGN_FONT_TOOL_NAME) {
    const parsed = DesignFontContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Font", parsed.issues));
    }
    value = parsed.value;
  } else if (input.call.toolName === DESIGN_TEXT_RANGE_TOOL_NAME) {
    const parsed = DesignTextRangeContract.parse(input.call.input);
    if (!parsed.ok) {
      throw new TypeError(formatValidationFailure("Text Range", parsed.issues));
    }
    value = parsed.value;
  } else {
    return null;
  }

  const { context, coordinator } = input;
  coordinator.assertDocumentInspected(context);
  coordinator.assertVisualReviewBeforeWrite(context);
  const targetNodeIds =
    "nodeIds" in value ? [...value.nodeIds] : [value.nodeId];
  const targetIds = coordinator.resolveMaterialTargetIdsIfPlanned(
    context,
    targetNodeIds,
  );
  const result = await input.execute({ ...input.call, input: value });
  coordinator.recordMaterialDesignWriteCompleted(
    context.runId,
    targetIds,
    result.designRevision?.revision,
  );
  return input.withDelivery(result, context.runId);
}
