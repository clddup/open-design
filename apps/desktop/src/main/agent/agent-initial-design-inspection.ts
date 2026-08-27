import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
import {
  MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS,
  type AgentInitialDesignInspection,
  type AgentRequest,
  type ToolCallRequest,
  type TrustedToolContext,
  type TrustedToolResult,
} from "@opendesign/agent-contracts";
import { projectToolResultForModel } from "@opendesign/agent-runtime";
import { DESIGN_INSPECT_TOOL_NAME } from "@/shared/design-agent-tools.js";

type RunStartRequest = Extract<AgentRequest, { type: "run.start" }>;

export const INITIAL_DESIGN_INSPECTION_TIMEOUTS = {
  firstResponseTimeoutMs: 5_000,
  idleTimeoutMs: 10_000,
  totalTimeoutMs: 15_000,
} as const;

export interface InitialDesignInspectionCoordinator {
  assertDesignToolContext(context: TrustedToolContext): void;
  resolveExecutionContext(context: TrustedToolContext): TrustedToolContext;
  recordDocumentInspection(
    context: TrustedToolContext,
    result: TrustedToolResult,
  ): void;
  getRecoverableDelivery(context: TrustedToolContext): unknown;
  getDeliveryStageContext(runId: string): unknown;
}

export interface InitialDesignInspectionRenderer {
  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
    options?: {
      timeouts?: {
        firstResponseTimeoutMs?: number;
        idleTimeoutMs?: number;
        totalTimeoutMs?: number;
      };
    },
  ): Promise<TrustedToolResult>;
}

/**
 * Executes the same trusted Renderer inspection used by the public tool before
 * the first Provider turn. The result is registered in Main and only its
 * existing bounded model projection crosses into the Agent process.
 */
export async function prepareInitialDesignInspection(
  request: RunStartRequest,
  dependencies: {
    coordinator: InitialDesignInspectionCoordinator;
    renderer: InitialDesignInspectionRenderer;
  },
  signal: AbortSignal,
): Promise<AgentInitialDesignInspection> {
  const context = trustedContext(request);
  dependencies.coordinator.assertDesignToolContext(context);
  const executionContext =
    dependencies.coordinator.resolveExecutionContext(context);
  const result = await dependencies.renderer.execute(
    {
      toolCallId: `host_inspect_${request.runId.slice(0, 220)}`,
      toolName: DESIGN_INSPECT_TOOL_NAME,
      input: {},
    },
    executionContext,
    signal,
    { timeouts: INITIAL_DESIGN_INSPECTION_TIMEOUTS },
  );
  if (result.observedRevision !== request.revision) {
    throw designWorkflowError(
      "initial_inspection_stale",
      `Expected revision ${request.revision}, observed ${String(result.observedRevision)}`,
    );
  }
  dependencies.coordinator.recordDocumentInspection(context, result);
  const unfinishedDelivery =
    dependencies.coordinator.getRecoverableDelivery(context);
  const deliveryStage = dependencies.coordinator.getDeliveryStageContext(
    context.runId,
  );
  const content =
    unfinishedDelivery === undefined && deliveryStage === undefined
      ? result.content
      : {
          ...requireRecord(result.content),
          ...(unfinishedDelivery === undefined ? {} : { unfinishedDelivery }),
          ...(deliveryStage === undefined ? {} : { deliveryStage }),
        };
  const serialized = JSON.stringify(projectToolResultForModel(content));
  if (
    serialized.length < 2 ||
    serialized.length > MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS
  ) {
    throw new RangeError("Initial design inspection projection is oversized");
  }
  return {
    version: 1,
    observedRevision: request.revision,
    content: serialized,
  };
}

function trustedContext(request: RunStartRequest): TrustedToolContext {
  return {
    runId: request.runId,
    sessionId: request.sessionId,
    documentId: request.documentId,
    revision: request.revision,
    scope: structuredClone(request.scope),
    mutationTarget: structuredClone(request.mutationTarget),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Document inspection must return structured content");
  }
  return value as Record<string, unknown>;
}
