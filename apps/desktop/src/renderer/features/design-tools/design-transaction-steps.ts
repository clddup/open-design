import type {
  DesignError,
  DesignOperation,
  DesignTransaction,
  DesignTransactionSuccess,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import {
  DESIGN_APPLY_TOOL_NAME,
  DesignApplyContract,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  type InternalDesignApplyToolInput,
} from "@/shared/design-agent-tools";
import type {
  RendererDesignToolProgressPhase,
  RendererDesignToolRequest,
  RendererDesignToolResponse,
} from "@/shared/design-tool-bridge";
import {
  throwIfAgentGenerationAborted,
  waitForCanvasPaint,
} from "./agent-generation-timing";

type SemanticTransactionOptions = {
  signal?: AbortSignal;
  stageDelayMs?: number;
  onProgress?: (
    phase: RendererDesignToolProgressPhase,
    progress: number,
    message?: string,
  ) => void;
  onCanvasWait?: (durationMs: number, configuredDelayMs: number) => void;
};

export async function executeSemanticDesignTransaction(options: {
  request: RendererDesignToolRequest;
  runtime: EditorRuntime;
  transaction: DesignTransaction;
  preview: DesignTransactionSuccess;
  execution: SemanticTransactionOptions;
  createFailure: (
    error: DesignError,
    commands: readonly DesignOperation[],
  ) => Error;
}): Promise<RendererDesignToolResponse> {
  const { request, runtime, transaction, preview, execution, createFailure } =
    options;
  const applyInput = designApplyInput(request);
  if (
    request.call.toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME &&
    applyInput?.executionMode === "atomic"
  ) {
    throwIfAgentGenerationAborted(execution.signal);
    const result = runtime.apply(transaction);
    if (!result.ok) throw createFailure(result.error, transaction.commands);
    execution.onProgress?.(
      "applying",
      0.9,
      `设计步骤：${transaction.label ?? "Apply design transaction"} · r${result.revision.revision}`,
    );
    return {
      requestId: request.requestId,
      ok: true,
      result: {
        content: {
          ok: true,
          label: transaction.label,
          revision: result.revision.revision,
          stages: 1,
          changes: result.changes,
          warnings: result.warnings,
        },
        designRevision: {
          previousRevision: transaction.baseRevision,
          revision: result.revision.revision,
          transactionId: transaction.transactionId,
        },
      },
    };
  }

  const remainingCommands = [...transaction.commands];
  const remainingSteps = semanticApplySteps(
    request,
    transaction.commands,
    transaction.label ?? "Apply design transaction",
  );
  const { onCanvasWait, signal, stageDelayMs = 0 } = execution;
  let appliedStages = 0;
  let lastResult: DesignTransactionSuccess | undefined;
  const committedSteps: Array<{
    stepIds: string[];
    label: string;
    revision: number;
  }> = [];
  try {
    while (remainingCommands.length > 0) {
      throwIfAgentGenerationAborted(signal);
      const currentRevision = runtime.getSnapshot().document.revision;
      const commands = nextValidSemanticStage(
        runtime,
        transaction,
        remainingCommands,
        semanticStageCandidateSizes(remainingSteps),
        appliedStages,
        createFailure,
      );
      const finalStage = commands.length === remainingCommands.length;
      const onlyStage =
        appliedStages === 0 &&
        finalStage &&
        remainingCommands.length === transaction.commands.length;
      const result = runtime.apply(
        {
          ...transaction,
          transactionId: onlyStage
            ? transaction.transactionId
            : `${transaction.transactionId}_stage_${appliedStages + 1}`,
          baseRevision: currentRevision,
          commands,
        },
        {
          historyGroupId: transaction.transactionId,
          finalizeHistoryGroup: finalStage,
        },
      );
      if (!result.ok) throw createFailure(result.error, commands);
      appliedStages += 1;
      lastResult = result;
      remainingCommands.splice(0, commands.length);
      const completedSteps = consumeSemanticSteps(
        remainingSteps,
        commands.length,
      );
      committedSteps.push({
        stepIds: completedSteps.map((step) => step.stepId),
        label: completedSteps.map((step) => step.label).join(" + "),
        revision: result.revision.revision,
      });
      const committed = committedSteps.at(-1);
      execution.onProgress?.(
        "applying",
        0.1 +
          0.8 *
            ((transaction.commands.length - remainingCommands.length) /
              transaction.commands.length),
        committed
          ? `设计步骤：${committed.label} · r${committed.revision}`
          : undefined,
      );
      if (remainingCommands.length > 0) {
        await waitForCanvasPaint(signal, stageDelayMs, onCanvasWait);
      }
    }
  } catch (error) {
    if (appliedStages > 0) {
      runtime.rollbackHistoryGroup(
        transaction.transactionId,
        transaction.actor.id,
      );
    }
    throw error;
  }
  if (!lastResult) throw new Error("Design transaction had no visible stages");
  return {
    requestId: request.requestId,
    ok: true,
    result: {
      content: {
        ok: true,
        label: transaction.label,
        revision: lastResult.revision.revision,
        stages: appliedStages,
        committedSteps,
        changes: {
          ...preview.changes,
          toRevision: lastResult.revision.revision,
        },
        warnings: lastResult.warnings,
      },
      designRevision: {
        previousRevision: transaction.baseRevision,
        ...(transaction.baseRevision === request.context.revision
          ? {}
          : { rebasedFromRevision: request.context.revision }),
        revision: lastResult.revision.revision,
        transactionId: transaction.transactionId,
      },
    },
  };
}

function nextValidSemanticStage(
  runtime: EditorRuntime,
  transaction: DesignTransaction,
  remainingCommands: readonly DesignOperation[],
  candidateSizes: readonly number[],
  stageIndex: number,
  createFailure: (
    error: DesignError,
    commands: readonly DesignOperation[],
  ) => Error,
): DesignOperation[] {
  const baseRevision = runtime.getSnapshot().document.revision;
  let firstFailure:
    | {
        result: ReturnType<EditorRuntime["preview"]>;
        commands: DesignOperation[];
      }
    | undefined;
  for (const commandCount of candidateSizes) {
    const commands = remainingCommands.slice(0, commandCount);
    const candidate = runtime.preview({
      ...transaction,
      transactionId: `${transaction.transactionId}_preview_stage_${stageIndex + 1}_${commandCount}`,
      baseRevision,
      commands,
    });
    if (candidate.ok) return commands;
    firstFailure ??= { result: candidate, commands };
  }
  if (firstFailure && !firstFailure.result.ok) {
    throw createFailure(firstFailure.result.error, firstFailure.commands);
  }
  throw new Error("Design transaction has no document-valid visible stage");
}

type SemanticApplyStep = {
  commandCount: number;
  label: string;
  stepId: string;
};

function semanticApplySteps(
  request: RendererDesignToolRequest,
  commands: readonly DesignOperation[],
  fallbackLabel: string,
): SemanticApplyStep[] {
  const applyInput = designApplyInput(request);
  if (applyInput) {
    const steps = applyInput.steps;
    if (steps) {
      return steps.map((step) => ({
        commandCount: step.commandIds.length,
        label: step.label,
        stepId: step.stepId,
      }));
    }
  }
  return [
    {
      commandCount: commands.length,
      label: fallbackLabel,
      stepId: "transaction",
    },
  ];
}

function designApplyInput(
  request: RendererDesignToolRequest,
): InternalDesignApplyToolInput | undefined {
  if (request.call.toolName === DESIGN_APPLY_TOOL_NAME) {
    const parsed = DesignApplyContract.parse(request.call.input, {
      canonical: true,
    });
    return parsed.ok ? parsed.value : undefined;
  }
  if (request.call.toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME) {
    const parsed = DesignApplyContract.parse(request.call.input, {
      internal: true,
    });
    return parsed.ok ? parsed.value : undefined;
  }
  return undefined;
}

function semanticStageCandidateSizes(
  steps: readonly SemanticApplyStep[],
): number[] {
  const sizes: number[] = [];
  let commandCount = 0;
  for (const step of steps) {
    commandCount += step.commandCount;
    sizes.push(commandCount);
  }
  return sizes;
}

function consumeSemanticSteps(
  steps: SemanticApplyStep[],
  commandCount: number,
): SemanticApplyStep[] {
  const completed: SemanticApplyStep[] = [];
  let consumed = 0;
  while (steps.length > 0 && consumed < commandCount) {
    const step = steps.shift();
    if (!step) break;
    completed.push(step);
    consumed += step.commandCount;
  }
  if (consumed !== commandCount || completed.length === 0) {
    throw new Error("Semantic design step boundaries are inconsistent");
  }
  return completed;
}
