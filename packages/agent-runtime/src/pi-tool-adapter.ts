import {
  type AgentTool,
  type BeforeToolCallContext,
  type BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import {
  isAgentAttachment,
  type ApprovalDecision,
  type RunStopReason,
  type ToolRisk,
} from "@opendesign/agent-contracts";
import { TrustedToolExecutionError } from "./index.js";
import type {
  AgentRunRequest,
  AgentToolCallRecord,
  AgentToolDefinition,
  ModelToolSurface,
  ApprovalPort,
  ApprovalRequest,
  ToolExecutorPort,
  TrustedToolFailure,
  TrustedToolResult,
} from "./index.js";
import { PiDesignFailureRecovery } from "./pi-design-failure-recovery.js";
import { PiToolProgressCircuit } from "./pi-tool-progress-circuit.js";
import {
  createTrustedToolContext,
  projectToolResultForModel,
  toolResultAttachments,
  validateDesignRevision,
  validateObservedRevision,
} from "./tool-execution-semantics.js";
import { selectSafeDefinitions } from "./tool-definition-safety.js";
import {
  disclosedToolDefinitions,
  resolveModelToolDisclosurePhase,
} from "./tool-disclosure.js";

const TOOL_RESULT_KIND = "opendesign.tool-result";
const TOOL_PROGRESS_KIND = "opendesign.tool-progress";

export interface PiToolApprovalRequested {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  risk: ToolRisk;
}
export interface PiToolApprovalResolved {
  approvalId: string;
  toolCallId: string;
  decision: ApprovalDecision;
  resolvedAt: string;
}
export interface PiToolLifecyclePort {
  approvalRequested(event: PiToolApprovalRequested): Promise<void>;
  approvalResolved(event: PiToolApprovalResolved): Promise<void>;
}
export interface OpenDesignPiToolAdapterOptions {
  request: AgentRunRequest;
  definitions: readonly AgentToolDefinition[];
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  lifecycle: PiToolLifecyclePort;
  maxToolCalls: number;
  priorToolCallIds?: readonly string[];
  initialInspection?: boolean;
  initialModelToolSurface?: ModelToolSurface;
  now?: () => Date;
}
export interface PiToolStartProjection {
  duplicate: boolean;
  input: unknown;
  risk: ToolRisk;
  toolCallId: string;
  toolName: string;
}
export interface PiToolProgressProjection {
  message: string;
  progress: number;
  toolCallId: string;
}
export type PiToolTerminalProjection =
  | {
      status: "completed";
      toolCallId: string;
      content: unknown;
      previousRevision: number;
      observedRevision?: number;
      designRevision?: NonNullable<TrustedToolResult["designRevision"]>;
    }
  | {
      status: "failed";
      toolCallId: string;
      code: string;
      message: string;
      retryable: boolean;
      recoverable: boolean;
      details?: NonNullable<TrustedToolFailure["details"]>;
    };
interface ActiveToolCall extends PiToolStartProjection {
  budgetExceeded: boolean;
  revisionAtStart: number;
  sequence: number;
}
interface PiToolSuccessDetails {
  kind: typeof TOOL_RESULT_KIND;
  version: 1;
  content: unknown;
  attachments: ReturnType<typeof toolResultAttachments>;
  observedRevision?: number;
  designRevision?: NonNullable<TrustedToolResult["designRevision"]>;
}
interface PiToolProgressDetails {
  kind: typeof TOOL_PROGRESS_KIND;
  version: 1;
  message: string;
  progress: number;
}

export class OpenDesignPiToolAdapter {
  readonly #active = new Map<string, ActiveToolCall>();
  readonly #approvalPort: ApprovalPort | undefined;
  readonly #bootstrapTools: AgentTool[];
  readonly #definitions = new Map<string, AgentToolDefinition>();
  readonly #designFailureRecovery = new PiDesignFailureRecovery();
  readonly #progressCircuit = new PiToolProgressCircuit();
  readonly #failures = new Map<string, TrustedToolFailure>();
  readonly #expandedTools: AgentTool[];
  readonly #hostInspectedTools: AgentTool[];
  readonly #lifecycle: PiToolLifecyclePort;
  readonly #inspectedTools: AgentTool[];
  readonly #initialInspection: boolean;
  readonly #initialModelToolSurface: ModelToolSurface;
  readonly #maxToolCalls: number;
  readonly #now: () => Date;
  readonly #records: AgentToolCallRecord[] = [];
  readonly #runApprovals = new Set<string>();
  readonly #request: AgentRunRequest;
  readonly #safeDefinitions: readonly AgentToolDefinition[];
  readonly #seen = new Set<string>();
  readonly #toolExecutor: ToolExecutorPort | undefined;
  readonly tools: AgentTool[];
  #currentRevision: number;
  #forcedError: TrustedToolFailure | undefined;
  #forcedStopReason: RunStopReason | undefined;
  #toolCallCount = 0;
  #toolSequence = 0;

  constructor(options: OpenDesignPiToolAdapterOptions) {
    if (!Number.isInteger(options.maxToolCalls) || options.maxToolCalls < 0) {
      throw new RangeError("Pi tool-call limit must be a non-negative integer");
    }
    this.#request = structuredClone(options.request);
    this.#currentRevision = options.request.revision;
    this.#toolExecutor = options.toolExecutor;
    this.#approvalPort = options.approvalPort;
    this.#lifecycle = options.lifecycle;
    this.#maxToolCalls = options.maxToolCalls;
    this.#initialInspection = options.initialInspection ?? false;
    this.#initialModelToolSurface =
      options.initialModelToolSurface ?? "general";
    this.#now = options.now ?? (() => new Date());
    for (const toolCallId of options.priorToolCallIds ?? []) {
      if (typeof toolCallId !== "string" || toolCallId.length === 0) {
        throw new TypeError("Prior Pi tool-call IDs must be non-empty strings");
      }
      this.#seen.add(toolCallId);
    }

    const safeDefinitions = selectSafeDefinitions(options.definitions);
    this.#safeDefinitions = safeDefinitions;
    for (const definition of safeDefinitions) {
      this.#definitions.set(definition.name, definition);
    }
    this.tools = safeDefinitions.map((definition) =>
      this.#createTool(definition),
    );
    this.#expandedTools = disclosedToolDefinitions(
      safeDefinitions,
      "expanded",
      { surface: "general" },
    ).map((modelDefinition) => {
      const executionDefinition = this.#definitions.get(modelDefinition.name);
      if (executionDefinition === undefined) {
        throw new Error(
          `Expanded tool ${modelDefinition.name} is missing its trusted definition`,
        );
      }
      return this.#createTool(executionDefinition, modelDefinition);
    });
    this.#bootstrapTools = disclosedToolDefinitions(
      safeDefinitions,
      "bootstrap",
      { surface: this.#initialModelToolSurface },
    ).map((modelDefinition) => {
      const executionDefinition = this.#definitions.get(modelDefinition.name);
      if (executionDefinition === undefined) {
        throw new Error(
          `Bootstrap tool ${modelDefinition.name} is missing its trusted definition`,
        );
      }
      return this.#createTool(executionDefinition, modelDefinition);
    });
    this.#hostInspectedTools = disclosedToolDefinitions(
      safeDefinitions,
      "host-inspected",
      { surface: this.#initialModelToolSurface },
    ).map((modelDefinition) => {
      const executionDefinition = this.#definitions.get(modelDefinition.name);
      if (executionDefinition === undefined) {
        throw new Error(
          `Host-inspected tool ${modelDefinition.name} is missing its trusted definition`,
        );
      }
      return this.#createTool(executionDefinition, modelDefinition);
    });
    this.#inspectedTools = disclosedToolDefinitions(
      safeDefinitions,
      "inspected",
      { surface: this.#initialModelToolSurface },
    ).map((modelDefinition) => {
      const executionDefinition = this.#definitions.get(modelDefinition.name);
      if (executionDefinition === undefined) {
        throw new Error(
          `Inspected tool ${modelDefinition.name} is missing its trusted definition`,
        );
      }
      return this.#createTool(executionDefinition, modelDefinition);
    });
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
    const phase = resolveModelToolDisclosurePhase(
      this.#safeDefinitions,
      this.#records,
      { initialInspection: this.#initialInspection },
    );
    if (phase === "bootstrap") return this.#bootstrapTools;
    if (phase === "host-inspected") return this.#hostInspectedTools;
    if (phase === "inspected") return this.#inspectedTools;
    return this.#expandedTools;
  }

  get unresolvedDesignWriteFailure() {
    return this.#designFailureRecovery.unresolvedFailure;
  }

  get hasPendingTools(): boolean {
    return this.#active.size > 0;
  }

  beginToolCall(event: {
    toolCallId: string;
    toolName: string;
    args: unknown;
  }): PiToolStartProjection {
    if (this.#active.has(event.toolCallId)) {
      throw new Error(`Pi started an already active tool: ${event.toolCallId}`);
    }
    const duplicate = this.#seen.has(event.toolCallId);
    const definition = this.#definitions.get(event.toolName);
    const budgetExceeded =
      !duplicate && this.#toolCallCount >= this.#maxToolCalls;
    if (!duplicate) {
      this.#seen.add(event.toolCallId);
      if (!budgetExceeded) this.#toolCallCount += 1;
    }
    const projection: ActiveToolCall = {
      duplicate,
      budgetExceeded,
      revisionAtStart: this.#currentRevision,
      sequence: ++this.#toolSequence,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: event.args,
      risk: definition?.risk ?? "design_write",
    };
    this.#active.set(event.toolCallId, projection);
    return projection;
  }

  updateToolCall(event: {
    toolCallId: string;
    partialResult: unknown;
  }): PiToolProgressProjection | undefined {
    const active = this.#requireActive(event.toolCallId);
    if (active.duplicate) return undefined;
    const details = readProgressDetails(event.partialResult);
    return {
      toolCallId: event.toolCallId,
      message: details.message,
      progress: details.progress,
    };
  }

  endToolCall(event: {
    toolCallId: string;
    toolName: string;
    result: unknown;
    isError: boolean;
  }): PiToolTerminalProjection | undefined {
    const active = this.#requireActive(event.toolCallId);
    if (active.toolName !== event.toolName) {
      throw new Error(
        `Pi changed tool name for ${event.toolCallId}: ${active.toolName} -> ${event.toolName}`,
      );
    }
    if (active.duplicate) return undefined;
    if (event.isError) {
      const definition = this.#definitions.get(active.toolName);
      const failure =
        this.#failures.get(event.toolCallId) ??
        this.#recordProgressFailure(
          active.toolName,
          definition &&
            definition.explainInvalidInput &&
            !definition.validateInput(active.input)
            ? invalidInputFailure(definition, active.input)
            : inferPiToolFailure(active, event.result),
        );
      return {
        status: "failed",
        toolCallId: event.toolCallId,
        ...failure,
      };
    }
    const details = readSuccessDetails(event.result);
    const revision = validateDesignRevision(
      details.designRevision,
      active.revisionAtStart,
    );
    const observedRevision = validateObservedRevision(
      details.observedRevision,
      active.revisionAtStart,
    );
    if (
      revision !== undefined &&
      observedRevision !== undefined &&
      observedRevision !== revision.revision
    ) {
      throw new Error("Pi tool result contains inconsistent revisions");
    }
    return {
      status: "completed",
      toolCallId: event.toolCallId,
      content: details.content,
      previousRevision: active.revisionAtStart,
      ...(observedRevision === undefined ? {} : { observedRevision }),
      ...(revision === undefined ? {} : { designRevision: revision }),
    };
  }

  acknowledgeToolCall(toolCallId: string): void {
    this.#requireActive(toolCallId);
    this.#active.delete(toolCallId);
    this.#failures.delete(toolCallId);
  }

  finalizePendingTools(
    stopReason: RunStopReason,
  ): Array<Extract<PiToolTerminalProjection, { status: "failed" }>> {
    const code = stopReason === "cancelled" ? "run_cancelled" : "run_error";
    const message =
      stopReason === "cancelled"
        ? "Tool call was cancelled before completion"
        : "Tool call did not complete because the run ended";
    const failures = [...this.#active.values()]
      .sort((left, right) => left.sequence - right.sequence)
      .flatMap((active) =>
        active.duplicate
          ? []
          : [
              {
                status: "failed" as const,
                toolCallId: active.toolCallId,
                code,
                message,
                retryable: false,
                recoverable: false,
              },
            ],
      );
    this.#active.clear();
    this.#failures.clear();
    return failures;
  }

  readonly beforeToolCall = async (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> => {
    const active = this.#requireActive(context.toolCall.id);
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
    const definition = this.#definitions.get(active.toolName);
    if (definition === undefined) {
      return this.#block(
        active.toolCallId,
        "unknown_tool",
        `Tool ${active.toolName} is not registered for this run`,
      );
    }
    if (!definition.validateInput(context.args)) {
      const schemaFailure = this.#recordProgressFailure(
        active.toolName,
        invalidInputFailure(definition, context.args),
      );
      this.#failures.set(active.toolCallId, schemaFailure);
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
      this.#failures.set(active.toolCallId, failure);
      return {
        block: true,
        reason: modelFailureText(failure),
        ...(failure.runTerminal ? { terminate: true } : {}),
      };
    }
    const blockedFailure = this.#designFailureRecovery.blockedFailure(
      active.toolName,
      context.args,
    );
    if (blockedFailure) {
      const failure = this.#recordProgressFailure(active.toolName, {
        ...blockedFailure,
        code: "repeated_tool_failure",
        message:
          "The same failing tool input was suppressed. Inspect the current document and revise the transaction before retrying.",
        retryable: false,
        recoverable: true,
        ...(blockedFailure.details
          ? {
              details: {
                ...blockedFailure.details,
                retrySuppressed: true,
              },
            }
          : {}),
      });
      this.#failures.set(active.toolCallId, failure);
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

    const approvalId = `${active.toolCallId}_approval`;
    const approval = {
      approvalId,
      toolCallId: active.toolCallId,
      toolName: active.toolName,
      title: definition.approvalPrompt?.title ?? `Allow ${active.toolName}`,
      summary:
        definition.approvalPrompt?.summary ??
        `Allow this ${definition.risk} tool for the current run scope.`,
      risk: definition.risk,
    } satisfies ApprovalRequest;
    await this.#lifecycle.approvalRequested(approval);
    if (this.#approvalPort === undefined) {
      return this.#block(
        active.toolCallId,
        "approval_unavailable",
        "Tool requires host approval",
      );
    }
    const decision = await this.#approvalPort.requestApproval(
      approval,
      createTrustedToolContext(this.#request, this.#currentRevision),
      signal ?? new AbortController().signal,
    );
    const resolvedAt = this.#now().toISOString();
    await this.#lifecycle.approvalResolved({
      approvalId,
      toolCallId: active.toolCallId,
      decision,
      resolvedAt,
    });
    if (signal?.aborted) {
      this.#forcedStopReason = "cancelled";
      return this.#block(
        active.toolCallId,
        "run_cancelled",
        "Tool call was cancelled before execution",
        true,
      );
    }
    if (decision === "deny") {
      return this.#block(
        active.toolCallId,
        "approval_denied",
        "Host denied this tool call",
      );
    }
    if (definition.approvalScope === "run") {
      this.#runApprovals.add(definition.name);
    }
    return undefined;
  };

  #createTool(
    definition: AgentToolDefinition,
    modelDefinition: AgentToolDefinition = definition,
  ): AgentTool {
    return {
      name: modelDefinition.name,
      label: modelDefinition.name,
      description: modelDefinition.description,
      parameters: modelDefinition.inputSchema,
      executionMode: "sequential",
      execute: (toolCallId, parameters, signal, onUpdate) =>
        this.#executeTool(
          definition,
          toolCallId,
          parameters,
          signal ?? new AbortController().signal,
          onUpdate,
        ),
    };
  }

  async #executeTool(
    definition: AgentToolDefinition,
    toolCallId: string,
    parameters: unknown,
    signal: AbortSignal,
    onUpdate: Parameters<AgentTool["execute"]>[3],
  ) {
    try {
      if (!definition.validateInput(parameters)) {
        throw new TrustedToolExecutionError(
          invalidInputFailure(definition, parameters),
        );
      }
      if (this.#toolExecutor === undefined) {
        throw new Error("Tool executor became unavailable");
      }
      let completedResult: TrustedToolResult | undefined;
      for await (const event of this.#toolExecutor.execute(
        {
          toolCallId,
          toolName: definition.name,
          input: parameters,
        },
        createTrustedToolContext(this.#request, this.#currentRevision),
        signal,
      )) {
        if (signal.aborted) {
          throw signal.reason instanceof Error
            ? signal.reason
            : new DOMException("Tool execution cancelled", "AbortError");
        }
        if (event.type === "progress") {
          const progress = Math.min(1, Math.max(0, event.progress));
          onUpdate?.({
            content: [{ type: "text", text: event.message }],
            details: {
              kind: TOOL_PROGRESS_KIND,
              version: 1,
              message: event.message,
              progress,
            } satisfies PiToolProgressDetails,
          });
          continue;
        }
        if (event.type === "failed") {
          throw new TrustedToolExecutionError(event.error);
        }
        if (completedResult !== undefined) {
          throw new Error("Tool executor completed more than once");
        }
        completedResult = event.result;
      }
      if (completedResult === undefined) {
        throw new Error("Tool executor did not return a completed result");
      }

      const revision = validateDesignRevision(
        completedResult.designRevision,
        this.#currentRevision,
      );
      const observedRevision = validateObservedRevision(
        completedResult.observedRevision,
        this.#currentRevision,
      );
      if (
        revision !== undefined &&
        observedRevision !== undefined &&
        observedRevision !== revision.revision
      ) {
        throw new RangeError(
          "Tool returned inconsistent observed and design revisions",
        );
      }
      const nextRevision = revision?.revision ?? observedRevision;
      if (nextRevision !== undefined) this.#currentRevision = nextRevision;
      this.#progressCircuit.recordSuccess(
        definition.name,
        revision !== undefined,
      );
      if (definition.name === "opendesign_inspect_document") {
        this.#designFailureRecovery.recordInspection();
      } else if (definition.risk === "design_write" && revision !== undefined) {
        this.#designFailureRecovery.recordRevisionWrite();
      }
      this.#records.push({
        toolCallId,
        toolName: definition.name,
        input: parameters,
        status: "completed",
        result: completedResult.content,
        ...(nextRevision === undefined ? {} : { revision: nextRevision }),
      });

      const projected = projectToolResultForModel(completedResult.content);
      const details = {
        kind: TOOL_RESULT_KIND,
        version: 1,
        content: completedResult.content,
        attachments: toolResultAttachments(completedResult.content),
        ...(observedRevision === undefined ? {} : { observedRevision }),
        ...(revision === undefined ? {} : { designRevision: revision }),
      } satisfies PiToolSuccessDetails;
      return {
        content: [{ type: "text" as const, text: modelResultText(projected) }],
        details,
      };
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
      this.#failures.set(toolCallId, failure);
      throw new Error(modelFailureText(failure));
    }
  }

  #block(
    toolCallId: string,
    code: string,
    message: string,
    terminate = false,
  ): BeforeToolCallResult {
    this.#failures.set(toolCallId, {
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

  #requireActive(toolCallId: string): ActiveToolCall {
    const active = this.#active.get(toolCallId);
    if (active === undefined) {
      throw new Error(`Pi referenced an inactive tool call: ${toolCallId}`);
    }
    return active;
  }
}

