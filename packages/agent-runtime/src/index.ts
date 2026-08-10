import {
  isAgentAttachment,
  type AgentEvent,
  type AgentAttachment,
  type AgentModelContext,
  type ApprovalDecision,
  type AssistantTimelineBlock,
  type DesignMutationTarget,
  type RunStopReason,
  type SelectionScope,
  type SessionTimelineItem,
  type ToolRisk,
} from "@opendesign/agent-contracts";
import {
  ModelResponseAccumulator,
  type CanonicalContentBlock,
  type CanonicalMessage,
  type CanonicalTool,
  type ModelGateway,
  type ModelSelection,
  type ModelUsage,
  type ResolvedModelIdentity,
} from "@opendesign/model-gateway";
import type { JournalEvent, SessionStore } from "@opendesign/session-store";

export interface AgentRunRequest {
  runId: string;
  sessionId: string;
  prompt: string;
  attachments?: AgentAttachment[];
  documentId: string;
  revision: number;
  scope: SelectionScope;
  mutationTarget: DesignMutationTarget;
  modelSelection: ModelSelection;
  modelContext?: AgentModelContext;
}

export interface AgentToolDefinition extends CanonicalTool {
  risk: ToolRisk;
  approval: "never" | "required";
  validateInput(input: unknown): boolean;
}

export interface ToolCatalogPort {
  listTools():
    readonly AgentToolDefinition[] | Promise<readonly AgentToolDefinition[]>;
}

export interface ToolCallRequest {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface TrustedToolContext {
  runId: string;
  sessionId: string;
  documentId: string;
  revision: number;
  scope: SelectionScope;
  mutationTarget: DesignMutationTarget;
}

export type ToolExecutionEvent =
  | { type: "progress"; message: string; progress: number }
  | { type: "completed"; result: TrustedToolResult };

export interface TrustedToolResult {
  content: unknown;
  observedRevision?: number;
  designRevision?: {
    previousRevision: number;
    revision: number;
    transactionId: string;
  };
}

export interface ToolExecutorPort {
  execute(
    call: ToolCallRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): AsyncIterable<ToolExecutionEvent>;
}

export interface ApprovalRequest {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  risk: ToolRisk;
}

export interface ApprovalPort {
  requestApproval(
    request: ApprovalRequest,
    context: TrustedToolContext,
    signal: AbortSignal,
  ): Promise<ApprovalDecision>;
}

export interface AgentRuntimeLimits {
  maxTurns: number;
  maxToolCalls: number;
  maxTotalTokens: number;
  maxCompletionGuardRejections: number;
  maxContextCharacters: number;
}

export interface AgentToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  status: "completed";
  revision?: number;
}

export interface AgentCompletionContext {
  request: Readonly<AgentRunRequest>;
  currentRevision: number;
  turn: number;
  rejectionCount: number;
  toolCalls: readonly AgentToolCallRecord[];
}

export type AgentCompletionDecision =
  { allow: true } | { allow: false; message: string };

export interface CompletionGuardPort {
  review(
    context: AgentCompletionContext,
  ): AgentCompletionDecision | Promise<AgentCompletionDecision>;
}

export interface AgentRuntimeOptions {
  modelGateway: ModelGateway;
  sessionStore: SessionStore;
  toolCatalog?: ToolCatalogPort;
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  completionGuard?: CompletionGuardPort;
  limits?: Partial<AgentRuntimeLimits>;
  systemPrompt?: string;
  now?: () => Date;
}

const DEFAULT_LIMITS: AgentRuntimeLimits = {
  maxTurns: 8,
  maxToolCalls: 32,
  maxTotalTokens: 200_000,
  maxCompletionGuardRejections: 3,
  maxContextCharacters: 240_000,
};

const MAX_MODEL_TOOL_RESULT_STRING_CHARACTERS = 16_000;
const MAX_MODEL_TOOL_RESULT_CHARACTERS = 50_000;
const MAX_MODEL_TOOL_RESULT_EXCERPT_CHARACTERS = 32_000;

class ContextBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextBudgetError";
  }
}

class ModelContextCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelContextCompatibilityError";
  }
}

const EMPTY_TOOL_CATALOG: ToolCatalogPort = { listTools: () => [] };

