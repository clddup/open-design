import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DesignPlanContract,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  designPlanTargets,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type { RendererDesignToolHost } from "./renderer-design-tool-host.js";

export async function handleDesignPlanTool(
  coordinator: GlobalTaskCoordinator,
  rendererHost: RendererDesignToolHost,
  call: ToolCallRequest,
  context: TrustedToolContext,
  executionContext: TrustedToolContext,
  signal: AbortSignal,
  reportProgress?: (message: string, progress: number) => void,
): Promise<TrustedToolResult> {
  const parsed = DesignPlanContract.parse(call.input);
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("opendesign_define_design_plan", parsed.issues),
    );
  }
  const plan = parsed.value;
  const registration = coordinator.registerDesignPlan(context, plan);
  const allocation = coordinator.createDesignPlanAllocation(context.runId);
  const allocated = allocation
    ? await rendererHost.execute(
        {
          ...call,
          toolCallId: `${call.toolCallId}_allocate`,
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: { ...allocation.input, executionMode: "atomic" },
        },
        executionContext,
        signal,
        reportProgress ? { reportProgress } : {},
      )
    : undefined;
  if (allocation) {
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation.targetIds,
      allocated?.designRevision?.revision,
    );
  }
  return {
    content: {
      ok: true,
      status: registration.status,
      planRevision: registration.planRevision,
      changedTargetIds: registration.changedTargetIds,
      plan: registration.plan,
      version: registration.plan.version,
      deliverable: registration.plan.deliverable,
      outputMode: registration.plan.outputMode,
      targets: designPlanTargets(registration.plan),
      rasterAssetRoles: registration.plan.rasterAssetRoles,
      delivery: coordinator.getDeliveryLedger(context.runId),
      allocation: allocation
        ? {
            targetIds: allocation.targetIds,
            revision: allocated?.designRevision?.revision,
            transactionId: allocated?.designRevision?.transactionId,
          }
        : null,
    },
    ...(allocated?.designRevision
      ? { designRevision: allocated.designRevision }
      : {}),
  };
}
