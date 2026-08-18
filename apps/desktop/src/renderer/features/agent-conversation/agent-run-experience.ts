import type {
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
} from "../../../shared/design-agent-tools";
import type { MessageKey } from "../../../shared/i18n/messages";
import { latestDeliveryLedger } from "./timeline-design-delivery";
import { isRoutineRecoverableToolFailure } from "./timeline-presentation";

export type AgentRunExperiencePhase =
  | "waiting-model"
  | "creating-artboards"
  | "artboards-ready"
  | "first-content"
  | "reviewing"
  | "refining"
  | "stopping"
  | "complete"
  | "partial"
  | "stopped"
  | "failed";

export type AgentRunExperience = {
  phase: AgentRunExperiencePhase;
  runId: string | null;
  startedAt?: string;
  active: boolean;
  hasCanvasChanges: boolean;
  hasEditableContent: boolean;
  partialWorkPreserved: boolean;
  recoverableFailureCount: number;
  allocatedTargetCount: number;
  verifiedTargetCount: number;
  totalTargetCount: number;
  activeTargetLabel?: string;
};

export function agentRunPhaseTitleKey(
  phase: AgentRunExperiencePhase,
): MessageKey {
  return `agent.runPhase.${phase}` as MessageKey;
}

export function agentRunPhaseDetailKey(
  phase: AgentRunExperiencePhase,
): MessageKey {
  return `agent.runPhaseDetail.${phase}` as MessageKey;
}

export function projectAgentRunExperience(input: {
  activeRunId: string | null;
  events: readonly AgentEvent[];
  timeline: readonly SessionTimelineItem[];
  stopping?: boolean;
  error?: string | null;
}): AgentRunExperience | null {
  const latestRun = [...input.timeline]
    .filter((item) => item.type === "run")
    .sort((left, right) => left.sequence - right.sequence)
    .at(-1);
  const runId = input.activeRunId ?? latestRun?.runId ?? null;
  const delivery = latestDeliveryLedger(input.timeline, input.events, runId);
  if (runId === null && delivery === undefined) return null;

  const timelineForRun = input.timeline.filter(
    (item) => runId === null || item.runId === runId,
  );
  const eventsForRun = input.events.filter(
    (event) => !("runId" in event) || runId === null || event.runId === runId,
  );
  const terminal = terminalRunState(runId, latestRun, eventsForRun);
  const targetStatuses = delivery?.targets.map((target) => target.status) ?? [];
  const allocatedTargetCount = targetStatuses.filter(
    (status) => status !== "pending",
  ).length;
  const verifiedTargetCount = targetStatuses.filter(
    (status) => status === "verified",
  ).length;
  const hasEditableContent = targetStatuses.some(
    (status) => status !== "pending" && status !== "allocated",
  );
  const hasRevision =
    timelineForRun.some(
      (item) =>
        item.type === "design.revision" ||
        (item.type === "tool" && item.revision !== undefined),
    ) ||
    eventsForRun.some(
      (event) =>
        (event.type === "tool.completed" && event.revision !== undefined) ||
        (event.type === "tool.progress" &&
          /^设计步骤：.+ · r\d+$/.test(event.message)),
    );
  const hasCanvasChanges = allocatedTargetCount > 0 || hasRevision;
  const activeToolNames = activeTools(timelineForRun, eventsForRun);
  const recoverableFailureCount = recoverableFailures(
    timelineForRun,
    eventsForRun,
  );
  const activeTargetLabel = delivery?.targets.find(
    (target) => target.targetId === delivery.activeTargetId,
  )?.label;
  const active = input.activeRunId !== null;
  const allVerified =
    targetStatuses.length > 0 && verifiedTargetCount === targetStatuses.length;
  const failed =
    Boolean(input.error) || terminal === "error" || terminal === "budget";
  const partialWorkPreserved = !active && failed && hasCanvasChanges;

  let phase: AgentRunExperiencePhase;
  if (active) {
    if (input.stopping) phase = "stopping";
    else if (
      activeToolNames.has(DESIGN_CAPTURE_TOOL_NAME) ||
      activeToolNames.has(DESIGN_REVIEW_TOOL_NAME)
    ) {
      phase = "reviewing";
    } else if (
      targetStatuses.some(
        (status) => status === "reviewed" || status === "refined",
      )
    ) {
      phase = "refining";
    } else if (hasEditableContent) phase = "first-content";
    else if (allocatedTargetCount > 0) phase = "artboards-ready";
    else if (activeToolNames.has(DESIGN_FIRST_SLICE_TOOL_NAME)) {
      phase = "creating-artboards";
    } else phase = "waiting-model";
  } else if (allVerified) phase = "complete";
  else if (terminal === "cancelled") phase = "stopped";
  else if (failed) phase = hasCanvasChanges ? "partial" : "failed";
  else if (hasCanvasChanges) phase = "partial";
  else return null;

  return {
    phase,
    runId,
    ...(startedAt(runId, latestRun, eventsForRun)
      ? { startedAt: startedAt(runId, latestRun, eventsForRun) }
      : {}),
    active,
    hasCanvasChanges,
    hasEditableContent,
    partialWorkPreserved,
    recoverableFailureCount,
    allocatedTargetCount,
    verifiedTargetCount,
    totalTargetCount: targetStatuses.length,
    ...(activeTargetLabel ? { activeTargetLabel } : {}),
  };
}