export class AgentRuntime {
  readonly #activeRuns = new Map<string, AbortController>();
  readonly #now: () => Date;
  readonly #limits: AgentRuntimeLimits;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.#now = options.now ?? (() => new Date());
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    if (
      this.#limits.maxTurns < 1 ||
      this.#limits.maxToolCalls < 0 ||
      this.#limits.maxTotalTokens < 1 ||
      this.#limits.maxCompletionGuardRejections < 0 ||
      this.#limits.maxContextCharacters < 1
    ) {
      throw new RangeError("Agent runtime limits must be positive");
    }
  }

  async *run(input: AgentRunRequest): AsyncIterable<AgentEvent> {
    const request = snapshotRunRequest(input);
    if (this.#activeRuns.has(request.runId)) {
      throw new Error(`Run already active: ${request.runId}`);
    }

    const controller = new AbortController();
    this.#activeRuns.set(request.runId, controller);
    const pendingTools = new Map<string, number>();
    let releaseSession: (() => void) | undefined;
    let journalStarted = false;
    let startedAt = "";
    let stopReason: RunStopReason = "complete";

    try {
      releaseSession = await acquireSessionLock(
        this.options.sessionStore,
        request.sessionId,
      );
      let priorEvents = await this.options.sessionStore.read(request.sessionId);
      const tools = await this.loadSafeTools();
      const canonicalTools = tools.map(toCanonicalTool);
      const baseSystemPrompt =
        this.options.systemPrompt ??
        "You are the OpenDesign design agent. Use only the provided tools and respect the host-bound modification scope.";
      const currentUserMessage = canonicalUserMessage(
        request.prompt,
        request.attachments ?? [],
      );
      const contextBudget = createContextBudget(
        request.modelContext,
        baseSystemPrompt,
        canonicalTools,
        this.#limits.maxContextCharacters,
      );
      const compaction = contextBudget.fixedProtocolFits
        ? planContextCompaction(priorEvents, {
            currentMessage: currentUserMessage,
            budget: contextBudget,
            system: baseSystemPrompt,
            tools: canonicalTools,
          })
        : undefined;
      if (compaction) {
        await this.append(request, "context.compacted", compaction);
        priorEvents = await this.options.sessionStore.read(request.sessionId);
      }
      const messages = restoreModelMessages(priorEvents);
      const projectedMessages = [...messages, currentUserMessage];
      const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
      const executedToolCallIds = priorToolCalls(priorEvents);
      let currentRevision = request.revision;
      let toolCallCount = 0;
      let totalTokens = 0;
      let completionGuardFeedback: string | undefined;
      let completionGuardRejections = 0;
      const toolCallRecords: AgentToolCallRecord[] = [];

      startedAt = this.#now().toISOString();
      await this.append(
        request,
        "run.state",
        {
          status: "started",
          startedAt,
          modelSelection: request.modelSelection,
        },
        startedAt,
      );
      journalStarted = true;
      await this.append(request, "message.user", {
        messageId: `${request.runId}_user`,
        content: request.prompt,
        ...(request.attachments === undefined
          ? {}
          : { attachments: request.attachments }),
        documentId: request.documentId,
        revision: currentRevision,
        scope: request.scope,
        mutationTarget: request.mutationTarget,
      });
      messages.push(currentUserMessage);
      yield { type: "run.started", runId: request.runId, startedAt };
      if (!contextBudget.fixedProtocolFits) {
        throw new ModelContextCompatibilityError(
          modelContextCompatibilityMessage(contextBudget),
        );
      }
      if (
        !modelContextFits(
          projectedMessages,
          baseSystemPrompt,
          canonicalTools,
          contextBudget,
        )
      ) {
        throw new ContextBudgetError(
          contextBudgetExceededMessage(
            projectedMessages,
            contextBudget,
            "after local compaction",
          ),
        );
      }

      turnLoop: for (let turn = 1; turn <= this.#limits.maxTurns; turn += 1) {
        if (controller.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        const attemptId = `${request.runId}_attempt_${turn}`;
        const messageId = `${request.runId}_assistant_${turn}`;
        const accumulator = new ModelResponseAccumulator(attemptId);
        const blockKinds = new Map<string, CanonicalContentBlock["type"]>();
        const turnSystemPrompt = completionGuardFeedback
          ? `${baseSystemPrompt}\n\nTrusted host completion review for this turn:\n${completionGuardFeedback}`
          : baseSystemPrompt;
        if (
          !modelContextFits(
            messages,
            turnSystemPrompt,
            canonicalTools,
            contextBudget,
          )
        ) {
          const compacted = compactInRunMessagesForProvider(
            messages,
            currentUserMessage,
            turnSystemPrompt,
            canonicalTools,
            contextBudget,
          );
          if (compacted) {
            messages.splice(0, messages.length, ...compacted);
          } else {
            throw new ContextBudgetError(
              contextBudgetExceededMessage(
                messages,
                contextBudget,
                `before provider turn ${turn}`,
              ),
            );
          }
        }

        for await (const event of this.options.modelGateway.stream({
          attemptId,
          sessionId: request.sessionId,
          modelSelection: request.modelSelection,
          system: turnSystemPrompt,
          messages,
          tools: canonicalTools,
          signal: controller.signal,
        })) {
          accumulator.add(event);
          if (event.type === "block.started") {
            blockKinds.set(event.blockId, event.kind);
          }
          if (
            event.type === "block.delta" &&
            blockKinds.get(event.blockId) === "text"
          ) {
            yield {
              type: "message.delta",
              runId: request.runId,
              messageId,
              blockId: event.blockId,
              delta: event.delta,
            };
          }
        }

        if (controller.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        const response = accumulator.result();
        totalTokens += usageTokens(response.usage);
        const timelineBlocks = toTimelineBlocks(response.blocks);
        const assistantMessage: Extract<
          CanonicalMessage,
          { role: "assistant" }
        > = {
          role: "assistant",
          blocks: response.blocks,
          ...(response.identity === undefined
            ? {}
            : { source: response.identity }),
        };

        const toolCalls = response.blocks.filter(
          (
            block,
          ): block is Extract<CanonicalContentBlock, { type: "tool_call" }> =>
            block.type === "tool_call",
        );
        const canReviewCompletion =
          toolCalls.length === 0 &&
          response.stopReason !== "tool_use" &&
          response.stopReason !== "length" &&
          response.stopReason !== "cancelled" &&
          response.stopReason !== "content_filter" &&
          response.stopReason !== "error" &&
          totalTokens <= this.#limits.maxTotalTokens;
        if (canReviewCompletion && this.options.completionGuard) {
          const decision = await this.options.completionGuard.review({
            request,
            currentRevision,
            turn,
            rejectionCount: completionGuardRejections,
            toolCalls: [...toolCallRecords],
          });
          if (!decision.allow) {
            messages.push(assistantMessage);
            completionGuardRejections += 1;
            completionGuardFeedback = decision.message;
            // Streaming deltas may already have reached the renderer. Complete
            // that provisional message with no blocks so it disappears instead
            // of presenting an untrusted completion claim as the final result.
            yield {
              type: "message.completed",
              runId: request.runId,
              messageId,
              blocks: [],
            };
            if (
              completionGuardRejections >
                this.#limits.maxCompletionGuardRejections ||
              turn === this.#limits.maxTurns
            ) {
              stopReason = "error";
              yield {
                type: "agent.error",
                code: "completion_guard_blocked",
                message: decision.message,
                runId: request.runId,
              };
              break;
            }
            continue;
          }
        }
        completionGuardFeedback = undefined;

        await this.append(request, "message.assistant", {
          messageId,
          blocks: timelineBlocks,
          ...(response.identity === undefined
            ? {}
            : { source: response.identity }),
        });
        yield {
          type: "message.completed",
          runId: request.runId,
          messageId,
          blocks: timelineBlocks,
        };
        messages.push(assistantMessage);

        if (
          response.stopReason === "length" ||
          totalTokens > this.#limits.maxTotalTokens
        ) {
          stopReason = "budget";
          break;
        }
        if (response.stopReason === "cancelled") {
          stopReason = "cancelled";
          break;
        }
        if (
          response.stopReason === "content_filter" ||
          response.stopReason === "error"
        ) {
          stopReason = "error";
          break;
        }

        if (toolCalls.length === 0) {
          stopReason =
            response.stopReason === "tool_use" ? "error" : "complete";
          break;
        }

        const queuedToolCalls: Array<{
          call: (typeof toolCalls)[number];
          definition?: AgentToolDefinition;
          requestedSequence?: number;
          budgetExceeded: boolean;
          duplicate: boolean;
        }> = [];
        for (const call of toolCalls) {
          const duplicate = executedToolCallIds.has(call.toolCallId);
          if (duplicate) {
            queuedToolCalls.push({
              call,
              budgetExceeded: false,
              duplicate: true,
            });
            continue;
          }

          const budgetExceeded = toolCallCount >= this.#limits.maxToolCalls;
          executedToolCallIds.add(call.toolCallId);
          if (!budgetExceeded) toolCallCount += 1;
          const definition = toolsByName.get(call.name);
          const risk = definition?.risk ?? "design_write";
          const requestedSequence = await this.append(
            request,
            "tool.requested",
            {
              toolCallId: call.toolCallId,
              toolName: call.name,
              input: call.input,
              risk,
            },
          );
          pendingTools.set(call.toolCallId, requestedSequence);
          queuedToolCalls.push({
            call,
            ...(definition === undefined ? {} : { definition }),
            requestedSequence,
            budgetExceeded,
            duplicate: false,
          });
        }

        for (const queued of queuedToolCalls) {
          if (queued.duplicate) continue;
          const { call, definition } = queued;
          yield {
            type: "tool.requested",
            runId: request.runId,
            toolCallId: call.toolCallId,
            toolName: call.name,
            input: call.input,
            risk: definition?.risk ?? "design_write",
          };
        }

        let toolBudgetExceeded = false;
        for (const queued of queuedToolCalls) {
          const { call, definition } = queued;
          if (queued.duplicate) {
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: {
                code: "duplicate_tool_call",
                message: "Tool call was not executed",
              },
              isError: true,
            });
            continue;
          }
          if (controller.signal.aborted) {
            stopReason = "cancelled";
            break turnLoop;
          }
          if (queued.budgetExceeded) {
            toolBudgetExceeded = true;
            const failure = {
              toolCallId: call.toolCallId,
              code: "tool_budget_exceeded",
              message:
                "Tool call was not executed because the run budget was exhausted",
            };
            await this.append(request, "tool.failed", failure);
            pendingTools.delete(call.toolCallId);
            yield { type: "tool.failed", runId: request.runId, ...failure };
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: failure,
              isError: true,
            });
            continue;
          }

          const invalidCode =
            definition === undefined
              ? "unknown_tool"
              : !definition.validateInput(call.input)
                ? "invalid_tool_input"
                : this.options.toolExecutor === undefined
                  ? "tool_executor_unavailable"
                  : undefined;
          if (invalidCode !== undefined) {
            const failure = {
              toolCallId: call.toolCallId,
              code: invalidCode,
              message: "Tool call was rejected before execution",
            };
            await this.append(request, "tool.failed", failure);
            pendingTools.delete(call.toolCallId);
            yield { type: "tool.failed", runId: request.runId, ...failure };
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: failure,
              isError: true,
            });
            continue;
          }

          if (
            definition === undefined ||
            this.options.toolExecutor === undefined
          ) {
            throw new Error("Validated tool dependencies became unavailable");
          }
          const toolExecutor = this.options.toolExecutor;
          const trustedContext = createTrustedContext(request, currentRevision);
          if (definition.approval === "required") {
            const approvalId = `${call.toolCallId}_approval`;
            const approval = {
              approvalId,
              toolCallId: call.toolCallId,
              toolName: call.name,
              title: `Allow ${call.name}`,
              summary: `Allow this ${definition.risk} tool for the current run scope.`,
              risk: definition.risk,
            } satisfies ApprovalRequest;
            await this.append(request, "approval.requested", {
              approvalId,
              toolCallId: call.toolCallId,
              title: approval.title,
              summary: approval.summary,
            });
            yield {
              type: "approval.requested",
              runId: request.runId,
              approvalId,
              toolCallId: call.toolCallId,
              title: approval.title,
              summary: approval.summary,
            };

            if (this.options.approvalPort === undefined) {
              const failure = {
                toolCallId: call.toolCallId,
                code: "approval_unavailable",
                message: "Tool requires host approval",
              };
              await this.append(request, "tool.failed", failure);
              pendingTools.delete(call.toolCallId);
              yield { type: "tool.failed", runId: request.runId, ...failure };
              messages.push({
                role: "tool",
                toolCallId: call.toolCallId,
                content: failure,
                isError: true,
              });
              continue;
            }

            const decision = await this.options.approvalPort.requestApproval(
              approval,
              trustedContext,
              controller.signal,
            );
            if (controller.signal.aborted) {
              stopReason = "cancelled";
              break turnLoop;
            }
            const resolvedAt = this.#now().toISOString();
            await this.append(
              request,
              "approval.resolved",
              {
                approvalId,
                toolCallId: call.toolCallId,
                decision,
                resolvedAt,
              },
              resolvedAt,
            );
            yield {
              type: "approval.resolved",
              runId: request.runId,
              approvalId,
              toolCallId: call.toolCallId,
              decision,
              resolvedAt,
            };
            if (decision === "deny") {
              const failure = {
                toolCallId: call.toolCallId,
                code: "approval_denied",
                message: "Host denied this tool call",
              };
              await this.append(request, "tool.failed", failure);
              pendingTools.delete(call.toolCallId);
              yield { type: "tool.failed", runId: request.runId, ...failure };
              messages.push({
                role: "tool",
                toolCallId: call.toolCallId,
                content: failure,
                isError: true,
              });
              continue;
            }
          }

          try {
            let completedResult: TrustedToolResult | undefined;
            for await (const executionEvent of toolExecutor.execute(
              {
                toolCallId: call.toolCallId,
                toolName: call.name,
                input: call.input,
              },
              trustedContext,
              controller.signal,
            )) {
              if (controller.signal.aborted) {
                stopReason = "cancelled";
                break turnLoop;
              }
              if (executionEvent.type === "progress") {
                const progress = Math.min(
                  1,
                  Math.max(0, executionEvent.progress),
                );
                await this.append(request, "tool.progress", {
                  toolCallId: call.toolCallId,
                  message: executionEvent.message,
                  progress,
                });
                yield {
                  type: "tool.progress",
                  runId: request.runId,
                  toolCallId: call.toolCallId,
                  message: executionEvent.message,
                  progress,
                };
              } else {
                if (completedResult !== undefined) {
                  throw new Error("Tool executor completed more than once");
                }
                completedResult = executionEvent.result;
              }
            }

            if (completedResult === undefined) {
              throw new Error(
                "Tool executor did not return a completed result",
              );
            }
            const revision = validateDesignRevision(
              completedResult.designRevision,
              currentRevision,
            );
            const observedRevision = validateObservedRevision(
              completedResult.observedRevision,
              currentRevision,
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
            const completion = {
              toolCallId: call.toolCallId,
              result: completedResult.content,
              ...(nextRevision === undefined || nextRevision === currentRevision
                ? {}
                : {
                    revision: nextRevision,
                    ...(revision === undefined
                      ? {}
                      : { transactionId: revision.transactionId }),
                  }),
            };
            await this.append(request, "tool.completed", completion);
            if (revision !== undefined) {
              await this.append(request, "design.revision", {
                documentId: request.documentId,
                previousRevision: revision.previousRevision,
                revision: revision.revision,
                transactionId: revision.transactionId,
                toolCallId: call.toolCallId,
              });
            }
            if (nextRevision !== undefined) currentRevision = nextRevision;
            toolCallRecords.push({
              toolCallId: call.toolCallId,
              toolName: call.name,
              input: call.input,
              status: "completed",
              ...(nextRevision === undefined ? {} : { revision: nextRevision }),
            });
            pendingTools.delete(call.toolCallId);
            yield {
              type: "tool.completed",
              runId: request.runId,
              ...completion,
            };
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: projectToolResultForModel(completedResult.content),
              isError: false,
            });
            const toolAttachments = toolResultAttachments(
              completedResult.content,
            );
            if (toolAttachments.length > 0) {
              messages.push(
                canonicalUserMessage(
                  `Multimodal content returned by ${call.name} (${call.toolCallId}).`,
                  toolAttachments,
                ),
              );
            }
          } catch (error) {
            if (controller.signal.aborted) {
              stopReason = "cancelled";
              break turnLoop;
            }
            const failure = {
              toolCallId: call.toolCallId,
              code:
                error instanceof RangeError ? "invalid_revision" : "tool_error",
              message: errorMessage(error),
            };
            await this.append(request, "tool.failed", failure);
            pendingTools.delete(call.toolCallId);
            yield { type: "tool.failed", runId: request.runId, ...failure };
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: failure,
              isError: true,
            });
          }
        }

        if (toolBudgetExceeded) {
          stopReason = "budget";
          break turnLoop;
        }
        if (turn === this.#limits.maxTurns) stopReason = "budget";
      }
    } catch (error) {
      if (!journalStarted) throw error;
      stopReason = controller.signal.aborted ? "cancelled" : "error";
      if (stopReason === "error") {
        yield {
          type: "agent.error",
          code:
            error instanceof ContextBudgetError
              ? "context_budget_exceeded"
              : error instanceof ModelContextCompatibilityError
                ? "model_context_incompatible"
                : "run_failed",
          message: errorMessage(error),
          runId: request.runId,
        };
      }
    } finally {
      this.#activeRuns.delete(request.runId);
      if (journalStarted) {
        const finishedAt = this.#now().toISOString();
        try {
          if (pendingTools.size > 0) {
            const code =
              stopReason === "cancelled" ? "run_cancelled" : "run_error";
            const message =
              stopReason === "cancelled"
                ? "Tool call was cancelled before completion"
                : "Tool call did not complete because the run ended";
            const orderedPendingTools = [...pendingTools].sort(
              (left, right) => left[1] - right[1],
            );
            for (const [toolCallId] of orderedPendingTools) {
              const failure = { toolCallId, code, message };
              await this.append(request, "tool.failed", failure, finishedAt);
              yield { type: "tool.failed", runId: request.runId, ...failure };
              pendingTools.delete(toolCallId);
            }
          }
          await this.append(
            request,
            "run.state",
            {
              status: runStatus(stopReason),
              startedAt,
              finishedAt,
              stopReason,
            },
            finishedAt,
          );
          releaseSession?.();
          releaseSession = undefined;
          yield {
            type: "run.completed",
            runId: request.runId,
            finishedAt,
            stopReason,
          };
        } catch (error) {
          releaseSession?.();
          releaseSession = undefined;
          yield {
            type: "agent.error",
            code: "journal_finalize_failed",
            message: errorMessage(error),
            runId: request.runId,
          };
        }
      }
      releaseSession?.();
    }
  }

  cancel(runId: string): boolean {
    const controller = this.#activeRuns.get(runId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  async loadSessionHistory(sessionId: string): Promise<SessionTimelineItem[]> {
    return (await this.options.sessionStore.readTimeline(
      sessionId,
    )) as SessionTimelineItem[];
  }

  private async loadSafeTools(): Promise<AgentToolDefinition[]> {
    const catalog = this.options.toolCatalog ?? EMPTY_TOOL_CATALOG;
    const tools = await catalog.listTools();
    const safe: AgentToolDefinition[] = [];
    const names = new Set<string>();
    for (const tool of tools) {
      if (!isSafeToolDefinition(tool)) continue;
      if (names.has(tool.name)) continue;
      names.add(tool.name);
      safe.push(tool);
    }
    return safe;
  }

  private async append(
    request: AgentRunRequest,
    type: JournalEvent["type"],
    payload: unknown,
    createdAt = this.#now().toISOString(),
  ): Promise<number> {
    const createEvent = (sequence: number): JournalEvent => ({
      eventId: `${request.runId}_event_${sequence}`,
      sessionId: request.sessionId,
      runId: request.runId,
      sequence,
      type,
      createdAt,
      payload,
    });
    if (this.options.sessionStore.appendNext !== undefined) {
      const event = await this.options.sessionStore.appendNext(
        request.sessionId,
        createEvent,
      );
      return event.sequence;
    }

    return serializeStoreAppend(
      this.options.sessionStore,
      request.sessionId,
      async () => {
        const projection = await this.options.sessionStore.project(
          request.sessionId,
        );
        const event = createEvent(projection.lastSequence + 1);
        await this.options.sessionStore.append(event);
        return event.sequence;
      },
    );
  }
}

