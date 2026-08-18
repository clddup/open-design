import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { AppLocale } from "../../../shared/i18n/locale";
import {
  parseCommittedDesignStep,
  projectDurableDesignSteps,
} from "./timeline-design-delivery";
import {
  approvalDecisionKey,
  assistantReasoningSummary,
  assistantText,
  eventTime,
  friendlyAgentError,
  isNativeDesignTool,
  isRoutineRecoverableToolFailure,
  runFailurePresentation,
  structuredToolFailureDetail,
  toolFailureTitle,
  toolTitle,
} from "./timeline-presentation";
import { mergeReasoningByRun } from "./timeline-reasoning";
import type { AgentTimelineItem, Translate } from "./timeline-types";
export { latestDeliveryLedger } from "./timeline-design-delivery";
export interface AgentTimelineProjectionInput {
  activeRunId: string | null;
  events: readonly AgentEvent[];
  locale: AppLocale;
  stoppingRunId: string | null;
  timeline: readonly SessionTimelineItem[];
  t: Translate;
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
  durable.push(...projectDurableDesignSteps(timeline));
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
    if (durableItem?.kind === "assistant" && durableItem.state === "done") {
      // The retained live window can begin mid-stream. A completed journal
      // message is authoritative and cannot be replaced by a suffix-only view.
      continue;
    }
    merged.set(item.id, {
      ...item,
      order: durableItem?.order ?? item.order,
    });
  }
  const latestRunId = [...runOrder.keys()].at(-1);
  const ordered = [...merged.values()]
    .map((item) => {
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
    })
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
  return mergeReasoningByRun(ordered, t);
}