function readProgressDetails(value: unknown): PiToolProgressDetails {
  const details = readResultDetails(value);
  if (
    details.kind !== TOOL_PROGRESS_KIND ||
    details.version !== 1 ||
    typeof details.message !== "string" ||
    details.message.length > 20_000 ||
    typeof details.progress !== "number" ||
    !Number.isFinite(details.progress) ||
    details.progress < 0 ||
    details.progress > 1
  ) {
    throw new Error("Pi tool update has invalid OpenDesign progress details");
  }
  return details as unknown as PiToolProgressDetails;
}

function readSuccessDetails(value: unknown): PiToolSuccessDetails {
  const details = readResultDetails(value);
  if (
    details.kind !== TOOL_RESULT_KIND ||
    details.version !== 1 ||
    !Array.isArray(details.attachments) ||
    !details.attachments.every(isAgentAttachment)
  ) {
    throw new Error("Pi tool result has invalid OpenDesign completion details");
  }
  return details as unknown as PiToolSuccessDetails;
}

function readResultDetails(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Pi tool result is not an object");
  }
  const details = (value as { details?: unknown }).details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    throw new Error("Pi tool result does not contain structured details");
  }
  return details as Record<string, unknown>;
}

function inferPiToolFailure(
  active: ActiveToolCall,
  result: unknown,
): TrustedToolFailure {
  const message = toolResultErrorText(result);
  if (active.budgetExceeded) {
    return failure("tool_budget_exceeded", message, false);
  }
  if (!active.toolName.startsWith("opendesign_")) {
    return failure("unknown_tool", message, false);
  }
  if (message.includes("not found")) {
    return failure("unknown_tool", message, false);
  }
  if (message.includes("output token limit")) {
    return failure("truncated_tool_call", message, true);
  }
  if (message.toLowerCase().includes("abort")) {
    return failure("run_cancelled", message, false);
  }
  return failure("invalid_tool_input", message, true);
}