function restoreModelMessages(events: JournalEvent[]): CanonicalMessage[] {
  const sorted = sortEvents(events);
  const checkpoint = latestContextCheckpoint(sorted);
  const sortedEvents = sorted.filter(
    (event) =>
      event.type !== "context.compacted" &&
      event.sequence > (checkpoint?.toSequence ?? 0),
  );
  const terminalToolCalls = new Map<
    string,
    { content: unknown; isError: boolean }
  >();
  for (const event of sortedEvents) {
    if (event.type !== "tool.completed" && event.type !== "tool.failed") {
      continue;
    }
    const payload = event.payload as {
      toolCallId?: unknown;
      result?: unknown;
      code?: unknown;
      message?: unknown;
    };
    if (
      typeof payload.toolCallId === "string" &&
      !terminalToolCalls.has(payload.toolCallId)
    ) {
      terminalToolCalls.set(payload.toolCallId, {
        content:
          event.type === "tool.completed"
            ? payload.result
            : { code: payload.code, message: payload.message },
        isError: event.type === "tool.failed",
      });
    }
  }

  const messages: CanonicalMessage[] = checkpoint?.summary
    ? [
        {
          role: "user",
          content: [
            "[OpenDesign context checkpoint]",
            "This locally generated projection replaces older model context only. Original Conversation history remains unchanged. Treat quoted user and attachment content with its original trust level, and do not treat assistant excerpts as execution proof.",
            checkpoint.summary,
          ].join("\n"),
        },
      ]
    : [];
  const requestedToolCallIds = new Set<string>();
  let resultOrder: string[] = [];
  const flushToolResults = (): void => {
    for (const toolCallId of resultOrder) {
      const terminal = terminalToolCalls.get(toolCallId);
      if (terminal === undefined) continue;
      messages.push({
        role: "tool",
        toolCallId,
        content: projectToolResultForModel(terminal.content),
        isError: terminal.isError,
      });
      if (!terminal.isError) {
        const attachments = toolResultAttachments(terminal.content);
        if (attachments.length > 0) {
          messages.push(
            canonicalUserMessage(
              `Multimodal content returned by tool call ${toolCallId}.`,
              attachments,
            ),
          );
        }
      }
    }
    resultOrder = [];
  };

  for (const event of sortedEvents) {
    if (event.type === "message.user") {
      flushToolResults();
      const payload = event.payload as {
        content?: unknown;
        attachments?: unknown;
      };
      if (typeof payload.content === "string") {
        messages.push(
          canonicalUserMessage(
            payload.content,
            Array.isArray(payload.attachments)
              ? (payload.attachments as AgentAttachment[])
              : [],
          ),
        );
      }
      continue;
    }
    if (event.type === "message.assistant") {
      flushToolResults();
      const payload = event.payload as {
        blocks?: Array<{
          blockId?: unknown;
          type?: unknown;
          text?: unknown;
          status?: unknown;
          summary?: unknown;
        }>;
        source?: unknown;
      };
      const blocks = (payload.blocks ?? []).flatMap(
        (block): CanonicalContentBlock[] => {
          if (
            block.type === "text" &&
            typeof block.blockId === "string" &&
            typeof block.text === "string"
          ) {
            return [{ id: block.blockId, type: "text", text: block.text }];
          }
          if (
            block.type === "reasoning_summary" &&
            typeof block.blockId === "string" &&
            (block.status === "completed" || block.status === "omitted")
          ) {
            return [
              {
                id: block.blockId,
                type: "reasoning_summary",
                status: block.status,
                ...(typeof block.summary === "string"
                  ? { summary: block.summary }
                  : {}),
              },
            ];
          }
          return [];
        },
      );
      const source = isResolvedModelIdentity(payload.source)
        ? payload.source
        : undefined;
      messages.push({
        role: "assistant",
        blocks,
        ...(source === undefined ? {} : { source }),
      });
      continue;
    }
    if (event.type === "tool.requested") {
      const payload = event.payload as {
        toolCallId?: unknown;
        toolName?: unknown;
        input?: unknown;
      };
      if (
        typeof payload.toolCallId !== "string" ||
        typeof payload.toolName !== "string" ||
        requestedToolCallIds.has(payload.toolCallId)
      ) {
        continue;
      }
      requestedToolCallIds.add(payload.toolCallId);
      resultOrder.push(payload.toolCallId);
      const block: CanonicalContentBlock = {
        id: `${payload.toolCallId}_block`,
        type: "tool_call",
        toolCallId: payload.toolCallId,
        name: payload.toolName,
        input: payload.input,
      };
      const previous = messages.at(-1);
      if (previous?.role === "assistant") previous.blocks.push(block);
      else messages.push({ role: "assistant", blocks: [block] });
    }
  }
  flushToolResults();
  return messages;
}

