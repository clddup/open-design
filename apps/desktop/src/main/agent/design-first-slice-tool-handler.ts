import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-runtime";
import {
  compileDesignFirstSliceToolInput,
  designPlanTargets,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  isDesignFirstSliceToolInput,
  isDesignPlanToolInput,
  normalizeDesignApplyToolInput,
} from "../../shared/design-agent-tools.js";
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
  if (!isDesignFirstSliceToolInput(call.input)) {
    throw new TypeError("Invalid compact first-slice tool input");
  }
  const compiled = compileDesignFirstSliceToolInput(call.input);
  if (!isDesignPlanToolInput(compiled.plan)) {
    throw new TypeError("Compiled first-slice plan is invalid");
  }
  const normalizedApply = normalizeDesignApplyToolInput(compiled.apply);
  if (!normalizedApply) {
    throw new TypeError("Compiled first-slice transaction is invalid");
  }

  const registration = coordinator.registerDesignPlan(context, compiled.plan);
  const allocation = coordinator.createDesignPlanAllocation(context.runId);
  if (
    !allocation ||
    allocation.targetIds.length !== compiled.plan.targets.length
  ) {
    throw new Error(
      "design_workflow.allocation_state_invalid: Compact first-slice generation requires every declared target to be pending real Frame allocation",
    );
  }
  coordinator.assertVisualReviewBeforeWrite(context);
  const authorization = coordinator.assertDesignPlanForAllocatedApply(
    context,
    normalizedApply,
    allocation.targetIds,
  );
  const resolvedApply = authorization.input;
  const allocationStepId = uniqueStepId(
    "allocate_artboards",
    new Set(resolvedApply.steps?.map((step) => step.stepId) ?? []),
  );
  const combinedInput = {
    label: `Allocate artboards and ${resolvedApply.label}`,
    summary:
      "Create every stable delivery Frame root, then commit the first meaningful editable slice as real semantic revisions",
    steps: [
      {
        stepId: allocationStepId,
        label:
          allocation.targetIds.length === 1
            ? "Create real artboard"
            : `Create ${allocation.targetIds.length} real artboards`,
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
  };

  const applied = await rendererHost.execute(
    {
      ...call,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: combinedInput,
    },
    executionContext,
    signal,
    reportProgress ? { reportProgress } : {},
  );
  coordinator.assertDesignApplyResult(context, authorization, applied);
  const allocationRevision = committedStepRevision(
    applied.content,
    allocationStepId,
  );
  coordinator.recordDesignPlanAllocated(
    context.runId,
    allocation.targetIds,
    allocationRevision,
  );
  coordinator.recordDesignApplyCompleted(
    context.runId,
    resolvedApply,
    authorization,
    applied.designRevision?.revision,
  );

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
        targetIds: allocation.targetIds,
        revision: allocationRevision,
      },
      firstSlice: {
        targetId: call.input.firstSlice.targetId,
        label: call.input.firstSlice.label,
        insertedNodeIds: compiled.insertedNodeIds,
        revision: applied.designRevision?.revision,
      },
      delivery: coordinator.getDeliveryLedger(context.runId),
    },
  };
}

function committedStepRevision(content: unknown, stepId: string): number {
  if (!isRecord(content) || !Array.isArray(content.committedSteps)) {
    throw new Error(
      "design_workflow.allocation_revision_invalid: Combined first-slice transaction did not report semantic revisions",
    );
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
    throw new Error(
      "design_workflow.allocation_revision_invalid: Combined first-slice transaction did not expose the real artboard allocation revision",
    );
  }
  return Number(step.revision);
}

function uniqueStepId(base: string, used: ReadonlySet<string>): string {
  let candidate = base;
  while (used.has(candidate)) candidate = `_${candidate}`;
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