function failure(
  code: string,
  message: string,
  recoverable: boolean,
): TrustedToolFailure {
  return { code, message, retryable: false, recoverable };
}

function invalidInputFailure(
  definition: AgentToolDefinition,
  input: unknown,
): TrustedToolFailure {
  const explanation = definition.explainInvalidInput?.(input)?.trim();
  return failure(
    "invalid_tool_input",
    explanation && explanation.length <= 20_000
      ? explanation
      : `The ${definition.name} arguments do not match its schema. Review the tool parameters and submit a corrected call.`,
    true,
  );
}

function toolResultErrorText(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Tool call failed";
  }
  const content = (value as { content?: unknown }).content;
  if (!Array.isArray(content)) return "Tool call failed";
  const text = content
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block))
        return [];
      const candidate = block as { type?: unknown; text?: unknown };
      return candidate.type === "text" && typeof candidate.text === "string"
        ? [candidate.text]
        : [];
    })
    .join("\n");
  return text.length > 0 ? text : "Tool call failed";
}

function modelResultText(value: unknown): string {
  return typeof value === "string" ? value : (JSON.stringify(value) ?? "null");
}

function modelFailureText(failure: TrustedToolFailure): string {
  return JSON.stringify({ ok: false, error: failure });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Tool execution failed";
}