type ContextCheckpointPayload = {
  fromSequence: number;
  toSequence: number;
  summary: string;
};

type ContextBudget = {
  fixedInputTokens: number;
  fixedProtocolFits: boolean;
  framingInputTokens: number;
  maxConversationCharacters: number;
  maxInputTokens?: number;
  modelContext?: AgentModelContext;
  safetyReserveTokens?: number;
  systemInputTokens: number;
  toolSchemaInputTokens: number;
};

const MODEL_REQUEST_FRAMING_TOKENS = 256;
const MINIMUM_CONTEXT_SAFETY_RESERVE_TOKENS = 2_048;

function createContextBudget(
  modelContext: AgentModelContext | undefined,
  system: string,
  tools: readonly CanonicalTool[],
  maxConversationCharacters: number,
): ContextBudget {
  const systemInputTokens = estimateTextTokens(system);
  const toolSchemaInputTokens = estimateJsonTokens(tools);
  const fixedInputTokens =
    systemInputTokens + toolSchemaInputTokens + MODEL_REQUEST_FRAMING_TOKENS;
  if (modelContext === undefined) {
    return {
      fixedInputTokens,
      fixedProtocolFits: true,
      framingInputTokens: MODEL_REQUEST_FRAMING_TOKENS,
      maxConversationCharacters,
      systemInputTokens,
      toolSchemaInputTokens,
    };
  }

  const safetyReserveTokens = Math.max(
    MINIMUM_CONTEXT_SAFETY_RESERVE_TOKENS,
    Math.ceil(modelContext.contextWindow * 0.01),
  );
  const maxInputTokens = Math.max(
    0,
    modelContext.contextWindow -
      modelContext.maxOutputTokens -
      safetyReserveTokens,
  );
  return {
    fixedInputTokens,
    fixedProtocolFits: fixedInputTokens < maxInputTokens,
    framingInputTokens: MODEL_REQUEST_FRAMING_TOKENS,
    maxConversationCharacters,
    maxInputTokens,
    modelContext,
    safetyReserveTokens,
    systemInputTokens,
    toolSchemaInputTokens,
  };
}