function activeTools(
  timeline: readonly SessionTimelineItem[],
  events: readonly AgentEvent[],
): Set<string> {
  const tools = new Map<string, string>();
  for (const item of timeline) {
    if (
      item.type === "tool" &&
      (item.status === "requested" || item.status === "running")
    ) {
      tools.set(item.toolCallId, item.toolName);
    }
  }
  for (const event of events) {
    if (event.type === "tool.requested") {
      tools.set(event.toolCallId, event.toolName);
    } else if (
      event.type === "tool.completed" ||
      event.type === "tool.failed"
    ) {
      tools.delete(event.toolCallId);
    }
  }
  return new Set(tools.values());
}

function recoverableFailures(
  timeline: readonly SessionTimelineItem[],
  events: readonly AgentEvent[],
): number {
  const failures = new Map<string, { code: string; message: string }>();
  for (const item of timeline) {
    if (item.type === "tool" && item.status === "failed" && item.error) {
      failures.set(item.toolCallId, item.error);
    }
  }
  for (const event of events) {
    if (event.type === "tool.failed") {
      failures.set(event.toolCallId, event);
    }
  }
  return [...failures.values()].filter((failure) =>
    isRoutineRecoverableToolFailure(failure.code, failure.message),
  ).length;
}

function terminalRunState(
  runId: string | null,
  latestRun: Extract<SessionTimelineItem, { type: "run" }> | undefined,
  events: readonly AgentEvent[],
): "completed" | "cancelled" | "error" | "budget" | undefined {
  const live = [...events]
    .reverse()
    .find((event) => event.type === "run.completed");
  if (live?.type === "run.completed") {
    if (live.stopReason === "complete") return "completed";
    return live.stopReason;
  }
  if (!latestRun || (runId !== null && latestRun.runId !== runId)) {
    return undefined;
  }
  if (latestRun.status === "completed") return "completed";
  if (latestRun.status === "started") return undefined;
  return latestRun.status;
}

function startedAt(
  runId: string | null,
  latestRun: Extract<SessionTimelineItem, { type: "run" }> | undefined,
  events: readonly AgentEvent[],
): string | undefined {
  const live = events.find((event) => event.type === "run.started");
  if (live?.type === "run.started") return live.startedAt;
  return latestRun && (runId === null || latestRun.runId === runId)
    ? latestRun.startedAt
    : undefined;
}
