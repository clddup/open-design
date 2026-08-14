import type {
  AgentRunFailure,
  AgentToolFailureDetails,
  AssistantTimelineBlock,
} from "@opendesign/agent-contracts";
import type { DesignDeliveryStatus } from "@opendesign/workspace-contracts";
import type { AppLocale } from "../../../shared/i18n/locale";
import type { MessageKey } from "../../../shared/i18n/messages";
import { classifyDesignWorkflowFailure } from "../../../shared/design-workflow-failure-classification";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
  DESIGN_STYLE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
} from "../../../shared/design-agent-tools";
import type { AgentTimelineItem, Translate } from "./timeline-types";

export function eventTime(
  value: string | undefined,
  locale: AppLocale,
  t: Translate,
): string {
  if (!value) return t("common.now");
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return t("common.now");
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function assistantText(blocks: AssistantTimelineBlock[]): string {
  return blocks
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

export function assistantReasoningSummary(
  blocks: AssistantTimelineBlock[],
): string {
  return blocks
    .map((block) =>
      block.type === "reasoning_summary" &&
      block.status === "completed" &&
      block.summary
        ? block.summary
            .replace(/^\s*#{1,6}\s+/gm, "")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .trim()
        : "",
    )
    .filter(Boolean)
    .join("\n");
}

export function isNativeDesignTool(toolName: string | undefined): boolean {
  return (
    toolName === DESIGN_INSPECT_TOOL_NAME ||
    toolName === DESIGN_APPLY_TOOL_NAME ||
    toolName === DESIGN_PLAN_TOOL_NAME ||
    toolName === DESIGN_REVIEW_TOOL_NAME ||
    toolName === DESIGN_ARRANGE_TOOL_NAME ||
    toolName === DESIGN_HIERARCHY_TOOL_NAME ||
    toolName === DESIGN_COMPONENT_TOOL_NAME ||
    toolName === DESIGN_VARIABLE_TOOL_NAME ||
    toolName === DESIGN_STYLE_TOOL_NAME ||
    toolName === DESIGN_PAGE_TOOL_NAME
  );
}

export function approvalDecisionKey(decision: string): MessageKey {
  if (decision === "allow_once") return "approval.allowOnce";
  if (decision === "allow_session") return "approval.allowSession";
  return "approval.deny";
}

export function friendlyAgentError(message: string, t: Translate): string {
  const workflowFailure = classifyDesignWorkflowFailure(message);
  if (workflowFailure) {
    if (workflowFailure.presentation === "capturing-canvas") {
      return t("agent.workflowCapturingCanvas");
    }
    if (workflowFailure.presentation === "repairing-components") {
      return t("agent.workflowRepairingComponents");
    }
    if (workflowFailure.presentation === "repairing-plan") {
      return t("agent.workflowRepairingPlan");
    }
    if (workflowFailure.presentation === "repairing-layout") {
      return t("agent.workflowRepairingLayout");
    }
    if (workflowFailure.presentation === "canvas-changed") {
      return t("agent.canvasChanged");
    }
    if (workflowFailure.presentation === "scope-conflict") {
      return t("agent.canvasScopeConflict");
    }
    return t("agent.workflowApplyingDraft");
  }
  if (
    /Model attempt did not complete|attempt mismatch|\b(?:run|attempt)_[A-Za-z0-9_-]+/i.test(
      message,
    )
  ) {
    return t("agent.modelInterrupted");
  }
  if (/^renderer_tool\.timeout\./i.test(message)) {
    return t("agent.canvasToolTimedOut");
  }
  if (/cancelled|canceled|aborted/i.test(message)) {
    return t("agent.requestCancelled");
  }
  return message;
}

export function runFailurePresentation(
  failure: AgentRunFailure | undefined,
  fallback: string,
  locale: AppLocale,
  t: Translate,
): { title: string; detail: string } {
  if (!failure) {
    return {
      title: t("agent.taskFailed"),
      detail: friendlyAgentError(fallback, t),
    };
  }
  const timeout = failure.timeout;
  const title = timeout
    ? timeout.phase === "first-response"
      ? t("agent.timeoutFirstResponse")
      : timeout.phase === "stream-idle"
        ? t("agent.timeoutStreamIdle")
        : t("agent.timeoutTotal")
    : failure.code === "context_budget_exceeded" ||
        failure.code === "model_context_incompatible"
      ? t("agent.contextLimit")
      : failure.code === "provider_error" ||
          failure.code === "provider_request_failed"
        ? t("agent.providerConnectionInterrupted")
        : t("agent.taskFailed");
  const primary = timeout
    ? timeout.phase === "first-response"
      ? t("agent.timeoutFirstResponseDetail", {
          duration: formatTimeoutThreshold(timeout.thresholdMs, locale),
        })
      : timeout.phase === "stream-idle"
        ? t("agent.timeoutStreamIdleDetail", {
            duration: formatTimeoutThreshold(timeout.thresholdMs, locale),
          })
        : t("agent.timeoutTotalDetail", {
            duration: formatTimeoutThreshold(timeout.thresholdMs, locale),
          })
    : friendlyAgentError(failure.message || fallback, t);
  const correlation = [
    failure.modelRequestId
      ? t("agent.modelRequestId", { id: failure.modelRequestId })
      : null,
    failure.providerRequestId
      ? t("agent.providerRequestId", { id: failure.providerRequestId })
      : timeout
        ? t("agent.providerRequestIdUnavailable")
        : null,
  ].filter((value): value is string => value !== null);
  return {
    title,
    detail: [
      primary,
      failure.retryable
        ? t("agent.failureRetryable")
        : t("agent.failureNeedsChange"),
      ...correlation,
    ].join("\n"),
  };
}

export function structuredToolFailureDetail(
  code: string,
  message: string,
  details: AgentToolFailureDetails | undefined,
  t: Translate,
): string {
  const friendly =
    code === "renderer_circuit_open"
      ? t("agent.canvasCircuitOpenDetail")
      : code === "renderer_first_response_timeout"
        ? t("agent.canvasToolFirstResponseTimeoutDetail")
        : code === "renderer_idle_timeout"
          ? t("agent.canvasToolIdleTimeoutDetail")
          : code === "renderer_capture_timeout"
            ? t("agent.canvasToolIdleTimeoutDetail")
            : code === "renderer_total_timeout"
              ? t("agent.canvasToolTotalTimeoutDetail")
              : friendlyAgentError(message, t);
  const issue = details?.issues[0];
  if (!issue) return friendly;
  const target = [
    issue.commandId ? `command ${issue.commandId}` : null,
    issue.nodeId ? `node ${issue.nodeId}` : null,
    issue.path || null,
  ].filter(Boolean);
  const retry = details.retrySuppressed
    ? t("agent.inspectRequiredBeforeRetry")
    : null;
  return [friendly, target.join(" · "), retry].filter(Boolean).join("\n");
}

export function isRecoverableDesignWorkflowFailure(message: string): boolean {
  return classifyDesignWorkflowFailure(message)?.routineRecoverable === true;
}

export function isRoutineRecoverableToolFailure(
  code: string,
  message: string,
): boolean {
  return (
    isRecoverableDesignWorkflowFailure(message) ||
    code === "invalid_tool_input" ||
    code === "design_inspection_required" ||
    code === "repeated_tool_failure" ||
    message === "Tool call was rejected before execution"
  );
}

export function toolFailureTitle(code: string, t: Translate): string {
  if (code === "renderer_circuit_open") {
    return t("agent.canvasCircuitOpen");
  }
  if (code === "renderer_first_response_timeout") {
    return t("agent.canvasToolDidNotStart");
  }
  if (code === "renderer_idle_timeout") {
    return t("agent.canvasToolStalled");
  }
  if (code === "renderer_total_timeout") {
    return t("agent.canvasToolLimitReached");
  }
  if (code === "renderer_capture_timeout") {
    return t("agent.canvasToolStalled");
  }
  return t("agent.changeFailed");
}

export function deliveryStatusKey(status: DesignDeliveryStatus): MessageKey {
  if (status === "pending") return "agent.deliveryPending";
  if (status === "allocated") return "agent.designPlanReady";
  if (status === "drafted") return "agent.deliveryDrafted";
  if (status === "captured") return "agent.deliveryCaptured";
  if (status === "reviewed") return "agent.deliveryReviewed";
  if (status === "refined") return "agent.deliveryRefined";
  return "agent.deliveryVerified";
}

export function toolTitle(
  toolName: string,
  state: AgentTimelineItem["state"],
  t: Translate,
): string {
  if (toolName === DESIGN_INSPECT_TOOL_NAME) {
    return state === "done" ? t("agent.canvasRead") : t("agent.readingCanvas");
  }
  if (toolName === DESIGN_APPLY_TOOL_NAME) {
    return state === "done"
      ? t("agent.canvasUpdated")
      : t("agent.buildingCanvas");
  }
  if (toolName === DESIGN_PLAN_TOOL_NAME) {
    return state === "done"
      ? t("agent.designPlanReady")
      : t("agent.planningDesign");
  }
  if (toolName === DESIGN_REVIEW_TOOL_NAME) {
    return state === "done"
      ? t("agent.visualReviewReady")
      : t("agent.reviewingDesign");
  }
  if (toolName === DESIGN_HIERARCHY_TOOL_NAME) {
    return state === "done"
      ? t("agent.hierarchyUpdated")
      : t("agent.organizingLayers");
  }
  if (toolName === DESIGN_COMPONENT_TOOL_NAME) {
    return state === "done"
      ? t("agent.componentsUpdated")
      : t("agent.updatingComponents");
  }
  if (toolName === DESIGN_VARIABLE_TOOL_NAME) {
    return state === "done"
      ? t("agent.variablesUpdated")
      : t("agent.updatingVariables");
  }
  if (toolName === DESIGN_STYLE_TOOL_NAME) {
    return state === "done"
      ? t("agent.stylesUpdated")
      : t("agent.updatingStyles");
  }
  if (toolName === DESIGN_ARRANGE_TOOL_NAME) {
    return state === "done"
      ? t("agent.arrangementUpdated")
      : t("agent.arrangingLayers");
  }
  if (toolName === DESIGN_PAGE_TOOL_NAME) {
    return state === "done"
      ? t("agent.pagesUpdated")
      : t("agent.updatingPages");
  }
  if (toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    return state === "done"
      ? t("agent.pageStructureAccessGranted")
      : t("agent.pageStructureAccessRequested");
  }
  return state === "done" ? t("agent.changeCompleted") : toolName;
}

function formatTimeoutThreshold(
  milliseconds: number,
  locale: AppLocale,
): string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (milliseconds >= 60_000 && milliseconds % 60_000 === 0) {
    return `${formatter.format(milliseconds / 60_000)} min`;
  }
  if (milliseconds >= 1_000) {
    return `${formatter.format(milliseconds / 1_000)} s`;
  }
  return `${formatter.format(milliseconds)} ms`;
}