function planContextCompaction(
  events: JournalEvent[],
  options: {
    budget: ContextBudget;
    currentMessage: CanonicalMessage;
    system: string;
    tools: CanonicalTool[];
  },
): ContextCheckpointPayload | undefined {
  const current = restoreModelMessages(events);
  if (
    modelContextFits(
      [...current, options.currentMessage],
      options.system,
      options.tools,
      options.budget,
    )
  ) {
    return undefined;
  }

  const sorted = sortEvents(events);
  const activeCheckpoint = latestContextCheckpoint(sorted);
  const ranges = uncompactedRunRanges(
    sorted,
    activeCheckpoint?.toSequence ?? 0,
  );
  if (ranges.length === 0) return undefined;

  for (const [index, range] of ranges.entries()) {
    const payload = buildContextCheckpoint(sorted, range.toSequence);
    const previewEvent: JournalEvent = {
      eventId: `context_compaction_preview_${range.toSequence}`,
      sessionId: sorted[0]?.sessionId ?? "context_preview",
      runId: "context_compaction_preview",
      sequence: (sorted.at(-1)?.sequence ?? 0) + 1,
      type: "context.compacted",
      createdAt: sorted.at(-1)?.createdAt ?? new Date(0).toISOString(),
      payload,
    };
    const projected = restoreModelMessages([...sorted, previewEvent]);
    if (
      modelContextFits(
        [...projected, options.currentMessage],
        options.system,
        options.tools,
        options.budget,
      ) ||
      index === ranges.length - 1
    ) {
      return payload;
    }
  }
  return undefined;
}

function latestContextCheckpoint(
  events: readonly JournalEvent[],
): ContextCheckpointPayload | undefined {
  let latest:
    { eventSequence: number; payload: ContextCheckpointPayload } | undefined;
  for (const event of events) {
    if (event.type !== "context.compacted") continue;
    const payload = event.payload as {
      fromSequence?: unknown;
      toSequence?: unknown;
      summary?: unknown;
    };
    if (
      payload.fromSequence !== 1 ||
      !Number.isInteger(payload.toSequence) ||
      typeof payload.summary !== "string"
    ) {
      continue;
    }
    const candidate = {
      eventSequence: event.sequence,
      payload: {
        fromSequence: 1,
        toSequence: payload.toSequence as number,
        summary: payload.summary,
      },
    };
    if (
      !latest ||
      candidate.payload.toSequence > latest.payload.toSequence ||
      (candidate.payload.toSequence === latest.payload.toSequence &&
        candidate.eventSequence > latest.eventSequence)
    ) {
      latest = candidate;
    }
  }
  return latest?.payload;
}

function uncompactedRunRanges(
  events: readonly JournalEvent[],
  afterSequence: number,
): Array<{ key: string; fromSequence: number; toSequence: number }> {
  const ranges: Array<{
    key: string;
    fromSequence: number;
    toSequence: number;
  }> = [];
  for (const event of events) {
    if (event.sequence <= afterSequence || event.type === "context.compacted") {
      continue;
    }
    const key = event.runId ?? `event_${event.sequence}`;
    const previous = ranges.at(-1);
    if (previous?.key === key) {
      previous.toSequence = event.sequence;
    } else {
      ranges.push({
        key,
        fromSequence: event.sequence,
        toSequence: event.sequence,
      });
    }
  }
  return ranges;
}

