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
  FirstSliceContract,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  logoBriefRequiresExploration,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import { agentDesignNodeIdPrefix } from "@/shared/design-id-allocation.js";
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
  const parsed = FirstSliceContract.parse(call.input, {
    authoritativePrompt,
    newNodeIdPrefix: agentDesignNodeIdPrefix(context.runId),
  });
  if (!parsed.ok) {
    throw new TypeError(
      formatValidationFailure("opendesign_generate_first_slice", parsed.issues),
    );
  }
  const input = coordinator.bindFirstSliceToDeliveryScope(
    context,
    parsed.value,
  );
  if (
    input.deliverable === "logo" &&
    logoBriefRequiresExploration(authoritativePrompt) &&
    input.logoExploration === undefined &&
    (coordinator.getDeliveryStageContext(context.runId)?.plannedTargets ??
      0) === 0
  ) {
    throw designWorkflowError(
      "logo_exploration_required",
      "The current Logo brief explicitly requests three concept directions. Submit one corrected opendesign_generate_first_slice call with logoExploration, three distinct principles and color systems, three declared first-target concept regions, and stable monochrome plus 32/24/16 px evidence IDs; do not allocate or draw a single direction first",
    );
  }
  const compiled = compileDesignFirstSliceToolInput(input);
  const parsedPlan = DesignPlanContract.parse(compiled.plan, {
    authoritativePrompt,
    canonical: true,
  });
  if (!parsedPlan.ok) {
    throw new TypeError(
      formatValidationFailure("compiled first-slice Plan", parsedPlan.issues),
    );
  }
  const parsedApply = DesignApplyContract.parse(compiled.apply, {
    canonical: true,
    internal: true,
  });
  if (!parsedApply.ok) {
    throw new TypeError(
      formatValidationFailure(
        "compiled first-slice transaction",
        parsedApply.issues,
      ),
    );
  }
  const normalizedApply = parsedApply.value;

  const preparation = coordinator.prepareDesignPlan(context, compiled.plan);
  const allocation = coordinator.createDesignPlanAllocation(
    context.runId,
    preparation,
  );
  if (
    allocation &&
    allocation.targetIds.length !== compiled.plan.targets.length
  ) {
    throw designWorkflowError(
      "allocation_state_invalid",
      "Compact first-slice generation requires every declared target to be pending real Frame allocation",
    );
  }
  coordinator.assertVisualReviewBeforeWrite(context);
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
        label: `Allocate artboards and ${resolvedApply.label}`,
        summary:
          "Create every stable delivery Frame root, then commit the first meaningful editable slice as real semantic revisions",
        steps: [
          {
            stepId: allocationStepId!,
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
      }
    : resolvedApply;

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
  const registration = coordinator.commitDesignPlan(context, preparation);
  const allocationRevision = allocation
    ? committedStepRevision(applied.content, allocationStepId!)
    : coordinator
        .getDeliveryLedger(context.runId)
        ?.targets.find(
          (target) => target.targetId === input.firstSlice.targetId,
        )?.allocatedRevision;
  if (allocation) {
    coordinator.recordDesignPlanAllocated(
      context.runId,
      allocation.targetIds,
      allocationRevision,
    );
  }
  coordinator.recordDesignApplyCompleted(
    context.runId,
    resolvedApply,
    authorization,
    applied.designRevision?.revision,
    applied.content,
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

function committedStepRevision(content: unknown, stepId: string): number {
  if (!isRecord(content) || !Array.isArray(content.committedSteps)) {
    throw designWorkflowError(
      "allocation_revision_invalid",
      "Combined first-slice transaction did not report semantic revisions",
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
    throw designWorkflowError(
      "allocation_revision_invalid",
      "Combined first-slice transaction did not expose the real artboard allocation revision",
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