export function timelineRenderMarker(
  items: readonly AgentTimelineItem[],
): string {
  return items
    .map(
      (item) =>
        `${item.id}:${item.state}:${item.title.length}:${item.detail?.length ?? 0}:${item.reasoning?.length ?? 0}`,
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
      id: item.itemId,
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
      const detail = assistantText(item.blocks);
      const reasoning = assistantReasoningSummary(item.blocks);
      const reasoningOnly = detail.length === 0 && reasoning.length > 0;
      return {
        ...base,
        routine: detail.length === 0 && reasoning.length === 0,
        state: "done",
        kind: reasoningOnly ? "reasoning" : "assistant",
        title: reasoningOnly
          ? t("agent.modelThinkingSummary")
          : t("agent.response"),
        ...(detail ? { detail } : {}),
        ...(reasoning ? { reasoning, reasoningCount: 1 } : {}),
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
        isRoutineRecoverableToolFailure(item.error.code, item.error.message);
      return {
        ...base,
        routine:
          routineRecoverableFailure ||
          ((state === "active" || state === "queued") &&
            item.runId !== activeRunId),
        state,
        kind: "tool",
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
            : item.status === "cancelled"
              ? t("agent.taskStopped")
              : item.status === "budget"
                ? t("agent.contextLimit")
                : (failurePresentation?.title ?? t("agent.taskFailed")),
      detail:
        item.status === "started"
          ? undefined
          : item.status === "cancelled"
            ? t("agent.requestCancelled")
            : item.status === "budget"
              ? t("agent.contextLimitDetail")
              : item.status === "error"
                ? (failurePresentation?.detail ?? t("agent.tryAgain"))
                : undefined,
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
  ) => {
    const existing = items.get(id);
    items.set(id, {
      ...existing,
      id,
      order: existing?.order ?? order,
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
      if (event.runId) finalizeRunActivity(event.runId);
      const failure = runFailurePresentation(
        event.failure,
        event.message,
        locale,
        t,
      );
      updateEvent(
        event.runId
          ? `run:${event.runId}`
          : `runtime:error:${event.requestId ?? event.code}`,
        {
          routine: false,
          state: "error",
          kind: event.runId ? "run" : "system",
          time: t("common.error"),
          title: event.runId ? failure.title : t("agent.agentUnavailable"),
          detail: event.runId
            ? failure.detail
            : friendlyAgentError(event.message, t),
        },
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
      updateEvent(id, {
        routine: false,
        state: "active",
        kind: "assistant",
        time: t("common.now"),
        title: t("agent.response"),
        detail: `${existing?.detail ?? ""}${event.delta}`,
      });
    }
    if (event.type === "message.completed") {
      hideGenericRunStatus(event.runId);
      const detail = assistantText(event.blocks);
      const reasoning = assistantReasoningSummary(event.blocks);
      const reasoningOnly = detail.length === 0 && reasoning.length > 0;
      updateEvent(`message:${event.messageId}`, {
        routine: detail.length === 0 && reasoning.length === 0,
        state: "done",
        kind: reasoningOnly ? "reasoning" : "assistant",
        time: t("common.now"),
        title: reasoningOnly
          ? t("agent.modelThinkingSummary")
          : t("agent.response"),
        detail: detail || undefined,
        reasoning: reasoning || undefined,
        reasoningCount: reasoning ? 1 : undefined,
      });
    }
    if (event.type === "tool.requested") {
      hideGenericRunStatus(event.runId);
      updateEvent(`tool:${event.toolCallId}`, {
        state: "active",
        kind: "tool",
        toolName: event.toolName,
        time: t("common.now"),
        title: toolTitle(event.toolName, "active", t),
      });
    }
    if (event.type === "tool.progress") {
      const existing = items.get(`tool:${event.toolCallId}`);
      const committedDesignStep = event.message.startsWith("设计步骤：")
        ? event.message.slice("设计步骤：".length)
        : undefined;
      updateEvent(`tool:${event.toolCallId}`, {
        state: "active",
        kind: "tool",
        time: `${Math.round(event.progress * 100)}%`,
        title: existing?.title ?? t("agent.applyingChange"),
        detail: committedDesignStep
          ? committedDesignStep
          : isNativeDesignTool(existing?.toolName)
            ? undefined
            : friendlyAgentError(event.message, t),
      });
      if (committedDesignStep) {
        const parsed = parseCommittedDesignStep(committedDesignStep);
        if (parsed) {
          updateEvent(`design-step:${event.toolCallId}:${parsed.revision}`, {
            state: "done",
            kind: "system",
            time: `r${parsed.revision}`,
            title: parsed.label,
          });
        }
      }
    }
    if (event.type === "tool.completed") {
      const existing = items.get(`tool:${event.toolCallId}`);
      updateEvent(`tool:${event.toolCallId}`, {
        state: "done",
        kind: "tool",
        detail: undefined,
        time:
          event.revision === undefined
            ? t("common.done")
            : `r${event.revision}`,
        title: toolTitle(existing?.toolName ?? "", "done", t),
      });
    }
    if (event.type === "tool.failed") {
      if (event.code === "run_cancelled") return;
      const routine = isRoutineRecoverableToolFailure(
        event.code,
        event.message,
      );
      updateEvent(`tool:${event.toolCallId}`, {
        routine,
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
      const tool = items.get(`tool:${event.toolCallId}`);
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
      const existing = items.get(`run:${event.runId}`);
      const failed =
        event.stopReason === "error" || event.stopReason === "budget";
      updateEvent(`run:${event.runId}`, {
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
                : existing?.state === "error"
                  ? existing.title
                  : t("agent.taskFailed"),
        detail:
          event.stopReason === "complete"
            ? undefined
            : event.stopReason === "cancelled"
              ? t("agent.requestCancelled")
              : event.stopReason === "budget"
                ? t("agent.contextLimitDetail")
                : existing?.state === "error"
                  ? existing.detail
                  : t("agent.tryAgain"),
      });
    }
  });
  return [...items.values()];
}

function finalizeTimelineActivity(item: AgentTimelineItem): AgentTimelineItem {
  return {
    ...item,
    state: "done",
    ...(item.kind === "assistant" ? {} : { routine: true }),
  };
}