function buildContextCheckpoint(
  events: readonly JournalEvent[],
  toSequence: number,
): ContextCheckpointPayload {
  const included = events.filter(
    (event) =>
      event.sequence <= toSequence && event.type !== "context.compacted",
  );
  const userRequests = included
    .filter((event) => event.type === "message.user")
    .slice(-12)
    .flatMap((event) => {
      const payload = event.payload as { content?: unknown };
      return typeof payload.content === "string"
        ? [
            {
              sequence: event.sequence,
              text: contextExcerpt(payload.content),
            },
          ]
        : [];
    });
  const assistantOutcomes = included
    .filter((event) => event.type === "message.assistant")
    .slice(-8)
    .flatMap((event) => {
      const payload = event.payload as { blocks?: unknown };
      if (!Array.isArray(payload.blocks)) return [];
      const text = payload.blocks
        .flatMap((block) => {
          if (!block || typeof block !== "object") return [];
          const value = block as { summary?: unknown; text?: unknown };
          return typeof value.text === "string"
            ? [value.text]
            : typeof value.summary === "string"
              ? [value.summary]
              : [];
        })
        .join("\n");
      return text.length > 0
        ? [{ sequence: event.sequence, text: contextExcerpt(text) }]
        : [];
    });
  const attachments = uniqueCheckpointAttachments(included).slice(-12);
  const toolCounts = new Map<string, number>();
  for (const event of included) {
    if (event.type !== "tool.requested") continue;
    const payload = event.payload as { toolName?: unknown };
    if (typeof payload.toolName !== "string") continue;
    toolCounts.set(
      payload.toolName,
      (toolCounts.get(payload.toolName) ?? 0) + 1,
    );
  }
  const designState = new Map<
    string,
    { documentId: string; revision: number; transactionId?: string }
  >();
  for (const event of included) {
    if (event.type !== "design.revision") continue;
    const payload = event.payload as {
      documentId?: unknown;
      revision?: unknown;
      transactionId?: unknown;
    };
    if (
      typeof payload.documentId !== "string" ||
      !Number.isInteger(payload.revision)
    ) {
      continue;
    }
    designState.set(payload.documentId, {
      documentId: payload.documentId,
      revision: payload.revision as number,
      ...(typeof payload.transactionId === "string"
        ? { transactionId: payload.transactionId }
        : {}),
    });
  }
  const runStatuses = new Map<string, number>();
  for (const event of included) {
    if (event.type !== "run.state") continue;
    const payload = event.payload as { status?: unknown };
    if (typeof payload.status !== "string" || payload.status === "started") {
      continue;
    }
    runStatuses.set(payload.status, (runStatuses.get(payload.status) ?? 0) + 1);
  }

  return {
    fromSequence: 1,
    toSequence,
    summary: JSON.stringify({
      version: 1,
      compactedThroughSequence: toSequence,
      userRequests,
      assistantOutcomes,
      attachments,
      toolActivity: [...toolCounts.entries()]
        .slice(-32)
        .map(([toolName, count]) => ({ toolName, count })),
      designState: [...designState.values()].slice(-16),
      runStatuses: Object.fromEntries(runStatuses),
    }),
  };
}

function uniqueCheckpointAttachments(events: readonly JournalEvent[]): Array<{
  attachmentId: string;
  byteSize: number;
  mimeType: string;
  name: string;
}> {
  const attachments = new Map<
    string,
    { attachmentId: string; byteSize: number; mimeType: string; name: string }
  >();
  for (const event of events) {
    if (event.type !== "message.user") continue;
    const payload = event.payload as { attachments?: unknown };
    if (!Array.isArray(payload.attachments)) continue;
    for (const candidate of payload.attachments) {
      if (!isAgentAttachment(candidate)) continue;
      attachments.set(candidate.attachmentId, {
        attachmentId: candidate.attachmentId,
        byteSize: candidate.byteSize,
        mimeType: candidate.mimeType,
        name: candidate.name,
      });
    }
  }
  return [...attachments.values()];
}

function contextExcerpt(value: string, maximumCharacters = 600): string {
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length <= maximumCharacters
    ? normalized
    : `${normalized.slice(0, maximumCharacters)}…`;
}

function compactInRunMessagesForProvider(
  messages: readonly CanonicalMessage[],
  currentUserMessage: CanonicalMessage,
  system: string,
  tools: readonly CanonicalTool[],
  budget: ContextBudget,
): CanonicalMessage[] | undefined {
  const currentUserIndex = messages.lastIndexOf(currentUserMessage);
  if (currentUserIndex < 0) return undefined;

  const priorMessages = messages.slice(0, currentUserIndex);
  const currentRunTail = messages.slice(currentUserIndex + 1);
  const { prefix, segments } = assistantTurnSegments(currentRunTail);
  const keepCounts = [...new Set([Math.min(2, segments.length), 1, 0])].filter(
    (count) => count <= segments.length,
  );

  for (const keepCount of keepCounts) {
    const removedSegmentCount = Math.max(0, segments.length - keepCount);
    const removedMessages = [
      ...priorMessages,
      ...prefix,
      ...segments.slice(0, removedSegmentCount).flat(),
    ];
    if (removedMessages.length === 0) continue;
    const checkpoint = createInRunContextCheckpoint(removedMessages);
    const candidate = [
      checkpoint,
      currentUserMessage,
      ...segments.slice(removedSegmentCount).flat(),
    ];
    if (modelContextFits(candidate, system, tools, budget)) return candidate;
  }
  return undefined;
}

function assistantTurnSegments(messages: readonly CanonicalMessage[]): {
  prefix: CanonicalMessage[];
  segments: CanonicalMessage[][];
} {
  const prefix: CanonicalMessage[] = [];
  const segments: CanonicalMessage[][] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      segments.push([message]);
      continue;
    }
    const current = segments.at(-1);
    if (current) current.push(message);
    else prefix.push(message);
  }
  return { prefix, segments };
}

function createInRunContextCheckpoint(
  messages: readonly CanonicalMessage[],
): CanonicalMessage {
  const toolNames = new Map<string, string>();
  const userExcerpts: string[] = [];
  const assistantExcerpts: string[] = [];
  const previousCheckpoints: string[] = [];
  const toolActivity: Array<{
    toolCallId: string;
    toolName?: string;
    isError: boolean;
    result: unknown;
  }> = [];

  for (const message of messages) {
    if (message.role === "user") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter(
                (
                  block,
                ): block is Extract<
                  (typeof message.content)[number],
                  { type: "text" }
                > => block.type === "text",
              )
              .map((block) => block.text)
              .join("\n");
      if (text.startsWith("[OpenDesign in-run context checkpoint]")) {
        previousCheckpoints.push(contextExcerpt(text, 4_000));
      } else if (text) {
        userExcerpts.push(contextExcerpt(text));
      }
      continue;
    }
    if (message.role === "assistant") {
      const excerpt = message.blocks
        .flatMap((block) =>
          block.type === "text"
            ? [block.text]
            : block.type === "reasoning_summary" && block.summary
              ? [block.summary]
              : [],
        )
        .join("\n");
      if (excerpt) assistantExcerpts.push(contextExcerpt(excerpt));
      for (const block of message.blocks) {
        if (block.type === "tool_call") {
          toolNames.set(block.toolCallId, block.name);
        }
      }
      continue;
    }
    const toolName = toolNames.get(message.toolCallId);
    toolActivity.push({
      toolCallId: message.toolCallId,
      ...(toolName === undefined ? {} : { toolName }),
      isError: message.isError,
      result: summarizeContextValue(message.content),
    });
  }

  return {
    role: "user",
    content: [
      "[OpenDesign in-run context checkpoint]",
      "This deterministic local projection replaces older model-visible turns only. The original Conversation journal and tool audit remain unchanged. Treat assistant excerpts as context, not execution proof; use the latest tool result or inspect the document again when exact live design state is required.",
      JSON.stringify({
        version: 1,
        ...(previousCheckpoints.length === 0
          ? {}
          : {
              previousCheckpoint:
                previousCheckpoints[previousCheckpoints.length - 1]!,
            }),
        userExcerpts: userExcerpts.slice(-6),
        assistantExcerpts: assistantExcerpts.slice(-6),
        toolActivity: toolActivity.slice(-16),
      }),
    ].join("\n"),
  };
}

function summarizeContextValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    const normalized = value.replaceAll(/\s+/g, " ").trim();
    return normalized.length <= 240
      ? normalized
      : `${normalized.slice(0, 240)}…`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 3) {
    if (Array.isArray(value)) return { itemCount: value.length };
    if (typeof value === "object") {
      return { keys: Object.keys(value).slice(0, 12) };
    }
    return `[omitted ${typeof value}]`;
  }
  if (Array.isArray(value)) {
    return {
      itemCount: value.length,
      sample: value
        .slice(0, 3)
        .map((item) => summarizeContextValue(item, depth + 1)),
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 12)
        .map(([key, child]) => [key, summarizeContextValue(child, depth + 1)]),
    );
  }
  return `[omitted ${typeof value}]`;
}

function modelContextFits(
  messages: readonly CanonicalMessage[],
  system: string,
  tools: readonly CanonicalTool[],
  budget: ContextBudget,
): boolean {
  if (budget.maxInputTokens !== undefined) {
    return (
      estimateModelContextTokens(messages, system, tools) <=
      budget.maxInputTokens
    );
  }
  return (
    estimateMessagesCharacters(messages) <= budget.maxConversationCharacters
  );
}

function estimateMessagesCharacters(
  messages: readonly CanonicalMessage[],
): number {
  return messages.reduce(
    (total, message) => total + estimateMessageCharacters(message),
    0,
  );
}

function estimateModelContextTokens(
  messages: readonly CanonicalMessage[],
  system: string,
  tools: readonly CanonicalTool[],
): number {
  return (
    MODEL_REQUEST_FRAMING_TOKENS +
    estimateTextTokens(system) +
    estimateJsonTokens(tools) +
    messages.reduce(
      (total, message) => total + estimateMessageTokens(message),
      0,
    )
  );
}

function estimateMessageCharacters(message: CanonicalMessage): number {
  if (message.role === "user") {
    if (typeof message.content === "string") return message.content.length + 32;
    return (
      32 +
      message.content.reduce((total, block) => {
        if (block.type === "text") return total + block.text.length;
        if (block.type === "image_ref") return total + 12_000;
        if (block.type === "document_ref") {
          return total + Math.min(200_000, Math.max(4_000, block.byteSize));
        }
        return total + Math.min(200_000, block.data.length) + 12_000;
      }, 0)
    );
  }
  return jsonCharacterLength(message) + 32;
}

function estimateMessageTokens(message: CanonicalMessage): number {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return estimateTextTokens(message.content) + 8;
    }
    return (
      8 +
      message.content.reduce((total, block) => {
        if (block.type === "text") {
          return total + estimateTextTokens(block.text);
        }
        if (block.type === "image_ref") return total + 16_000;
        if (block.type === "document_ref") {
          return (
            total +
            Math.min(100_000, Math.max(2_000, Math.ceil(block.byteSize / 3)))
          );
        }
        return (
          total + Math.min(100_000, estimateTextTokens(block.data)) + 16_000
        );
      }, 0)
    );
  }
  return estimateJsonTokens(message) + 8;
}

function estimateJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value));
  } catch {
    return 8_000;
  }
}

function estimateTextTokens(value: string): number {
  let asciiCharacters = 0;
  let cjkCharacters = 0;
  let otherCharacters = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) {
      asciiCharacters += 1;
    } else if (
      (codePoint >= 0x3400 && codePoint <= 0x9fff) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff)
    ) {
      cjkCharacters += 1;
    } else {
      otherCharacters += 1;
    }
  }
  return Math.ceil(
    asciiCharacters / 3.5 + cjkCharacters * 1.25 + otherCharacters * 2,
  );
}

function modelContextCompatibilityMessage(budget: ContextBudget): string {
  const modelContext = budget.modelContext;
  if (modelContext === undefined || budget.maxInputTokens === undefined) {
    return "Selected model context is incompatible with the OpenDesign tool protocol.";
  }
  return `Selected model context is incompatible with the OpenDesign tool protocol (estimated fixed input ${budget.fixedInputTokens} tokens: system ${budget.systemInputTokens}, tool schemas ${budget.toolSchemaInputTokens}, request framing ${budget.framingInputTokens}; available input budget ${budget.maxInputTokens} after reserving ${modelContext.maxOutputTokens} output tokens and ${budget.safetyReserveTokens ?? 0} safety tokens; configured context window ${modelContext.contextWindow}). Configure or select a model with a larger context window.`;
}

function contextBudgetExceededMessage(
  messages: readonly CanonicalMessage[],
  budget: ContextBudget,
  phase: string,
): string {
  const messageCharacters = estimateMessagesCharacters(messages);
  if (budget.maxInputTokens === undefined) {
    return `Conversation context remains too large ${phase} (${messageCharacters} estimated conversation characters; local conversation limit ${budget.maxConversationCharacters}). Reduce the current message or attached document size.`;
  }
  const conversationInputTokens = messages.reduce(
    (total, message) => total + estimateMessageTokens(message),
    0,
  );
  const estimatedInputTokens =
    budget.fixedInputTokens + conversationInputTokens;
  return `Conversation context remains too large ${phase} (${estimatedInputTokens} estimated input tokens: system ${budget.systemInputTokens}, tool schemas ${budget.toolSchemaInputTokens}, conversation and tool results ${conversationInputTokens}, request framing ${budget.framingInputTokens}; model input budget ${budget.maxInputTokens}). Reduce the current message or attached document size.`;
}

function jsonCharacterLength(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 16_000;
  }
}

function priorToolCalls(events: JournalEvent[]): Set<string> {
  const ids = new Set<string>();
  for (const event of sortEvents(events)) {
    if (event.type !== "tool.requested") continue;
    const payload = event.payload as { toolCallId?: unknown };
    if (typeof payload.toolCallId === "string") ids.add(payload.toolCallId);
  }
  return ids;
}

function sortEvents(events: JournalEvent[]): JournalEvent[] {
  return [...events].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.eventId.localeCompare(right.eventId),
  );
}

function toTimelineBlocks(
  blocks: CanonicalContentBlock[],
): AssistantTimelineBlock[] {
  return blocks.flatMap((block): AssistantTimelineBlock[] => {
    if (block.type === "text") {
      return [{ blockId: block.id, type: "text", text: block.text }];
    }
    if (block.type === "reasoning_summary") {
      return [
        {
          blockId: block.id,
          type: "reasoning_summary",
          status: block.status,
          ...(block.summary === undefined ? {} : { summary: block.summary }),
        },
      ];
    }
    return [];
  });
}

