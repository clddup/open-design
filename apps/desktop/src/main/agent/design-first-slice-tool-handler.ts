import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  compileDesignFirstSliceToolInput,
  DesignApplyContract,
  DesignPlanContract,
  designPlanTargets,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  type DesignFirstSliceToolInput,
} from "@/shared/design-agent-tools.js";
import { contractValidationError } from "./contract-validation-error.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import type { RendererDesignToolHost } from "./renderer-design-tool-host.js";

export async function handleDesignFirstSliceTool(
  coordinator: GlobalTaskCoordinator,
  rendererHost: RendererDesignToolHost,
  call: ToolCallRequest,
  context: TrustedToolContext,
  executionContext: TrustedToolContext,
  signal: AbortSignal,
  reportProgress?: (message: string, progress: number) => void,
): Promise<TrustedToolResult> {
  const authoritativePrompt = coordinator.authoritativeDesignPrompt(context);
  const input = call.input as DesignFirstSliceToolInput;
  const compiled = compileDesignFirstSliceToolInput(input);
  const parsedPlan = DesignPlanContract.parse(compiled.plan, {
    authoritativePrompt,
    canonical: true,
  });
  if (!parsedPlan.ok) {
    throw contractValidationError(
      "compiled first-slice Plan",
      parsedPlan.issues,
    );
  }
  const parsedApply = DesignApplyContract.parse(compiled.apply, {
    canonical: true,
    internal: true,
  });
  if (!parsedApply.ok) {
    throw contractValidationError(
      "compiled first-slice transaction",
      parsedApply.issues,
    );
  }
  const normalizedApply = parsedApply.value;

  const preparation = coordinator.prepareDesignPlan(context, parsedPlan.value);
  const allocation = coordinator.createDesignPlanAllocation(
    context.runId,
    preparation,
  );
  if (
    allocation &&
    allocation.targetIds.length !== parsedPlan.value.targets.length
  ) {
    throw designWorkflowError(
      "allocation_state_invalid",
      "Compact first-slice generation requires the current target to be pending real Frame creation",
    );
  }
  const authorization = allocation
    ? coordinator.assertDesignPlanForAllocatedApply(
        context,
        normalizedApply,
        allocation.targetIds,
        preparation,
      )
    : coordinator.assertDesignPlanForApply(
        context,
        normalizedApply,
        preparation,
      );
  if (!authorization) {
    throw designWorkflowError(
      "material_write_required",
      "Compiled first-slice content did not resolve to the registered delivery target",
    );
  }
  const resolvedApply = authorization.input;
  const allocationStepId = allocation
    ? uniqueStepId(
        "allocate_artboards",
        new Set(resolvedApply.steps?.map((step) => step.stepId) ?? []),
      )
    : undefined;
  const combinedInput = allocation
    ? {
        label: `Create artboard and ${resolvedApply.label}`,
        summary:
          "Create the current delivery Frame and its first meaningful editable content atomically",
        executionMode: "atomic" as const,
        steps: [
          {
            stepId: allocationStepId!,
            label: "Create real artboard",
            commandIds: allocation.input.commands.map(
              (command) => command.commandId,
            ),
          },
          ...(resolvedApply.steps ?? [
            {
              stepId: "first_slice",
              label: resolvedApply.label,
              commandIds: resolvedApply.commands.map(
                (command) => command.commandId,
              ),
            },
          ]),
        ],
        commands: [...allocation.input.commands, ...resolvedApply.commands],
      }
    : resolvedApply;
  const parsedCombinedInput = DesignApplyContract.parse(combinedInput, {
    canonical: true,
    internal: true,
  });
  if (!parsedCombinedInput.ok) {
    throw contractValidationError(
      "host-bound first-slice transaction",
      parsedCombinedInput.issues,
    );
  }

  const applied = await rendererHost.execute(
    {
      ...call,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: parsedCombinedInput.value,
    },
    executionContext,
    signal,
    reportProgress ? { reportProgress } : {},
  );
  coordinator.assertDesignApplyResult(context, authorization, applied);
  const registration = coordinator.commitDesignPlan(context, preparation);
  const allocationRevision = allocation
    ? committedStepRevision(
        applied.content,
        allocationStepId!,
        applied.designRevision?.revision,
      )
    : coordinator
        .getDeliveryLedger(context.runId)
        ?.targets.find(
          (target) => target.targetId === input.firstSlice.targetId,
        )?.allocatedRevision;
  if (allocation && allocationRevision !== undefined) {
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation.targetIds,
      allocationRevision,
    );
  }
  coordinator.recordDesignEditCompleted(context, authorization, applied);

  const rendererContent = isRecord(applied.content) ? applied.content : {};
  return {
    ...applied,
    content: {
      ...rendererContent,
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
      allocation: {
        targetIds: allocation?.targetIds ?? [input.firstSlice.targetId],
        revision: allocationRevision,
      },
      firstSlice: {
        targetId: input.firstSlice.targetId,
        label: input.firstSlice.label,
        insertedNodeIds: resolvedApply.commands.flatMap((command) =>
          command.type === "insert_element" ? [command.node.id] : [],
        ),
        revision: applied.designRevision?.revision,
      },
      delivery: coordinator.getDeliveryLedger(context.runId),
      deliveryStage: coordinator.getDeliveryStageContext(context.runId),
    },
  };
}

function committedStepRevision(
  content: unknown,
  stepId: string,
  fallbackRevision?: number,
): number | undefined {
  if (!isRecord(content) || !Array.isArray(content.committedSteps)) {
    return validRevision(fallbackRevision) ? fallbackRevision : undefined;
  }
  const committedSteps: unknown[] = content.committedSteps;
  const step = committedSteps.find(
    (candidate) =>
      isRecord(candidate) &&
      Array.isArray(candidate.stepIds) &&
      candidate.stepIds.includes(stepId),
  );
  if (
    !isRecord(step) ||
    !Number.isSafeInteger(step.revision) ||
    Number(step.revision) < 1
  ) {
    return validRevision(fallbackRevision) ? fallbackRevision : undefined;
  }
  return Number(step.revision);
}

function validRevision(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 1;
}

function uniqueStepId(base: string, used: ReadonlySet<string>): string {
  let candidate = base;
  while (used.has(candidate)) candidate = `_${candidate}`;
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
