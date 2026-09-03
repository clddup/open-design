import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type { RendererDesignToolHost } from "./renderer-design-tool-host.js";

export async function handleDeliveryScopeTool(
  coordinator: GlobalTaskCoordinator,
  rendererHost: RendererDesignToolHost,
  call: ToolCallRequest,
  context: TrustedToolContext,
  executionContext: TrustedToolContext,
  signal: AbortSignal,
  reportProgress?: (message: string, progress: number) => void,
): Promise<TrustedToolResult> {
  const parsed = DeliveryScopeContract.parse(call.input);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure(DESIGN_DELIVERY_SCOPE_TOOL_NAME, parsed.issues),
    );
  }
  const allocation = coordinator.createDeliveryScopeAllocation(
    context,
    call.toolCallId,
    parsed.value,
  );
  const applied = await rendererHost.execute(
    {
      ...call,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: { ...allocation.input, executionMode: "atomic" },
    },
    executionContext,
    signal,
    reportProgress ? { reportProgress } : {},
  );
  const completed = coordinator.recordDeliveryScopeCompleted(
    context,
    call.toolCallId,
    parsed.value,
    allocation,
    applied.designRevision?.revision,
  );
  const rendererContent = isRecord(applied.content) ? applied.content : {};
  return {
    ...applied,
    content: {
      ...rendererContent,
      ok: true,
      status: "recorded",
      deliveryScope: completed.scope,
      allocation: {
        artboards: completed.artboards,
        revision: applied.designRevision?.revision,
        transactionId: applied.designRevision?.transactionId,
      },
      delivery: coordinator.getDeliveryLedger(context.runId),
      deliveryStage: coordinator.getDeliveryStageContext(context.runId),
      nextAction: "define-executable-plan",
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