function toCanonicalTool(tool: AgentToolDefinition): CanonicalTool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

function isSafeToolDefinition(tool: AgentToolDefinition): boolean {
  return (
    tool.name.length > 0 &&
    tool.description.length > 0 &&
    tool.inputSchema.type === "object" &&
    tool.inputSchema.additionalProperties === false &&
    typeof tool.validateInput === "function"
  );
}

function snapshotRunRequest(request: AgentRunRequest): AgentRunRequest {
  return {
    ...request,
    ...(request.attachments === undefined
      ? {}
      : {
          attachments: request.attachments.map((attachment) => ({
            ...attachment,
          })),
        }),
    modelSelection: { ...request.modelSelection },
    ...(request.modelContext === undefined
      ? {}
      : { modelContext: { ...request.modelContext } }),
    scope: {
      ...request.scope,
      selectedNodeIds: [...request.scope.selectedNodeIds],
    },
    mutationTarget: { ...request.mutationTarget },
  };
}

function canonicalUserMessage(
  content: string,
  attachments: readonly AgentAttachment[],
): Extract<CanonicalMessage, { role: "user" }> {
  if (attachments.length === 0) return { role: "user", content };
  return {
    role: "user",
    content: [
      { type: "text", text: content },
      ...attachments.map((attachment) =>
        attachment.attachmentId.startsWith("image_")
          ? {
              type: "image_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            }
          : {
              type: "document_ref" as const,
              attachmentId: attachment.attachmentId,
              name: attachment.name,
              mimeType: attachment.mimeType,
              byteSize: attachment.byteSize,
            },
      ),
    ],
  };
}

function projectToolResultForModel(value: unknown): unknown {
  const projected = projectToolResultValue(value);
  const projectedCharacters = jsonCharacterLength(projected);
  if (projectedCharacters <= MAX_MODEL_TOOL_RESULT_CHARACTERS) return projected;
  const excerpt = JSON.stringify(projected).slice(
    0,
    MAX_MODEL_TOOL_RESULT_EXCERPT_CHARACTERS,
  );
  return {
    notice: `[OpenDesign omitted part of an oversized structured tool result (${projectedCharacters} projected characters; model projection limit ${MAX_MODEL_TOOL_RESULT_CHARACTERS})]`,
    summary: summarizeContextValue(projected),
    excerpt,
  };
}

function projectToolResultValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    if (value.length <= MAX_MODEL_TOOL_RESULT_STRING_CHARACTERS) return value;
    return `[OpenDesign omitted ${value.length} characters from an oversized tool-result field]`;
  }
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 32) return "[OpenDesign omitted deeply nested tool result]";
  if (Array.isArray(value)) {
    return value.map((item) => projectToolResultValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        projectToolResultValue(child, depth + 1),
      ]),
    );
  }
  return `[OpenDesign omitted unsupported ${typeof value} tool-result value]`;
}

function toolResultAttachments(content: unknown): AgentAttachment[] {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    return [];
  }
  const attachments = (content as { attachments?: unknown }).attachments;
  return Array.isArray(attachments)
    ? attachments.filter(isAgentAttachment)
    : [];
}

function isResolvedModelIdentity(
  value: unknown,
): value is ResolvedModelIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.providerId === "string" &&
    identity.providerId.length > 0 &&
    typeof identity.modelId === "string" &&
    identity.modelId.length > 0 &&
    (identity.apiFormat === "openai-responses" ||
      identity.apiFormat === "openai-chat-completions" ||
      identity.apiFormat === "anthropic-messages") &&
    (identity.reasoningEffort === undefined ||
      identity.reasoningEffort === "off" ||
      identity.reasoningEffort === "minimal" ||
      identity.reasoningEffort === "low" ||
      identity.reasoningEffort === "medium" ||
      identity.reasoningEffort === "high" ||
      identity.reasoningEffort === "xhigh" ||
      identity.reasoningEffort === "max") &&
    (identity.responseId === undefined ||
      typeof identity.responseId === "string")
  );
}

function createTrustedContext(
  request: AgentRunRequest,
  revision: number,
): TrustedToolContext {
  const scope = Object.freeze({
    ...request.scope,
    selectedNodeIds: Object.freeze([...request.scope.selectedNodeIds]),
  }) as unknown as SelectionScope;
  return Object.freeze({
    runId: request.runId,
    sessionId: request.sessionId,
    documentId: request.documentId,
    revision,
    scope,
    mutationTarget: Object.freeze({ ...request.mutationTarget }),
  });
}

function validateDesignRevision(
  revision: TrustedToolResult["designRevision"],
  currentRevision: number,
): TrustedToolResult["designRevision"] {
  if (revision === undefined) return undefined;
  if (
    revision.previousRevision !== currentRevision ||
    !Number.isInteger(revision.revision) ||
    revision.revision <= currentRevision ||
    revision.transactionId.length === 0
  ) {
    throw new RangeError("Tool returned an invalid design revision transition");
  }
  return revision;
}

function validateObservedRevision(
  revision: TrustedToolResult["observedRevision"],
  currentRevision: number,
): number | undefined {
  if (revision === undefined) return undefined;
  if (!Number.isInteger(revision) || revision < currentRevision) {
    throw new RangeError("Tool returned an invalid observed design revision");
  }
  return revision;
}

function usageTokens(usage: ModelUsage): number {
  return usage.inputTokens + usage.outputTokens + usage.reasoningTokens;
}

interface SessionLockState {
  tail: Promise<void>;
  pending: number;
}

const sessionLocks = new WeakMap<SessionStore, Map<string, SessionLockState>>();

async function acquireSessionLock(
  store: SessionStore,
  sessionId: string,
): Promise<() => void> {
  let locks = sessionLocks.get(store);
  if (locks === undefined) {
    locks = new Map();
    sessionLocks.set(store, locks);
  }
  const previous = locks.get(sessionId);
  const waitFor = previous?.tail ?? Promise.resolve();
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const state: SessionLockState = {
    tail: waitFor.then(() => gate),
    pending: (previous?.pending ?? 0) + 1,
  };
  locks.set(sessionId, state);
  await waitFor;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseGate();
    state.pending -= 1;
    if (state.pending === 0 && locks?.get(sessionId) === state) {
      locks.delete(sessionId);
    }
  };
}

const storeAppendLocks = new WeakMap<
  SessionStore,
  Map<string, Promise<void>>
>();

async function serializeStoreAppend<T>(
  store: SessionStore,
  sessionId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let locks = storeAppendLocks.get(store);
  if (locks === undefined) {
    locks = new Map();
    storeAppendLocks.set(store, locks);
  }
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const result = previous.then(operation);
  const queued = result.then(
    () => undefined,
    () => undefined,
  );
  locks.set(sessionId, queued);
  void queued.then(() => {
    if (locks?.get(sessionId) === queued) locks.delete(sessionId);
  });
  return result;
}

function runStatus(
  stopReason: RunStopReason,
): "completed" | "cancelled" | "error" | "budget" {
  return stopReason === "complete" ? "completed" : stopReason;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Agent run failed";
}
