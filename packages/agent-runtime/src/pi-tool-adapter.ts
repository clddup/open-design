import {
  type AgentTool,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import { isDeepStrictEqual } from "node:util";
import {
  type RunStopReason,
  type TrustedToolFailure,
} from "@opendesign/agent-contracts";
import type { AgentToolCallRecord } from "./completion-guard.js";
import type { AgentRunRequest } from "./run-request.js";
import {
  TrustedToolExecutionError,
  type AgentToolDefinition,
  type ApprovalPort,
  type ToolExecutorPort,
} from "./runtime-ports.js";
import type { OpenDesignPiToolAdapterOptions } from "./pi-tool-adapter-options.js";
import { PiDesignFailureRecovery } from "./pi-design-failure-recovery.js";
import {
  PiToolCallTracker,
  type ActiveToolCall,
  type PiToolProgressProjection,
  type PiToolStartProjection,
  type PiToolTerminalProjection,
} from "./pi-tool-call-tracker.js";
import {
  requestPiToolApproval,
  type PiToolLifecyclePort,
} from "./pi-tool-approval.js";
import {
  createPiAgentTool,
  executeTrustedPiTool,
} from "./pi-tool-execution.js";
import {
  errorMessage,
  inferPiToolFailure,
  modelFailureText,
  toolValidationFailure,
} from "./pi-tool-protocol.js";
import { PiToolProgressCircuit } from "./pi-tool-progress-circuit.js";
import {
  projectPiToolSuccess,
  projectPiToolTerminalSuccess,
} from "./pi-tool-success.js";
import { PiToolSurfaceCatalog } from "./pi-tool-surface-catalog.js";
import { createTrustedToolContext } from "./tool-execution-semantics.js";
export type {
  PiToolApprovalRequested,
  PiToolApprovalResolved,
  PiToolLifecyclePort,
} from "./pi-tool-approval.js";
export type {
  PiToolProgressProjection,
  PiToolStartProjection,
  PiToolTerminalProjection,
} from "./pi-tool-call-tracker.js";
export type { OpenDesignPiToolAdapterOptions } from "./pi-tool-adapter-options.js";

export class OpenDesignPiToolAdapter {
  readonly #approvalPort: ApprovalPort | undefined;
  readonly #catalog: PiToolSurfaceCatalog;
  readonly #designFailureRecovery = new PiDesignFailureRecovery();
  readonly #progressCircuit = new PiToolProgressCircuit();
  readonly #lifecycle: PiToolLifecyclePort;
  readonly #now: () => Date;
  readonly #records: AgentToolCallRecord[] = [];
  readonly #runApprovals = new Set<string>();
  readonly #request: AgentRunRequest;
  readonly #tracker: PiToolCallTracker;
  readonly #toolExecutor: ToolExecutorPort | undefined;
  readonly tools: AgentTool[];
  #currentRevision: number;
  #forcedError: TrustedToolFailure | undefined;
  #forcedStopReason: RunStopReason | undefined;

  constructor(options: OpenDesignPiToolAdapterOptions) {
    this.#request = structuredClone(options.request);
    this.#currentRevision = options.request.revision;
    this.#toolExecutor = options.toolExecutor;
    this.#approvalPort = options.approvalPort;
    this.#lifecycle = options.lifecycle;
    this.#now = options.now ?? (() => new Date());
    this.#tracker = new PiToolCallTracker(options.maxToolCalls);

    this.#catalog = new PiToolSurfaceCatalog(
      options.definitions,
      (execution, model = execution) =>
        createPiAgentTool(model, (toolCallId, parameters, signal, onUpdate) =>
          this.#executeTool(
            execution,
            toolCallId,
            parameters,
            signal ?? new AbortController().signal,
            onUpdate,
          ),
        ),
      {
        initialInspection: options.initialInspection ?? false,
        initialSurface: options.initialModelToolSurface ?? "general",
      },
    );
    this.tools = this.#catalog.executionTools;
  }

  get currentRevision(): number {
    return this.#currentRevision;
  }

  get forcedStopReason(): RunStopReason | undefined {
    return this.#forcedStopReason;
  }

  get forcedError(): TrustedToolFailure | undefined {
    return this.#forcedError;
  }

  get toolCallRecords(): readonly AgentToolCallRecord[] {
    return this.#records;
  }

  get modelTools(): readonly AgentTool[] {
    return this.#catalog.modelTools(
      this.#records,
      this.#request.deliveryScopeReview,
    );
  }

  get unresolvedDesignWriteFailure() {
    return this.#designFailureRecovery.unresolvedFailure;
  }

  get hasPendingTools(): boolean {
    return this.#tracker.hasPending;
  }

  beginToolCall(event: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }): PiToolStartProjection {
    const definition = this.#catalog.definition(event.toolName);
    return this.#tracker.begin(
      event,
      this.#currentRevision,
      definition?.risk ?? "design_write",
    );
  }

  updateToolCall(event: {
    toolCallId: string;
    partialResult: unknown;
  }): PiToolProgressProjection | undefined {
    return this.#tracker.update(event.toolCallId, event.partialResult);
  }

  endToolCall(event: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }): PiToolTerminalProjection | undefined {
    const active = this.#tracker.require(event.toolCallId);
    if (active.toolName !== event.toolName) {
      throw new Error(
        `Pi changed tool name for ${event.toolCallId}: ${active.toolName} -> ${event.toolName}`,
      );
    }
    if (active.duplicate) return undefined;
    if (event.isError) {
      const definition = this.#catalog.definition(active.toolName);
      const existingFailure = this.#tracker.failure(event.toolCallId);
      const inferredFailure =
        existingFailure ??
        (definition && this.#validateActiveInput(active, definition)) ??
        inferPiToolFailure(active, event.result);
      const failure =
        existingFailure ??
        this.#recordProgressFailure(
          active.toolName,
          this.#designFailureRecovery.recordFailure({
            toolCallId: active.toolCallId,
            toolName: active.toolName,
            input: active.input,
            failure: inferredFailure,
            designWrite: active.risk === "design_write",
          }),
        );
      return {
        status: "failed",
        toolCallId: event.toolCallId,
        ...failure,
      };
    }
    return projectPiToolTerminalSuccess(active, event.toolCallId, event.result);
  }

  acknowledgeToolCall(toolCallId: string): void {
    this.#tracker.acknowledge(toolCallId);
  }

  finalizePendingTools(
    stopReason: RunStopReason,
  ): Array<Extract<PiToolTerminalProjection, { status: "failed" }>> {
    return this.#tracker.finalize(stopReason);
  }

  readonly beforeToolCall = async (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const active = this.#tracker.require(context.toolCall.id);
    if (active.duplicate) {
      return this.#block(
        active.toolCallId,
        "duplicate_tool_call",
        "Tool call was not executed",
      );
    }
    if (active.budgetExceeded) {
      this.#forcedStopReason = "budget";
      return this.#block(
        active.toolCallId,
        "tool_budget_exceeded",
        "Tool call was not executed because the run budget was exhausted",
        true,
      );
    }
    const definition = this.#catalog.definition(active.toolName);
    if (definition === undefined) {
      return this.#block(
        active.toolCallId,
        "unknown_tool",
        `Tool ${active.toolName} is not registered for this run`,
      );
    }
    const validationFailure = this.#validateActiveInput(active, definition);
    if (validationFailure) {
      const baseFailure = validationFailure;
      const recoveredFailure = this.#designFailureRecovery.recordFailure({
        toolCallId: active.toolCallId,
        toolName: active.toolName,
        input: context.args,
        failure: baseFailure,
        designWrite: definition.risk === "design_write",
      });
      const schemaFailure = this.#recordProgressFailure(
        active.toolName,
        recoveredFailure,
      );
      this.#tracker.setFailure(active.toolCallId, schemaFailure);
      return {
        block: true,
        reason: modelFailureText(schemaFailure),
        ...(schemaFailure.runTerminal ? { terminate: true } : {}),
      };
    }
    if (
      this.#designFailureRecovery.inspectionRequiredFailure &&
      definition.risk === "design_write" &&
      active.toolName !== "opendesign_inspect_document"
    ) {
      const prior = this.#designFailureRecovery.inspectionRequiredFailure;
      const failure = this.#recordProgressFailure(active.toolName, {
        ...prior,
        code: "design_inspection_required",
        message:
          "Inspect the current document before submitting another design write after an invariant failure.",
        retryable: false,
        recoverable: true,
        ...(prior.details
          ? {
              details: { ...prior.details, retrySuppressed: true },
            }
          : {}),
      });
      this.#tracker.setFailure(active.toolCallId, failure);
      return {
        block: true,
        reason: modelFailureText(failure),
        ...(failure.runTerminal ? { terminate: true } : {}),
      };
    }
    if (this.#toolExecutor === undefined) {
      return this.#block(
        active.toolCallId,
        "tool_executor_unavailable",
        `The trusted executor for ${active.toolName} is unavailable`,
      );
    }
    if (signal?.aborted) {
      this.#forcedStopReason = "cancelled";
      return this.#block(
        active.toolCallId,
        "run_cancelled",
        "Tool call was cancelled before execution",
        true,
      );
    }
    if (definition.approval !== "required") return undefined;
    if (
      definition.approvalScope === "run" &&
      this.#runApprovals.has(definition.name)
    ) {
      return undefined;
    }

    const approval = await requestPiToolApproval({
      ...(this.#approvalPort ? { approvalPort: this.#approvalPort } : {}),
      currentRevision: this.#currentRevision,
      definition,
      input: context.args,
      lifecycle: this.#lifecycle,
      now: this.#now,
      request: this.#request,
      signal: signal ?? new AbortController().signal,
      toolCallId: active.toolCallId,
    });
    if (!approval.allowed) {
      if (approval.stopReason) this.#forcedStopReason = approval.stopReason;
      return this.#block(
        active.toolCallId,
        approval.code,
        approval.message,
        approval.terminate,
      );
    }
    if (approval.approveForRun) {
      this.#runApprovals.add(definition.name);
    }
    return undefined;
  };

  async #executeTool(
    definition: AgentToolDefinition,
    toolCallId: string,
    parameters: unknown,
    signal: AbortSignal,
    onUpdate: Parameters<AgentTool["execute"]>[3],
  ) {
    try {
      const active = this.#tracker.get(toolCallId);
      const validationFailure = active
        ? this.#activeExecutionInputFailure(active, definition, parameters)
        : toolValidationFailure(definition, parameters);
      if (validationFailure) {
        throw new TrustedToolExecutionError(validationFailure);
      }
      const input = active?.input ?? parameters;
      const completedResult = await executeTrustedPiTool({
        context: createTrustedToolContext(this.#request, this.#currentRevision),
        definition,
        onUpdate,
        parameters: input,
        signal,
        toolCallId,
        ...(this.#toolExecutor ? { toolExecutor: this.#toolExecutor } : {}),
      });

      const success = projectPiToolSuccess({
        currentRevision: this.#currentRevision,
        definition,
        input,
        result: completedResult,
        toolCallId,
      });
      if (success.nextRevision !== undefined) {
        this.#currentRevision = success.nextRevision;
      }
      this.#progressCircuit.recordSuccess(
        definition.name,
        success.revisionAdvanced,
      );
      if (definition.name === "opendesign_inspect_document") {
        this.#designFailureRecovery.recordInspection();
      } else if (
        definition.risk === "design_write" &&
        success.revisionAdvanced
      ) {
        this.#designFailureRecovery.recordRevisionWrite();
      }
      this.#records.push(success.record);
      return success.modelResult;
    } catch (error) {
      if (signal.aborted) this.#forcedStopReason = "cancelled";
      const baseFailure: TrustedToolFailure = signal.aborted
        ? {
            code: "run_cancelled",
            message: errorMessage(error),
            retryable: false,
            recoverable: false,
          }
        : error instanceof TrustedToolExecutionError
          ? error.failure
          : {
              code:
                error instanceof RangeError ? "invalid_revision" : "tool_error",
              message: errorMessage(error),
              retryable: false,
              recoverable: true,
            };
      const recoveredFailure = this.#designFailureRecovery.recordFailure({
        toolCallId,
        toolName: definition.name,
        input: parameters,
        failure: baseFailure,
        designWrite: definition.risk === "design_write",
      });
      const failure = this.#recordProgressFailure(
        definition.name,
        recoveredFailure,
      );
      if (failure.runTerminal) {
        this.#forcedStopReason = "error";
        this.#forcedError = failure;
      }
      this.#tracker.setFailure(toolCallId, failure);
      throw new Error(modelFailureText(failure));
    }
  }

  #validateActiveInput(
    active: ActiveToolCall,
    definition: AgentToolDefinition,
  ): TrustedToolFailure | undefined {
    if (active.inputValidated) return undefined;
    const validationFailure = toolValidationFailure(definition, active.input);
    if (validationFailure === undefined) active.inputValidated = true;
    return validationFailure;
  }

  #activeExecutionInputFailure(
    active: ActiveToolCall,
    definition: AgentToolDefinition,
    parameters: unknown,
  ): TrustedToolFailure | undefined {
    if (!isDeepStrictEqual(active.input, parameters)) {
      return {
        code: "tool_call_input_changed",
        message: `Tool ${active.toolName} parameters changed after tool_execution_start`,
        retryable: false,
        recoverable: false,
        runTerminal: true,
      };
    }
    return this.#validateActiveInput(active, definition);
  }

  #block(
    toolCallId: string,
    code: string,
    message: string,
    terminate = false,
  ): BeforeToolCallResult {
    this.#tracker.setFailure(toolCallId, {
      code,
      message,
      retryable: false,
      recoverable: false,
    });
    return {
      block: true,
      reason: message,
      ...(terminate ? { terminate } : {}),
    };
  }

  #recordProgressFailure(
    toolName: string,
    failure: TrustedToolFailure,
  ): TrustedToolFailure {
    const bounded = this.#progressCircuit.recordFailure(toolName, failure);
    if (bounded.runTerminal) {
      this.#forcedStopReason = "error";
      this.#forcedError = bounded;
    }
    return bounded;
  }
}
