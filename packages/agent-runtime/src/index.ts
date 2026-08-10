import {
  isAgentAttachment,
  type AgentEvent,
  type AgentAttachment,
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
}

export interface AgentRuntimeOptions {
  modelGateway: ModelGateway;
  sessionStore: SessionStore;
  toolCatalog?: ToolCatalogPort;
  toolExecutor?: ToolExecutorPort;
  approvalPort?: ApprovalPort;
  limits?: Partial<AgentRuntimeLimits>;
  systemPrompt?: string;
  now?: () => Date;
}

const DEFAULT_LIMITS: AgentRuntimeLimits = {
  maxTurns: 8,
  maxToolCalls: 32,
  maxTotalTokens: 200_000,
};

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
      this.#limits.maxTotalTokens < 1
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
      const priorEvents = await this.options.sessionStore.read(
        request.sessionId,
      );
      assertCurrentHostRevision(priorEvents, request);
      const messages = restoreModelMessages(priorEvents);
      const tools = await this.loadSafeTools();
      const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
      const executedToolCallIds = priorToolCalls(priorEvents);
      let currentRevision = request.revision;
      let toolCallCount = 0;
      let totalTokens = 0;

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
      messages.push(
        canonicalUserMessage(request.prompt, request.attachments ?? []),
      );
      yield { type: "run.started", runId: request.runId, startedAt };

      turnLoop: for (let turn = 1; turn <= this.#limits.maxTurns; turn += 1) {
        if (controller.signal.aborted) {
          stopReason = "cancelled";
          break;
        }

        const attemptId = `${request.runId}_attempt_${turn}`;
        const messageId = `${request.runId}_assistant_${turn}`;
        const accumulator = new ModelResponseAccumulator(attemptId);
        const blockKinds = new Map<string, CanonicalContentBlock["type"]>();

        for await (const event of this.options.modelGateway.stream({
          attemptId,
          sessionId: request.sessionId,
          modelSelection: request.modelSelection,
          system:
            this.options.systemPrompt ??
            "You are the OpenDesign design agent. Use only the provided tools and respect the host-bound modification scope.",
          messages,
          tools: tools.map(toCanonicalTool),
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
        messages.push({
          role: "assistant",
          blocks: response.blocks,
          ...(response.identity === undefined
            ? {}
            : { source: response.identity }),
        });

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

        const toolCalls = response.blocks.filter(
          (
            block,
          ): block is Extract<CanonicalContentBlock, { type: "tool_call" }> =>
            block.type === "tool_call",
        );
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
            pendingTools.delete(call.toolCallId);
            yield {
              type: "tool.completed",
              runId: request.runId,
              ...completion,
            };
            messages.push({
              role: "tool",
              toolCallId: call.toolCallId,
              content: completedResult.content,
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
          code: "run_failed",
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
  const sortedEvents = sortEvents(events);
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

  const messages: CanonicalMessage[] = [];
  const requestedToolCallIds = new Set<string>();
  let resultOrder: string[] = [];
  const flushToolResults = (): void => {
    for (const toolCallId of resultOrder) {
      const terminal = terminalToolCalls.get(toolCallId);
      if (terminal === undefined) continue;
      messages.push({
        role: "tool",
        toolCallId,
        content: terminal.content,
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

function assertCurrentHostRevision(
  events: JournalEvent[],
  request: AgentRunRequest,
): void {
  const latestRevisionByDocumentId = new Map<string, number>();
  for (const event of sortEvents(events)) {
    if (event.type !== "message.user" && event.type !== "design.revision") {
      continue;
    }
    const payload = event.payload as {
      documentId?: unknown;
      revision?: unknown;
    };
    if (
      typeof payload.documentId !== "string" ||
      typeof payload.revision !== "number" ||
      !Number.isInteger(payload.revision)
    ) {
      continue;
    }
    latestRevisionByDocumentId.set(
      payload.documentId,
      Math.max(
        latestRevisionByDocumentId.get(payload.documentId) ?? 0,
        payload.revision,
      ),
    );
  }

  const latestRevision = latestRevisionByDocumentId.get(request.documentId);
  if (latestRevision !== undefined && request.revision < latestRevision) {
    throw new RangeError(
      `Run revision ${request.revision} is stale; latest document revision is ${latestRevision}`,
    );
  }
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
