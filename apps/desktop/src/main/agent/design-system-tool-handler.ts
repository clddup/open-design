import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_SYSTEM_TOOL_NAME,
  DesignSystemContract,
  INTERNAL_DESIGN_COMPONENT_TOOL_NAME,
  INTERNAL_DESIGN_STYLE_TOOL_NAME,
  INTERNAL_DESIGN_VARIABLE_TOOL_NAME,
  type DesignStyleToolInput,
  type DesignSystemToolInput,
  type DesignVariableToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import { handleCanonicalDesignComponentTool } from "./design-component-tool-handler.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

type HandlerInput = {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
};

export async function handleDesignSystemTool(
  input: HandlerInput,
): Promise<TrustedToolResult | null> {
  if (input.call.toolName !== DESIGN_SYSTEM_TOOL_NAME) return null;
  const parsed = DesignSystemContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("Design system", parsed.issues),
    );
  }
  if (parsed.value.kind === "component") {
    return handleCanonicalDesignComponentTool(
      {
        ...input,
        call: internalCall(
          input.call,
          INTERNAL_DESIGN_COMPONENT_TOOL_NAME,
          parsed.value.input,
        ),
      },
      parsed.value.input,
    );
  }
  input.coordinator.assertDocumentInspected(input.context);
  return handleVariableOrStyle(input, parsed.value);
}

async function handleVariableOrStyle(
  input: HandlerInput,
  designSystemInput: Exclude<DesignSystemToolInput, { kind: "component" }>,
): Promise<TrustedToolResult> {
  const nodeIds = materialNodeIds(designSystemInput);
  if (nodeIds.length > 0) {
    input.coordinator.assertVisualReviewBeforeWrite(input.context);
  }
  const toolName =
    designSystemInput.kind === "variable"
      ? INTERNAL_DESIGN_VARIABLE_TOOL_NAME
      : INTERNAL_DESIGN_STYLE_TOOL_NAME;
  const result = await input.execute(
    internalCall(input.call, toolName, designSystemInput.input),
  );
  if (nodeIds.length > 0) recordMaterialWrite(input, nodeIds, result);
  return input.withDelivery(result, input.context.runId);
}

function recordMaterialWrite(
  input: HandlerInput,
  nodeIds: string[],
  result: TrustedToolResult,
): void {
  const targetIds = input.coordinator.resolveMaterialTargetIdsIfPlanned(
    input.context,
    nodeIds,
  );
  input.coordinator.recordMaterialDesignWriteCompleted(
    input.context.runId,
    targetIds,
    result.designRevision?.revision,
    [],
  );
}

function materialNodeIds(
  input: Exclude<DesignSystemToolInput, { kind: "component" }>,
): string[] {
  return input.kind === "variable"
    ? variableMaterialNodeIds(input.input)
    : styleMaterialNodeIds(input.input);
}

function variableMaterialNodeIds(input: DesignVariableToolInput): string[] {
  if (input.action === "set-binding") return [input.target.nodeId];
  if (input.action === "set-mode" && input.target.kind === "node") {
    return [input.target.id];
  }
  return [];
}

function styleMaterialNodeIds(input: DesignStyleToolInput): string[] {
  return input.action === "create-from-node" ||
    input.action === "update-from-node" ||
    input.action === "set-reference"
    ? [input.nodeId]
    : [];
}

function internalCall(
  call: ToolCallRequest,
  toolName: string,
  input: unknown,
): ToolCallRequest {
  return { ...call, toolName, input };
}
