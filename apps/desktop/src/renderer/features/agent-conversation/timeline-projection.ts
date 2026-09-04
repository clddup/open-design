import type {
  AgentEvent,
  AgentToolFailureDetails,
  AssistantTimelineBlock,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { AppLocale } from "@/shared/i18n/locale";
import { parseDesignStepProgressMessage } from "@/shared/design-step-progress";
import {
  latestDeliveryLedger,
  projectDurableDesignSteps,
} from "./timeline-design-delivery";
import { createPlanExecutionStateProjector } from "./timeline-plan-status";
import {
  designPlanTimelineTitle,
  projectDesignPlanTimeline,
} from "./timeline-plan-projection";
import {
  approvalDecisionKey,
  eventTime,
  friendlyAgentError,
  isNativeDesignTool,
  isRoutineRecoverableToolFailure,
  runFailurePresentation,
  structuredToolFailureDetail,
  toolFailureTitle,
  toolTitle,
} from "./timeline-presentation";
import type {
  AgentAssistantBlock,
  AgentTimelineItem,
  Translate,
} from "./timeline-types";
export { latestDeliveryLedger } from "./timeline-design-delivery";
export interface AgentTimelineProjectionInput {
  activeRunId: string | null;
  events: readonly AgentEvent[];
  locale: AppLocale;
  stoppingRunId: string | null;
  timeline: readonly SessionTimelineItem[];
  t: Translate;
}

export interface AgentTimelineProjection {
  activePlan: AgentTimelineItem | null;
  items: AgentTimelineItem[];
}

/**
 * Active task state is spatially separate from the immutable Conversation
 * journal. Historical Plans stay in the journal; only the latest Plan owned by
 * the running task is projected into the fixed task surface.
 */
export function projectAgentTimelineView(
  input: AgentTimelineProjectionInput,
): AgentTimelineProjection {
  const projected = projectAgentTimeline(input);
  const activePlan = input.activeRunId
    ? ([...projected]
        .reverse()
        .find(
          (item) => item.kind === "plan" && item.runId === input.activeRunId,
        ) ?? null)
    : null;
  return {
    activePlan,
    items: activePlan
      ? projected.filter(
          (item) =>
            item.id !== activePlan.id &&
            !(
              item.runId === input.activeRunId &&
              item.id.startsWith("design-step:")
            ),
        )
      : projected,
  };
}

export function projectAgentTimeline({
  activeRunId,
  events,
  locale,
  stoppingRunId,
  timeline,
  t,
}: AgentTimelineProjectionInput): AgentTimelineItem[] {
  const durable = projectDurableTimeline(
    timeline,
    activeRunId,
    locale,
    stoppingRunId,
    t,
  );
  durable.push(...projectDurablePlans(timeline, t));
  durable.push(...projectDurableDesignSteps(timeline, t));
  const runOrder = new Map<string, number>();
  const recordRun = (runId: string | undefined) => {
    if (runId && !runOrder.has(runId)) runOrder.set(runId, runOrder.size);
  };
  [...timeline]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((item) => recordRun(item.runId));
  events.forEach((event) => {
    recordRun("runId" in event ? event.runId : undefined);
    if (event.type === "run.continuation") recordRun(event.nextRunId);
  });
  const maximumSequence = durable.reduce(
    (maximum, item) => Math.max(maximum, item.order),
    0,
  );
  const merged = new Map(durable.map((item) => [item.id, item]));
  for (const item of projectLiveEvents(
    events,
    maximumSequence,
    locale,
    stoppingRunId,
    t,
  )) {
    const durableItem = merged.get(item.id);
    if (isAssistantItem(durableItem) && isAssistantItem(item)) {
      merged.set(item.id, mergeAssistantProjection(durableItem, item));
      continue;
    }
    merged.set(item.id, {
      ...item,
      order: durableItem?.order ?? item.order,
    });
  }
  const latestRunId = [...runOrder.keys()].at(-1);
  const projectPlanExecutionState = createPlanExecutionStateProjector({
    events,
    timeline,
  });
  const normalized = [...merged.values()].map((item) => {
    if (item.kind === "plan" && item.plan && item.runId) {
      const delivery = latestDeliveryLedger(timeline, events, item.runId);
      return {
        ...item,
        plan: projectPlanExecutionState({
          ...(delivery ? { delivery } : {}),
          plan: item.plan,
          planOrder: item.order,
          ...(item.toolCallId ? { planToolCallId: item.toolCallId } : {}),
          runId: item.runId,
        }),
      };
    }
    if (
      item.runId === stoppingRunId &&
      (item.state === "active" || item.state === "queued")
    ) {
      return { ...item, state: "stopping" as const };
    }
    if (
      item.runId &&
      item.runId !== activeRunId &&
      (item.state === "active" ||
        item.state === "queued" ||
        item.state === "stopping")
    ) {
      return finalizeTimelineActivity(item);
    }
    if (
      item.kind === "run" &&
      item.state === "error" &&
      item.runId !== latestRunId
    ) {
      return {
        ...item,
        state: "done" as const,
        historical: true,
        title: t("agent.previousRunFailed"),
      };
    }
    if (
      item.kind === "run" &&
      item.state === "done" &&
      item.runId !== latestRunId
    ) {
      return { ...item, routine: true };
    }
    return item;
  });
  const withoutTerminalDuplicates =
    collapseTerminalFailureDuplicates(normalized);
  const ordered = collapseRecoverableFailures(
    withoutTerminalDuplicates,
    activeRunId,
    t,
  )
    .filter((item) => !item.routine)
    .sort((left, right) => {
      const leftRunOrder = left.runId ? runOrder.get(left.runId) : undefined;
      const rightRunOrder = right.runId ? runOrder.get(right.runId) : undefined;
      if (
        leftRunOrder !== undefined &&
        rightRunOrder !== undefined &&
        leftRunOrder !== rightRunOrder
      ) {
        return leftRunOrder - rightRunOrder;
      }
      if (left.runId && left.runId === right.runId) {
        if (left.kind === "user" && right.kind === "run") return -1;
        if (left.kind === "run" && right.kind === "user") return 1;
      }
      return left.order - right.order || left.id.localeCompare(right.id);
    });
  return ordered;
}

function mergeAssistantProjection(
  durable: AgentTimelineItem & { kind: "assistant" },
  live: AgentTimelineItem & { kind: "assistant" },
): AgentTimelineItem {
  const remainingDurable = [...(durable.assistantBlocks ?? [])];
  const mergedBlocks = (live.assistantBlocks ?? []).flatMap((block) => {
    const matching = remainingDurable.filter(
      (candidate) =>
        candidate.blockId === block.blockId ||
        candidate.blockId.startsWith(`${block.blockId}_part_`),
    );
    matching.forEach((candidate) => {
      const index = remainingDurable.indexOf(candidate);
      if (index >= 0) remainingDurable.splice(index, 1);
    });
    return matching.map((candidate) => candidate.content).join("").length >=
      block.content.length
      ? matching
      : [block];
  });
  mergedBlocks.push(...remainingDurable);
  mergedBlocks.sort((left, right) => left.blockIndex - right.blockIndex);
  return {
    ...durable,
    assistantBlocks: mergedBlocks,
    routine: mergedBlocks.length === 0,
    state: live.state === "active" ? "active" : durable.state,
  };
}

function isAssistantItem(
  item: AgentTimelineItem | undefined,
): item is AgentTimelineItem & { kind: "assistant" } {
  return item?.kind === "assistant";
}

function collapseRecoverableFailures(
  items: readonly AgentTimelineItem[],
  activeRunId: string | null,
  t: Translate,
): AgentTimelineItem[] {
  const failuresByRun = new Map<string, AgentTimelineItem[]>();
  for (const item of items) {
    if (!item.recoverableFailure || !item.runId) continue;
    const failures = failuresByRun.get(item.runId) ?? [];
    failures.push(item);
    failuresByRun.set(item.runId, failures);
  }
  const visible = items.filter((item) => !item.recoverableFailure);
  for (const [runId, failures] of failuresByRun) {
    const orderedFailures = [...failures].sort(
      (left, right) => left.order - right.order,
    );
    const firstFailure = orderedFailures[0];
    const lastFailure = orderedFailures.at(-1);
    if (!firstFailure || !lastFailure) continue;
    const recovered = items.some(
      (item) =>
        item.runId === runId &&
        item.order > lastFailure.order &&
        ((item.kind === "tool" &&
          item.state === "done" &&
          item.revision !== undefined) ||
          item.id.startsWith("design-step:") ||
          item.id.startsWith("design-revision:")),
    );
    const terminal = items.some(
      (item) =>
        item.runId === runId && item.kind === "run" && item.state !== "active",
    );
    const active = runId === activeRunId && !recovered && !terminal;
    visible.push({
      id: `design-recovery:${runId}`,
      runId,
      // Keep the recovery record where its first event occurred. Later retries
      // update this stable item instead of moving it through the Conversation.
      order: firstFailure.order,
      state: active ? "active" : "done",
      kind: "system",
      time: firstFailure.time,
      title: active
        ? t("agent.correctingDesign", { count: orderedFailures.length })
        : recovered
          ? t("agent.designCorrectionResolved", {
              count: orderedFailures.length,
            })
          : t("agent.designCorrectionRecorded", {
              count: orderedFailures.length,
            }),
    });
  }
  return visible;
}

function collapseTerminalFailureDuplicates(
  items: readonly AgentTimelineItem[],
): AgentTimelineItem[] {
  const terminalFailureByRun = new Map<
    string,
    { code: string; message: string }
  >();
  for (const item of items) {
    if (
      item.kind === "run" &&
      item.state === "error" &&
      item.runId &&
      item.failureCode &&
      item.failureMessage
    ) {
      terminalFailureByRun.set(item.runId, {
        code: item.failureCode,
        message: item.failureMessage,
      });
    }
  }
  return items.filter((item) => {
    if (
      item.kind !== "tool" ||
      item.state !== "error" ||
      item.recoverableFailure ||
      !item.runId ||
      !item.failureCode ||
      !item.failureMessage
    ) {
      return true;
    }
    const terminal = terminalFailureByRun.get(item.runId);
    return !(
      terminal?.code === item.failureCode &&
      terminal.message === item.failureMessage
    );
  });
}

function isDesignCorrectionFailure(
  code: string,
  details?: AgentToolFailureDetails,
): boolean {
  return (
    !code.startsWith("renderer_") &&
    (code.startsWith("design") ||
      isRoutineRecoverableToolFailure(code, details))
  );
}

export function timelineRenderMarker(
  items: readonly AgentTimelineItem[],
): string {
  return items
    .map(
      (item) =>
        `${item.id}:${item.state}:${item.title.length}:${item.detail?.length ?? 0}:${item.assistantBlocks?.map((block) => `${block.blockId}:${block.state}:${block.content.length}`).join(",") ?? ""}:${item.plan?.status ?? ""}:${item.plan?.targets.map((target) => `${target.status ?? ""}:${target.implementationSteps.map((step) => step.status).join(";")}`).join(",") ?? ""}`,
    )
    .join("|");
}

function projectDurableTimeline(
  timeline: readonly SessionTimelineItem[],
  activeRunId: string | null,
  locale: AppLocale,
  stoppingRunId: string | null,
  t: Translate,
): AgentTimelineItem[] {
  const cancelledRunIds = new Set(
    timeline.flatMap((item) =>
      item.type === "run" && item.status === "cancelled" ? [item.runId] : [],
    ),
  );
  const continuationByRunId = new Map(
    timeline.flatMap((item) =>
      item.type === "run" && item.continuation
        ? [[item.runId, item.continuation] as const]
        : [],
    ),
  );
  const runsWithConcreteActivity = new Set(
    timeline.flatMap((item) =>
      item.runId && (item.type === "assistant.message" || item.type === "tool")
        ? [item.runId]
        : [],
    ),
  );
  const runsWithCommittedDesign = new Set(
    timeline.flatMap((item) =>
      item.runId &&
      (item.type === "design.revision" ||
        (item.type === "tool" && item.revision !== undefined))
        ? [item.runId]
        : [],
    ),
  );
  const visibleTimeline = timeline.filter(
    (item) =>
      !(
        item.type === "tool" &&
        item.status === "failed" &&
        item.error?.code === "run_cancelled" &&
        item.runId !== undefined &&
        cancelledRunIds.has(item.runId)
      ),
  );
  return visibleTimeline.map((item) => {
    const base = {
      id:
        item.type === "tool"
          ? timelineToolId(item.runId, item.toolCallId)
          : item.itemId,
      ...(item.runId === undefined ? {} : { runId: item.runId }),
      order: item.sequence,
      time: eventTime(item.updatedAt, locale, t),
    };
    if (item.type === "user.message") {
      const continuation = item.runId
        ? continuationByRunId.get(item.runId)
        : undefined;
      if (continuation) {
        return {
          ...base,
          routine: item.runId === stoppingRunId,
          state: "done",
          kind: "system",
          title: `${t("agent.reconnecting", {
            attempt: continuation.attempt,
            total: continuation.maxAttempts,
          })} · ${t("agent.workingDesign")}`,
        };
      }
      return {
        ...base,
        state: "done",
        kind: "user",
        title: t("agent.you"),
        detail: item.content,
        ...(item.attachments === undefined
          ? {}
          : { attachments: item.attachments }),
      };
    }
    if (item.type === "assistant.message") {
      const assistantBlocks = projectAssistantBlocks(item.blocks, "done");
      return {
        ...base,
        routine: assistantBlocks.length === 0,
        state: "done",
        kind: "assistant",
        title: t("agent.response"),
        assistantBlocks,
      };
    }
    if (item.type === "tool") {
      const state =
        item.status === "failed"
          ? "error"
          : item.status === "completed"
            ? "done"
            : item.status === "running"
              ? "active"
              : "queued";
      const detail = item.error?.message
        ? structuredToolFailureDetail(
            item.error.code,
            item.error.message,
            item.error.details,
            t,
          )
        : state === "done" || isNativeDesignTool(item.toolName)
          ? undefined
          : item.progressMessage;
      const routineRecoverableFailure =
        item.status === "failed" &&
        item.error?.message !== undefined &&
        isRoutineRecoverableToolFailure(item.error.code, item.error.details);
      return {
        ...base,
        recoverableFailure:
          item.status === "failed" &&
          item.error?.recoverable === true &&
          (isNativeDesignTool(item.toolName) ||
            isDesignCorrectionFailure(item.error.code, item.error.details)),
        ...(item.error?.code ? { failureCode: item.error.code } : {}),
        ...(item.error?.message ? { failureMessage: item.error.message } : {}),
        routine:
          routineRecoverableFailure ||
          ((state === "active" || state === "queued") &&
            item.runId !== activeRunId),
        state,
        kind: "tool",
        ...(item.revision === undefined ? {} : { revision: item.revision }),
        toolName: item.toolName,
        title:
          state === "error"
            ? toolFailureTitle(item.error?.code ?? "tool_error", t)
            : toolTitle(item.toolName, state, t),
        ...(detail ? { detail } : {}),
      };
    }
    if (item.type === "approval") {
      let toolName: string | undefined;
      for (const candidate of timeline) {
        if (
          candidate.type === "tool" &&
          candidate.toolCallId === item.toolCallId
        ) {
          toolName = candidate.toolName;
          break;
        }
      }
      return {
        ...base,
        routine: item.status === "requested" && item.runId !== activeRunId,
        state: item.status === "requested" ? "queued" : "done",
        kind: "approval",
        approvalId: item.approvalId,
        toolCallId: item.toolCallId,
        ...(toolName ? { toolName } : {}),
        title: item.title,
        detail:
          item.status === "requested"
            ? item.summary
            : item.decision
              ? t("agent.approvalDecision", {
                  decision: t(approvalDecisionKey(item.decision)),
                })
              : t("agent.approvalResolved"),
      };
    }
    if (item.type === "design.revision") {
      return {
        ...base,
        revision: item.revision,
        routine: true,
        state: "done",
        kind: "tool",
        title: t("agent.designRevisionApplied"),
        detail: t("agent.revisionTransition", {
          previous: item.previousRevision,
          revision: item.revision,
        }),
      };
    }
    const state =
      item.status === "started"
        ? "active"
        : item.status === "error" || item.status === "budget"
          ? "error"
          : "done";
    const failurePresentation =
      item.status === "error"
        ? runFailurePresentation(
            item.failure,
            item.failure?.message ?? t("agent.tryAgain"),
            locale,
            t,
          )
        : undefined;
    return {
      ...base,
      state,
      kind: "run",
      routine:
        item.status === "completed" ||
        item.continuation !== undefined ||
        (item.status === "started" &&
          (item.runId !== activeRunId ||
            runsWithConcreteActivity.has(item.runId))),
      time: eventTime(item.finishedAt ?? item.startedAt, locale, t),
      title:
        item.status === "started"
          ? item.continuation
            ? `${t("agent.reconnecting", {
                attempt: item.continuation.attempt,
                total: item.continuation.maxAttempts,
              })} · ${t("agent.workingDesign")}`
            : t("agent.workingDesign")
          : item.status === "completed"
            ? t("agent.taskCompleted")
            : item.status === "error" &&
                item.failure === undefined &&
                runsWithCommittedDesign.has(item.runId)
              ? t("agent.runPhase.partial")
              : item.status === "cancelled"
                ? t("agent.taskStopped")
                : item.status === "budget"
                  ? t("agent.contextLimit")
                  : (failurePresentation?.title ?? t("agent.taskFailed")),
      detail:
        item.status === "started"
          ? undefined
          : item.status === "error" &&
              item.failure === undefined &&
              runsWithCommittedDesign.has(item.runId)
            ? t("agent.runPhaseDetail.partial")
            : item.status === "cancelled"
              ? t("agent.requestCancelled")
              : item.status === "budget"
                ? t("agent.contextLimitDetail")
                : item.status === "error"
                  ? (failurePresentation?.detail ?? t("agent.tryAgain"))
                  : undefined,
      ...(item.failure?.code ? { failureCode: item.failure.code } : {}),
      ...(item.failure?.message
        ? { failureMessage: item.failure.message }
        : {}),
    };
  });
}

function projectLiveEvents(
  events: readonly AgentEvent[],
  startOrder: number,
  locale: AppLocale,
  stoppingRunId: string | null,
  t: Translate,
): AgentTimelineItem[] {
  const items = new Map<string, AgentTimelineItem>();
  const update = (
    id: string,
    order: number,
    value: Omit<AgentTimelineItem, "id" | "order">,
    replaceOrder = false,
  ) => {
    const existing = items.get(id);
    items.set(id, {
      ...existing,
      id,
      order: replaceOrder ? order : (existing?.order ?? order),
      ...value,
    });
  };
  const hideGenericRunStatus = (runId: string) => {
    const run = items.get(`run:${runId}`);
    if (run?.state === "active") items.set(run.id, { ...run, routine: true });
  };
  const finalizeRunActivity = (runId: string) => {
    items.forEach((item, itemId) => {
      if (
        item.runId === runId &&
        (item.state === "active" ||
          item.state === "queued" ||
          item.state === "stopping")
      ) {
        items.set(itemId, finalizeTimelineActivity(item));
      }
    });
  };

  events.forEach((event, index) => {
    const order = startOrder + index + 1;
    const runId = "runId" in event ? event.runId : undefined;
    const updateEvent = (
      id: string,
      value: Omit<AgentTimelineItem, "id" | "order">,
    ) => update(id, order, { ...value, ...(runId ? { runId } : {}) });
    if (event.type === "agent.ready") {
      updateEvent("runtime:ready", {
        routine: true,
        state: "done",
        time: t("common.ready"),
        title: t("agent.runtimeStarting"),
        detail: t("agent.runtimeDetail", {
          runtime: event.runtimeVersion,
          protocol: event.protocolVersion,
        }),
      });
    }
    if (event.type === "agent.connected") {
      updateEvent("runtime:connected", {
        routine: true,
        state: "done",
        time: t("common.online"),
        title: t("agent.handshakeCompleted"),
        detail: t("agent.protocolReady", { protocol: event.protocolVersion }),
      });
    }
    if (event.type === "agent.error") {
      const failure = runFailurePresentation(
        event.failure,
        event.message,
        locale,
        t,
      );
      const id = event.runId
        ? `run-error:${event.runId}:${order}`
        : `runtime:error:${event.requestId ?? event.code}`;
      update(
        id,
        order,
        {
          ...(event.runId ? { runId: event.runId } : {}),
          routine: false,
          state: "error",
          kind: "system",
          time: t("common.error"),
          title: event.runId ? failure.title : t("agent.agentUnavailable"),
          detail: event.runId
            ? failure.detail
            : friendlyAgentError(
                event.message,
                t,
                event.failure?.code ?? event.code,
              ),
          ...(event.failure?.code
            ? { failureCode: event.failure.code }
            : { failureCode: event.code }),
          failureMessage: event.failure?.message ?? event.message,
        },
        Boolean(event.runId),
      );
    }
    if (event.type === "run.started") {
      if (event.continuation && event.runId === stoppingRunId) return;
      updateEvent(
        event.continuation
          ? `continuation:${event.runId}`
          : `run:${event.runId}`,
        {
          state: "active",
          kind: "run",
          time: eventTime(event.startedAt, locale, t),
          title: event.continuation
            ? `${t("agent.reconnecting", {
                attempt: event.continuation.attempt,
                total: event.continuation.maxAttempts,
              })} · ${t("agent.workingDesign")}`
            : t("agent.workingDesign"),
        },
      );
    }
    if (event.type === "run.continuation") {
      if (event.nextRunId === stoppingRunId) return;
      update(
        event.nextRunId
          ? `continuation:${event.nextRunId}`
          : `continuation:${event.runId}:needs-attention`,
        order,
        {
          runId: event.nextRunId ?? event.runId,
          state: event.status === "scheduled" ? "active" : "error",
          kind: "system",
          time: t("common.now"),
          title:
            event.status === "scheduled"
              ? `${t("agent.reconnecting", {
                  attempt: event.attempt,
                  total: event.maxAttempts,
                })} · ${t("agent.workingDesign")}`
              : t("agent.requestFailed"),
        },
      );
    }
    if (event.type === "model.retrying") {
      if (event.runId === stoppingRunId) return;
      updateEvent(`model-retry:${event.runId}`, {
        state: "active",
        kind: "system",
        time: t("common.now"),
        title: t("agent.reconnecting", {
          attempt: event.retry,
          total: event.maxRetries,
        }),
      });
    }
    if (event.type === "model.recovered") {
      if (event.runId === stoppingRunId) return;
      updateEvent(`model-retry:${event.runId}`, {
        routine: true,
        state: "done",
        kind: "system",
        time: t("common.done"),
        title: t("agent.connectionRecovered"),
      });
    }
    if (event.type === "message.delta") {
      hideGenericRunStatus(event.runId);
      const id = `message:${event.messageId}`;
      const existing = items.get(id);
      const assistantBlocks = appendAssistantBlockDelta(
        existing?.assistantBlocks ?? [],
        event,
      );
      updateEvent(id, {
        routine: false,
        state: "active",
        kind: "assistant",
        time: t("common.now"),
        title: t("agent.response"),
        assistantBlocks,
      });
    }
    if (event.type === "message.completed") {
      hideGenericRunStatus(event.runId);
      const existing = items.get(`message:${event.messageId}`);
      const completedBlocks = projectAssistantBlocks(event.blocks, "done");
      const assistantBlocks =
        completedBlocks.length > 0
          ? completedBlocks
          : (existing?.assistantBlocks ?? []).map((block) => ({
              ...block,
              state: "done" as const,
            }));
      updateEvent(`message:${event.messageId}`, {
        routine: assistantBlocks.length === 0,
        state: "done",
        kind: "assistant",
        time: t("common.now"),
        title: t("agent.response"),
        assistantBlocks,
      });
    }
    if (event.type === "tool.requested") {
      hideGenericRunStatus(event.runId);
      updateEvent(timelineToolId(event.runId, event.toolCallId), {
        state: "active",
        kind: "tool",
        toolName: event.toolName,
        time: t("common.now"),
        title: toolTitle(event.toolName, "active", t),
      });
    }
    if (event.type === "tool.progress") {
      const toolId = timelineToolId(event.runId, event.toolCallId);
      const existing = items.get(toolId);
      const committedDesignStep = parseDesignStepProgressMessage(event.message);
      updateEvent(toolId, {
        state: "active",
        kind: "tool",
        time: `${Math.round(event.progress * 100)}%`,
        title: existing?.title ?? t("agent.applyingChange"),
        detail: committedDesignStep
          ? committedDesignStep.label
          : isNativeDesignTool(existing?.toolName)
            ? undefined
            : friendlyAgentError(event.message, t),
      });
      if (committedDesignStep) {
        updateEvent(
          `design-step:${event.toolCallId}:${committedDesignStep.revision}`,
          {
            state: "done",
            kind: "system",
            toolCallId: event.toolCallId,
            revision: committedDesignStep.revision,
            time: t("common.done"),
            title: committedDesignStep.label,
          },
        );
      }
    }
    if (event.type === "tool.completed") {
      const toolId = timelineToolId(event.runId, event.toolCallId);
      const existing = items.get(toolId);
      updateEvent(toolId, {
        state: "done",
        kind: "tool",
        detail: undefined,
        ...(event.revision === undefined ? {} : { revision: event.revision }),
        time: t("common.done"),
        title: toolTitle(existing?.toolName ?? "", "done", t),
      });
      const plan = projectDesignPlanTimeline(
        existing?.toolName,
        event.result,
        t,
      );
      if (plan) {
        update(
          `plan:${event.toolCallId}`,
          order + 0.1,
          {
            runId: event.runId,
            state: "done",
            kind: "plan",
            toolCallId: event.toolCallId,
            time: t("common.done"),
            title: designPlanTimelineTitle(plan, t),
            plan,
          },
          true,
        );
      }
    }
    if (event.type === "tool.failed") {
      if (event.code === "run_cancelled") return;
      const toolId = timelineToolId(event.runId, event.toolCallId);
      const existingTool = items.get(toolId);
      const routine = isRoutineRecoverableToolFailure(
        event.code,
        event.details,
      );
      updateEvent(toolId, {
        routine,
        recoverableFailure:
          event.recoverable === true &&
          (isNativeDesignTool(existingTool?.toolName) ||
            isDesignCorrectionFailure(event.code, event.details)),
        failureCode: event.code,
        failureMessage: event.message,
        state: "error",
        kind: "tool",
        time: t("common.error"),
        title: toolFailureTitle(event.code, t),
        detail: structuredToolFailureDetail(
          event.code,
          event.message,
          event.details,
          t,
        ),
      });
    }
    if (event.type === "approval.requested") {
      const tool = items.get(timelineToolId(event.runId, event.toolCallId));
      updateEvent(`approval:${event.approvalId}`, {
        state: "queued",
        kind: "approval",
        approvalId: event.approvalId,
        toolCallId: event.toolCallId,
        ...(tool?.toolName ? { toolName: tool.toolName } : {}),
        time: t("common.review"),
        title: event.title,
        detail: event.summary,
      });
    }
    if (event.type === "approval.resolved") {
      const existing = items.get(`approval:${event.approvalId}`);
      updateEvent(`approval:${event.approvalId}`, {
        state: "done",
        kind: "approval",
        time: eventTime(event.resolvedAt, locale, t),
        title: existing?.title ?? t("agent.approvalResolved"),
        detail: t("agent.approvalDecision", {
          decision: t(approvalDecisionKey(event.decision)),
        }),
      });
    }
    if (event.type === "run.completed") {
      finalizeRunActivity(event.runId);
      const runErrors = [...items.values()]
        .filter(
          (item) =>
            item.runId === event.runId && item.id.startsWith("run-error:"),
        )
        .sort((left, right) => left.order - right.order);
      const terminalAgentError = runErrors.at(-1);
      if (event.stopReason !== "complete") {
        runErrors.forEach((item) => items.delete(item.id));
      }
      const terminalToolFailure = [...items.values()]
        .filter(
          (item) =>
            item.runId === event.runId &&
            item.kind === "tool" &&
            item.state === "error" &&
            !item.recoverableFailure,
        )
        .sort((left, right) => left.order - right.order)
        .at(-1);
      const failed =
        event.stopReason === "error" || event.stopReason === "budget";
      update(
        `run:${event.runId}`,
        order,
        {
          runId: event.runId,
          state: failed ? "error" : "done",
          kind: "run",
          routine: event.stopReason === "complete",
          time: eventTime(event.finishedAt, locale, t),
          title:
            event.stopReason === "complete"
              ? t("agent.taskCompleted")
              : event.stopReason === "cancelled"
                ? t("agent.taskStopped")
                : event.stopReason === "budget"
                  ? t("agent.contextLimit")
                  : terminalAgentError
                    ? terminalAgentError.title
                    : t("agent.taskFailed"),
          detail:
            event.stopReason === "complete"
              ? undefined
              : event.stopReason === "cancelled"
                ? t("agent.requestCancelled")
                : event.stopReason === "budget"
                  ? t("agent.contextLimitDetail")
                  : terminalAgentError
                    ? terminalAgentError.detail
                    : t("agent.tryAgain"),
          ...((terminalAgentError?.failureCode ??
          terminalToolFailure?.failureCode)
            ? {
                failureCode:
                  terminalAgentError?.failureCode ??
                  terminalToolFailure?.failureCode,
              }
            : {}),
          ...((terminalAgentError?.failureMessage ??
          terminalToolFailure?.failureMessage)
            ? {
                failureMessage:
                  terminalAgentError?.failureMessage ??
                  terminalToolFailure?.failureMessage,
              }
            : {}),
        },
        true,
      );
    }
  });
  return [...items.values()];
}

function timelineToolId(runId: string | undefined, toolCallId: string): string {
  return `tool:${runId ?? "unknown-run"}:${toolCallId}`;
}

function projectAssistantBlocks(
  blocks: readonly AssistantTimelineBlock[],
  state: AgentAssistantBlock["state"],
): AgentAssistantBlock[] {
  const projected: AgentAssistantBlock[] = [];
  blocks.forEach((block, blockIndex) => {
    if (block.type === "text" && block.text.length > 0) {
      projected.push({
        blockId: block.blockId,
        blockIndex,
        type: "text",
        content: block.text,
        state,
      });
      return;
    }
    if (
      block.type === "reasoning_summary" &&
      block.status === "completed" &&
      block.summary
    ) {
      projected.push({
        blockId: block.blockId,
        blockIndex,
        type: "reasoning_summary",
        content: block.summary,
        state,
      });
    }
  });
  return projected;
}

function appendAssistantBlockDelta(
  blocks: readonly AgentAssistantBlock[],
  event: Extract<AgentEvent, { type: "message.delta" }>,
): AgentAssistantBlock[] {
  const existing = blocks.find((block) => block.blockId === event.blockId);
  const next = existing
    ? blocks.map((block) =>
        block.blockId === event.blockId
          ? { ...block, content: `${block.content}${event.delta}` }
          : block,
      )
    : [
        ...blocks,
        {
          blockId: event.blockId,
          blockIndex: event.blockIndex,
          type: event.blockType,
          content: event.delta,
          state: "active" as const,
        },
      ];
  return next.sort(
    (left, right) =>
      left.blockIndex - right.blockIndex ||
      left.blockId.localeCompare(right.blockId),
  );
}

function projectDurablePlans(
  timeline: readonly SessionTimelineItem[],
  t: Translate,
): AgentTimelineItem[] {
  return timeline.flatMap((item) => {
    if (item.type !== "tool" || item.status !== "completed") return [];
    const plan = projectDesignPlanTimeline(item.toolName, item.result, t);
    if (!plan) return [];
    return [
      {
        id: `plan:${item.toolCallId}`,
        ...(item.runId ? { runId: item.runId } : {}),
        order: item.sequence + 0.1,
        state: "done" as const,
        kind: "plan" as const,
        toolCallId: item.toolCallId,
        time: t("common.done"),
        title: designPlanTimelineTitle(plan, t),
        plan,
      },
    ];
  });
}

function finalizeTimelineActivity(item: AgentTimelineItem): AgentTimelineItem {
  return {
    ...item,
    state: "done",
    ...(item.kind === "assistant" ? {} : { routine: true }),
  };
}
