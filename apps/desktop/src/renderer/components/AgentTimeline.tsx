import type {
  AgentAttachment,
  AgentEvent,
  AssistantTimelineBlock,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import { MAX_AGENT_ATTACHMENTS } from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import { Button, DesktopSelect, Glyph, IconButton } from "@opendesign/ui";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import type {
  ModelProfile,
  ModelProviderCatalog,
  ModelProviderProfile,
  AgentAttachmentSelection,
} from "../../shared/desktop-api";
import type { AppLocale } from "../../shared/i18n/locale";
import type { MessageKey, MessageParameters } from "../../shared/i18n/messages";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
} from "../../shared/design-agent-tools";
import { useI18n } from "../i18n";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

type TimelineItem = {
  id: string;
  runId?: string;
  kind?: "assistant" | "user" | "tool" | "run" | "approval" | "system";
  state: "done" | "active" | "stopping" | "queued" | "error";
  time: string;
  title: string;
  detail?: string;
  attachments?: AgentAttachment[];
  toolName?: string;
  routine?: boolean;
  order: number;
};

export type AgentTimelineProps = {
  events: AgentEvent[];
  timeline: SessionTimelineItem[];
  activeRunId: string | null;
  error: string | null;
  conversationId: string | null;
  conversationTitle: string | null;
  conversations?: readonly ConversationDescriptor[];
  onCreateConversation?: () => Promise<boolean>;
  onSelectConversation?: (conversationId: string) => void;
  onSubmit: (
    prompt: string,
    selection: ModelSelection,
    attachments: readonly AgentAttachment[],
  ) => Promise<boolean>;
  onStop: () => boolean | void | Promise<boolean | void>;
  scope?:
    { kind: "page"; name?: string } | { kind: "selection"; count: number };
};

function eventTime(value: string | undefined, locale: AppLocale, t: Translate) {
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

function assistantText(blocks: AssistantTimelineBlock[]): string {
  return blocks
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

function isNativeDesignTool(toolName: string | undefined): boolean {
  return (
    toolName === DESIGN_INSPECT_TOOL_NAME ||
    toolName === DESIGN_APPLY_TOOL_NAME ||
    toolName === DESIGN_PLAN_TOOL_NAME ||
    toolName === DESIGN_REVIEW_TOOL_NAME ||
    toolName === DESIGN_ARRANGE_TOOL_NAME ||
    toolName === DESIGN_HIERARCHY_TOOL_NAME
  );
}

function approvalDecisionKey(decision: string): MessageKey {
  if (decision === "allow_once") return "approval.allowOnce";
  if (decision === "allow_session") return "approval.allowSession";
  return "approval.deny";
}

function friendlyAgentError(message: string, t: Translate): string {
  if (/^design_workflow\.material_write_required:/i.test(message)) {
    return t("agent.workflowApplyingDraft");
  }
  if (
    /^design_workflow\.(?:capture_required|capture_revision_invalid):/i.test(
      message,
    )
  ) {
    return t("agent.workflowCapturingCanvas");
  }
  if (
    /Model attempt did not complete|attempt mismatch|\b(?:run|attempt)_[A-Za-z0-9_-]+/i.test(
      message,
    )
  ) {
    return t("agent.modelInterrupted");
  }
  if (/timed out|timeout/i.test(message)) return t("agent.modelTimedOut");
  if (/cancelled|canceled|aborted/i.test(message)) {
    return t("agent.requestCancelled");
  }
  if (/revision conflict|expected revision|stale revision/i.test(message)) {
    return t("agent.canvasChanged");
  }
  if (
    /targets a parent outside|exceeds the registered .* scope|outside the registered .* scope/i.test(
      message,
    )
  ) {
    return t("agent.canvasScopeConflict");
  }
  return message;
}

function isRecoverableDesignWorkflowFailure(message: string): boolean {
  return /^design_workflow\.(?:material_write_required|capture_required|capture_revision_invalid):/i.test(
    message,
  );
}

function toolTitle(
  toolName: string,
  state: TimelineItem["state"],
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
  if (toolName === DESIGN_ARRANGE_TOOL_NAME) {
    return state === "done"
      ? t("agent.arrangementUpdated")
      : t("agent.arrangingLayers");
  }
  return state === "done" ? t("agent.changeCompleted") : toolName;
}

function projectTimeline(
  timeline: SessionTimelineItem[],
  activeRunId: string | null,
  locale: AppLocale,
  t: Translate,
): TimelineItem[] {
  const runsWithConcreteActivity = new Set(
    timeline.flatMap((item) =>
      item.runId && (item.type === "assistant.message" || item.type === "tool")
        ? [item.runId]
        : [],
    ),
  );
  return timeline.map((item) => {
    const base = {
      id: item.itemId,
      ...(item.runId === undefined ? {} : { runId: item.runId }),
      order: item.sequence,
      time: eventTime(item.updatedAt, locale, t),
    };
    if (item.type === "user.message") {
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
      return {
        ...base,
        routine: detail.length === 0,
        state: "done",
        kind: "assistant",
        title: t("agent.response"),
        detail,
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
        ? friendlyAgentError(item.error.message, t)
        : state === "done" || isNativeDesignTool(item.toolName)
          ? undefined
          : item.progressMessage;
      const recoverableWorkflowFailure =
        item.status === "failed" &&
        item.error?.message !== undefined &&
        isRecoverableDesignWorkflowFailure(item.error.message);
      return {
        ...base,
        routine:
          recoverableWorkflowFailure ||
          ((state === "active" || state === "queued") &&
            item.runId !== activeRunId),
        state,
        kind: "tool",
        toolName: item.toolName,
        title:
          state === "error"
            ? t("agent.changeFailed")
            : toolTitle(item.toolName, state, t),
        ...(detail ? { detail } : {}),
      };
    }
    if (item.type === "approval") {
      return {
        ...base,
        routine: item.status === "requested" && item.runId !== activeRunId,
        state: item.status === "requested" ? "queued" : "done",
        kind: "approval",
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
    return {
      ...base,
      state,
      kind: "run",
      routine:
        item.status === "completed" ||
        (item.status === "started" &&
          (item.runId !== activeRunId ||
            runsWithConcreteActivity.has(item.runId))),
      time: eventTime(item.finishedAt ?? item.startedAt, locale, t),
      title:
        item.status === "started"
          ? t("agent.workingDesign")
          : item.status === "completed"
            ? t("agent.taskCompleted")
            : item.status === "cancelled"
              ? t("agent.taskStopped")
              : item.status === "budget"
                ? t("agent.contextLimit")
                : t("agent.taskFailed"),
      detail:
        item.status === "started"
          ? undefined
          : item.status === "cancelled"
            ? t("agent.requestCancelled")
            : item.status === "budget"
              ? t("agent.contextLimitDetail")
              : item.status === "error"
                ? t("agent.tryAgain")
                : undefined,
    };
  });
}

function projectEvents(
  events: AgentEvent[],
  startOrder: number,
  locale: AppLocale,
  t: Translate,
): TimelineItem[] {
  const items = new Map<string, TimelineItem>();
  const update = (
    id: string,
    order: number,
    value: Omit<TimelineItem, "id" | "order">,
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
    if (run?.state === "active") {
      items.set(run.id, { ...run, routine: true });
    }
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
      value: Omit<TimelineItem, "id" | "order">,
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
      updateEvent(
        event.runId
          ? `run:${event.runId}`
          : `runtime:error:${event.requestId ?? event.code}`,
        {
          routine: false,
          state: "error",
          kind: event.runId ? "run" : "system",
          time: t("common.error"),
          title: event.runId
            ? t("agent.taskFailed")
            : t("agent.agentUnavailable"),
          detail: friendlyAgentError(event.message, t),
        },
      );
    }
    if (event.type === "run.started") {
      updateEvent(`run:${event.runId}`, {
        state: "active",
        kind: "run",
        time: eventTime(event.startedAt, locale, t),
        title: t("agent.workingDesign"),
      });
    }
    if (event.type === "message.delta") {
      hideGenericRunStatus(event.runId);
      const id = `message:${event.messageId}`;
      const existing = items.get(id);
      updateEvent(id, {
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
      updateEvent(`message:${event.messageId}`, {
        routine: detail.length === 0,
        state: "done",
        kind: "assistant",
        time: t("common.now"),
        title: t("agent.response"),
        detail,
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
      updateEvent(`tool:${event.toolCallId}`, {
        state: "active",
        kind: "tool",
        time: `${Math.round(event.progress * 100)}%`,
        title: existing?.title ?? t("agent.applyingChange"),
        detail: isNativeDesignTool(existing?.toolName)
          ? undefined
          : friendlyAgentError(event.message, t),
      });
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
      const recoverableWorkflowFailure = isRecoverableDesignWorkflowFailure(
        event.message,
      );
      updateEvent(`tool:${event.toolCallId}`, {
        routine: recoverableWorkflowFailure,
        state: "error",
        kind: "tool",
        time: t("common.error"),
        title: t("agent.changeFailed"),
        detail: friendlyAgentError(event.message, t),
      });
    }
    if (event.type === "approval.requested") {
      updateEvent(`approval:${event.approvalId}`, {
        state: "queued",
        kind: "approval",
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
                : t("agent.taskFailed"),
        detail:
          event.stopReason === "complete"
            ? undefined
            : event.stopReason === "cancelled"
              ? t("agent.requestCancelled")
              : event.stopReason === "budget"
                ? t("agent.contextLimitDetail")
                : t("agent.tryAgain"),
      });
    }
  });

  return [...items.values()];
}

function mergeTimeline(
  timeline: SessionTimelineItem[],
  events: AgentEvent[],
  activeRunId: string | null,
  stoppingRunId: string | null,
  locale: AppLocale,
  t: Translate,
): TimelineItem[] {
  const durable = projectTimeline(timeline, activeRunId, locale, t);
  const runOrder = new Map<string, number>();
  const recordRun = (runId: string | undefined) => {
    if (runId && !runOrder.has(runId)) runOrder.set(runId, runOrder.size);
  };
  [...timeline]
    .sort((left, right) => left.sequence - right.sequence)
    .forEach((item) => recordRun(item.runId));
  events.forEach((event) =>
    recordRun("runId" in event ? event.runId : undefined),
  );
  const maximumSequence = durable.reduce(
    (maximum, item) => Math.max(maximum, item.order),
    0,
  );
  const merged = new Map(durable.map((item) => [item.id, item]));
  for (const item of projectEvents(events, maximumSequence, locale, t)) {
    const durableItem = merged.get(item.id);
    if (durableItem?.kind === "assistant" && durableItem.state === "done") {
      // A bounded live-event window can begin in the middle of a streamed
      // message. Once the journal has the completed message, that durable text
      // is authoritative and must not be replaced by a suffix-only projection.
      continue;
    }
    merged.set(item.id, {
      ...item,
      order: durableItem?.order ?? item.order,
    });
  }
  return [...merged.values()]
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
      return left.order - right.order || left.id.localeCompare(right.id);
    });
}

function finalizeTimelineActivity(item: TimelineItem): TimelineItem {
  return {
    ...item,
    state: "done",
    ...(item.kind === "assistant" ? {} : { routine: true }),
  };
}

export function AgentTimeline({
  events,
  timeline,
  activeRunId,
  error,
  conversationId,
  conversationTitle,
  conversations = [],
  onCreateConversation,
  onSelectConversation,
  onSubmit,
  onStop,
  scope,
}: AgentTimelineProps) {
  const { locale, t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [selectingAttachments, setSelectingAttachments] = useState(false);
  const [attachments, setAttachments] = useState<AgentAttachmentSelection[]>(
    [],
  );
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentDropActive, setAttachmentDropActive] = useState(false);
  const [stopRequestedRunId, setStopRequestedRunId] = useState<string | null>(
    null,
  );
  const [catalog, setCatalog] = useState<ModelProviderCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [modelSelection, setModelSelection] = useState<ModelSelection | null>(
    null,
  );
  const initializedConversation = useRef<string | null>(null);
  const thread = useRef<HTMLOListElement | null>(null);
  const followsLatest = useRef(true);
  const renderedConversation = useRef<string | null>(conversationId);
  const stopping = activeRunId !== null && stopRequestedRunId === activeRunId;
  const items = mergeTimeline(
    timeline,
    events,
    activeRunId,
    stopping ? activeRunId : null,
    locale,
    t,
  );
  const timelineRenderMarker = items
    .map(
      (item) =>
        `${item.id}:${item.state}:${item.title.length}:${item.detail?.length ?? 0}`,
    )
    .join("|");
  const hasConversation = conversationTitle !== null;

  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    if (renderedConversation.current !== conversationId) {
      renderedConversation.current = conversationId;
      followsLatest.current = true;
    }
    if (followsLatest.current) element.scrollTop = element.scrollHeight;
  }, [conversationId, timelineRenderMarker]);

  useEffect(() => {
    if (stopRequestedRunId && stopRequestedRunId !== activeRunId) {
      setStopRequestedRunId(null);
    }
  }, [activeRunId, stopRequestedRunId]);

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop || typeof desktop.getModelProviderCatalog !== "function") {
      setCatalogError(t("agent.modelCatalogUnavailable"));
      return;
    }
    const unsubscribe =
      typeof desktop.onModelProviderCatalogChange === "function"
        ? desktop.onModelProviderCatalogChange((nextCatalog) => {
            if (!active) return;
            setCatalog(nextCatalog);
            setCatalogError(null);
          })
        : undefined;
    void desktop
      .getModelProviderCatalog()
      .then((nextCatalog) => {
        if (!active) return;
        setCatalog(nextCatalog);
        setCatalogError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setCatalogError(
          loadError instanceof Error
            ? loadError.message
            : t("agent.modelCatalogFailed"),
        );
      });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [t]);

  useEffect(() => {
    if (!catalog) return;
    const conversationChanged =
      initializedConversation.current !== conversationId;
    const remembered = [...timeline]
      .reverse()
      .find(
        (item): item is Extract<SessionTimelineItem, { type: "run" }> =>
          item.type === "run" && item.modelSelection !== undefined,
      )?.modelSelection;
    if (
      conversationChanged ||
      modelSelection === null ||
      !resolveCatalogModel(catalog, modelSelection)
    ) {
      setModelSelection(
        firstValidSelection(catalog, remembered ?? catalog.defaultSelection),
      );
      initializedConversation.current = conversationId;
    }
  }, [catalog, conversationId, modelSelection, timeline]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = prompt.trim();
    if (
      !hasConversation ||
      !value ||
      !modelSelection ||
      (attachments.some(isImageAttachment) &&
        (!catalog ||
          !resolveCatalogModel(catalog, modelSelection)?.model.capabilities
            .imageInput)) ||
      submitting ||
      activeRunId
    )
      return;
    setSubmitting(true);
    followsLatest.current = true;
    try {
      if (
        await onSubmit(
          value,
          modelSelection,
          attachments.map(toAgentAttachment),
        )
      ) {
        setPrompt("");
        setAttachments([]);
        setAttachmentError(null);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const status = !hasConversation
    ? t("agent.selectConversation")
    : stopping
      ? t("agent.stoppingRequest")
      : activeRunId
        ? t("agent.requestProgress")
        : error
          ? t("agent.requestFailed")
          : conversationTitle;
  const selectedCatalogModel =
    catalog && modelSelection
      ? resolveCatalogModel(catalog, modelSelection)
      : undefined;
  const modelOptions = catalog ? selectableModels(catalog) : [];
  const supportsImageInput = Boolean(
    selectedCatalogModel?.model.capabilities.imageInput,
  );
  const hasImageAttachments = attachments.some(isImageAttachment);
  const timelineHasError = items.some((item) => item.state === "error");
  const standaloneAgentError =
    error && !timelineHasError ? friendlyAgentError(error, t) : undefined;
  const scopeLabel =
    scope?.kind === "selection"
      ? t("agent.scopeSelection", { count: scope.count })
      : scope?.name
        ? t("agent.scopePage", { name: scope.name })
        : t("agent.scopePageGeneric");
  const helperMessage =
    attachmentError ??
    catalogError ??
    (hasImageAttachments && !supportsImageInput
      ? t("agent.modelNoImageInput")
      : attachments.length > 0 && selectedCatalogModel
        ? t("agent.attachmentsWillBeSent", {
            count: attachments.length,
            model: selectedCatalogModel.model.name,
          })
        : undefined) ??
    standaloneAgentError ??
    (hasConversation
      ? modelOptions.length === 0
        ? t("agent.configureModel")
        : undefined
      : t("agent.conversationRequired"));
  const helperIsError = Boolean(
    attachmentError ||
    catalogError ||
    (hasImageAttachments && !supportsImageInput) ||
    standaloneAgentError,
  );

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    event.preventDefault();
    if (!activeRunId) event.currentTarget.form?.requestSubmit();
  };

  useEffect(() => {
    setAttachments([]);
    setAttachmentError(null);
  }, [conversationId]);

  const selectAttachments = async () => {
    const desktop = window.desktop;
    if (
      selectingAttachments ||
      !desktop ||
      typeof desktop.selectAgentAttachments !== "function"
    ) {
      return;
    }
    setSelectingAttachments(true);
    setAttachmentError(null);
    try {
      const selected = await desktop.selectAgentAttachments();
      setAttachments((current) => {
        const merged = new Map(
          current.map((attachment) => [attachment.attachmentId, attachment]),
        );
        for (const attachment of selected) {
          merged.set(attachment.attachmentId, attachment);
        }
        return [...merged.values()].slice(0, MAX_AGENT_ATTACHMENTS);
      });
    } catch (selectionError) {
      setAttachmentError(
        selectionError instanceof Error
          ? selectionError.message
          : t("agent.attachmentSelectionFailed"),
      );
    } finally {
      setSelectingAttachments(false);
    }
  };

  const importAttachmentFiles = async (files: readonly File[]) => {
    const desktop = window.desktop;
    if (
      files.length === 0 ||
      !desktop ||
      typeof desktop.importAgentAttachments !== "function"
    ) {
      return;
    }
    setSelectingAttachments(true);
    setAttachmentError(null);
    try {
      const available = Math.max(0, MAX_AGENT_ATTACHMENTS - attachments.length);
      const imports = await Promise.all(
        files.slice(0, available).map(async (file, index) => ({
          name:
            file.name ||
            `clipboard-image-${Date.now()}-${index + 1}.${file.type.split("/")[1] || "png"}`,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      const selected = await desktop.importAgentAttachments(imports);
      setAttachments((current) => {
        const merged = new Map(
          current.map((attachment) => [attachment.attachmentId, attachment]),
        );
        selected.forEach((attachment) =>
          merged.set(attachment.attachmentId, attachment),
        );
        return [...merged.values()].slice(0, MAX_AGENT_ATTACHMENTS);
      });
    } catch (importError) {
      setAttachmentError(
        importError instanceof Error
          ? importError.message
          : t("agent.attachmentImportFailed"),
      );
    } finally {
      setSelectingAttachments(false);
      setAttachmentDropActive(false);
    }
  };

  const handleAttachmentPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    void importAttachmentFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setAttachmentDropActive(false);
    void importAttachmentFiles([...event.dataTransfer.files]);
  };

  const createConversation = async () => {
    if (!onCreateConversation || creatingConversation || activeRunId) return;
    setCreatingConversation(true);
    try {
      await onCreateConversation();
    } finally {
      setCreatingConversation(false);
    }
  };

  const stop = async () => {
    if (!activeRunId || stopping) return;
    const runId = activeRunId;
    setStopRequestedRunId(runId);
    try {
      if ((await onStop()) === false) {
        setStopRequestedRunId((current) =>
          current === runId ? null : current,
        );
      }
    } catch {
      setStopRequestedRunId((current) => (current === runId ? null : current));
    }
  };

  return (
    <section aria-label={t("agent.timeline")} className="agent-panel">
      <header className="agent-panel__header">
        <div className="agent-panel__identity">
          <span className="agent-mark">
            <Glyph name="agent" />
          </span>
          <span>
            <strong>{t("agent.designAgent")}</strong>
            <small>{status}</small>
          </span>
        </div>
      </header>
      <div className="agent-panel__body">
        <div className="agent-conversation-bar">
          <DesktopSelect
            ariaLabel={t("agent.conversation")}
            className="agent-conversation-bar__select"
            disabled={conversations.length === 0}
            onValueChange={(value) => onSelectConversation?.(value)}
            options={conversations.map((conversation) => ({
              label: conversation.title,
              textValue: conversation.title,
              value: conversation.conversationId,
            }))}
            placeholder={
              conversations.length === 0
                ? t("agent.noConversations")
                : t("agent.chooseConversation")
            }
            value={conversationId}
          />
          <Button
            disabled={
              !onCreateConversation ||
              creatingConversation ||
              Boolean(activeRunId)
            }
            icon="plus"
            onClick={() => void createConversation()}
            tone={hasConversation ? "quiet" : "primary"}
          >
            {creatingConversation
              ? t("common.creating")
              : t("agent.newConversation")}
          </Button>
        </div>
        <ol
          aria-live="polite"
          className="agent-thread"
          onScroll={(event) => {
            const element = event.currentTarget;
            followsLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <=
              48;
          }}
          ref={thread}
        >
          {items.length === 0 ? (
            <li className="agent-thread__empty">
              <strong>
                {hasConversation
                  ? t("agent.activityEmpty")
                  : t("agent.noConversation")}
              </strong>
              <small>
                {hasConversation
                  ? t("agent.activityEmptyDetail")
                  : t("agent.noConversationDetail")}
              </small>
            </li>
          ) : (
            items.map((item) => (
              <li
                className={`agent-thread__item agent-thread__item--${item.state}${item.kind ? ` agent-thread__item--${item.kind}` : ""}`}
                key={item.id}
              >
                {item.kind === "user" || item.kind === "assistant" ? (
                  <article className="agent-message" title={item.time}>
                    <p>
                      {item.detail}
                      {item.kind === "assistant" && item.state === "active" && (
                        <span
                          aria-hidden="true"
                          className="agent-message__caret"
                        />
                      )}
                    </p>
                    {item.attachments && item.attachments.length > 0 && (
                      <TimelineAttachments attachments={item.attachments} />
                    )}
                  </article>
                ) : (
                  <div className="agent-activity" title={item.time}>
                    <span
                      aria-hidden="true"
                      className="agent-activity__indicator"
                    />
                    <span className="agent-activity__copy">
                      <strong>{item.title}</strong>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                  </div>
                )}
              </li>
            ))
          )}
        </ol>
        <form className="agent-prompt" onSubmit={(event) => void submit(event)}>
          <div
            className={`agent-prompt__editor${attachmentDropActive ? " agent-prompt__editor--drop" : ""}`}
            onDragEnter={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                setAttachmentDropActive(true);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setAttachmentDropActive(false);
              }
            }}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files")) {
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={handleAttachmentDrop}
          >
            {hasConversation && (
              <div className="agent-prompt__scope">
                <Glyph name="select" size={12} />
                <span>{scopeLabel}</span>
              </div>
            )}
            {attachments.length > 0 && (
              <ul
                aria-label={t("agent.attachments")}
                className="agent-prompt__attachments"
              >
                {attachments.map((attachment) => (
                  <li key={attachment.attachmentId}>
                    {attachment.previewDataUrl ? (
                      <img
                        alt={attachment.name}
                        src={attachment.previewDataUrl}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="agent-attachment__file-icon"
                      >
                        <Glyph name="file" />
                      </span>
                    )}
                    <span>
                      <strong>{attachment.name}</strong>
                      <small>
                        {formatAttachmentKind(attachment.mimeType)} ·{" "}
                        {formatBytes(attachment.byteSize)}
                      </small>
                    </span>
                    <IconButton
                      icon="close"
                      label={t("agent.removeAttachment", {
                        name: attachment.name,
                      })}
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter(
                            (candidate) =>
                              candidate.attachmentId !==
                              attachment.attachmentId,
                          ),
                        )
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
            <div className="agent-prompt__input-row">
              <textarea
                aria-label={t("agent.continueTask")}
                aria-busy={Boolean(activeRunId)}
                disabled={!hasConversation}
                id="agent-prompt"
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handlePromptKeyDown}
                onPaste={handleAttachmentPaste}
                placeholder={
                  !hasConversation
                    ? t("agent.selectConversationPlaceholder")
                    : activeRunId
                      ? t("agent.workingPlaceholder")
                      : t("agent.promptPlaceholder")
                }
                rows={3}
                value={prompt}
              />
              <IconButton
                disabled={
                  !hasConversation ||
                  selectingAttachments ||
                  attachments.length >= MAX_AGENT_ATTACHMENTS
                }
                icon="paperclip"
                label={t("agent.addAttachments")}
                onClick={() => void selectAttachments()}
              />
              {activeRunId ? (
                <Button
                  className="agent-prompt__stop"
                  disabled={stopping}
                  icon="stop"
                  onClick={() => void stop()}
                  tone="quiet"
                  type="button"
                >
                  {t(stopping ? "common.stopping" : "common.stop")}
                </Button>
              ) : (
                <Button
                  disabled={
                    !hasConversation ||
                    !modelSelection ||
                    !prompt.trim() ||
                    (hasImageAttachments && !supportsImageInput) ||
                    submitting
                  }
                  icon="spark"
                  tone="primary"
                  type="submit"
                >
                  {submitting ? t("common.sending") : t("common.send")}
                </Button>
              )}
            </div>
          </div>
          <div className="agent-prompt__model-row">
            <DesktopSelect
              ariaLabel={t("agent.model")}
              className="agent-prompt__model-select"
              disabled={Boolean(activeRunId) || modelOptions.length === 0}
              onValueChange={(value) => {
                const next = modelOptions.find(
                  (option) => option.value === value,
                );
                if (next) setModelSelection(next.selection);
              }}
              options={modelOptions.map((option) => ({
                label: option.label,
                textValue: option.label,
                value: option.value,
              }))}
              placeholder={t("agent.noModels")}
              size="compact"
              value={
                modelSelection
                  ? selectionValue(
                      modelSelection.providerId,
                      modelSelection.modelId,
                    )
                  : null
              }
            />
            {selectedCatalogModel &&
              selectedCatalogModel.model.reasoningEfforts.length > 1 && (
                <DesktopSelect
                  ariaLabel={t("agent.reasoning")}
                  className="agent-prompt__reasoning-select"
                  disabled={Boolean(activeRunId)}
                  onValueChange={(value) =>
                    setModelSelection((current) =>
                      current
                        ? {
                            ...current,
                            reasoningEffort:
                              value as ModelSelection["reasoningEffort"],
                          }
                        : current,
                    )
                  }
                  options={selectedCatalogModel.model.reasoningEfforts.map(
                    (effort) => ({
                      label: t(`reasoning.${effort}`),
                      textValue: t(`reasoning.${effort}`),
                      value: effort,
                    }),
                  )}
                  size="compact"
                  value={modelSelection?.reasoningEffort ?? "off"}
                />
              )}
          </div>
          {helperMessage && (
            <small
              className={helperIsError ? "agent-prompt__error" : undefined}
            >
              {helperMessage}
            </small>
          )}
        </form>
      </div>
    </section>
  );
}

function TimelineAttachments({
  attachments,
}: {
  attachments: readonly AgentAttachment[];
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    const desktop = window.desktop;
    if (!desktop || typeof desktop.getAgentAttachmentPreview !== "function") {
      return;
    }
    for (const attachment of attachments) {
      if (!isImageAttachment(attachment)) continue;
      if (previews[attachment.attachmentId]) continue;
      void desktop
        .getAgentAttachmentPreview({ attachmentId: attachment.attachmentId })
        .then((result) => {
          const previewDataUrl = result.previewDataUrl;
          if (!active || !previewDataUrl) return;
          setPreviews((current) => ({
            ...current,
            [result.attachmentId]: previewDataUrl,
          }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, [attachments, previews]);

  return (
    <span className="timeline__attachments">
      {attachments.map((attachment) =>
        previews[attachment.attachmentId] ? (
          <img
            alt={attachment.name}
            key={attachment.attachmentId}
            src={previews[attachment.attachmentId]}
            title={`${attachment.name} · ${formatBytes(attachment.byteSize)}`}
          />
        ) : (
          <span
            key={attachment.attachmentId}
            title={`${attachment.name} · ${formatBytes(attachment.byteSize)}`}
          >
            <Glyph name="file" />
            <small>{attachment.name}</small>
          </span>
        ),
      )}
    </span>
  );
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function toAgentAttachment(
  selection: AgentAttachmentSelection,
): AgentAttachment {
  return {
    attachmentId: selection.attachmentId,
    name: selection.name,
    mimeType: selection.mimeType,
    byteSize: selection.byteSize,
  };
}

function isImageAttachment(
  attachment: AgentAttachment | AgentAttachmentSelection,
): boolean {
  return attachment.attachmentId.startsWith("image_");
}

function formatAttachmentKind(mimeType: AgentAttachment["mimeType"]): string {
  const labels: Partial<Record<AgentAttachment["mimeType"], string>> = {
    "image/svg+xml": "SVG",
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      "DOCX",
    "text/plain": "TXT",
    "text/markdown": "Markdown",
    "text/csv": "CSV",
    "text/html": "HTML",
    "application/json": "JSON",
    "application/yaml": "YAML",
  };
  return labels[mimeType] ?? mimeType.slice("image/".length).toUpperCase();
}

function selectableModels(catalog: ModelProviderCatalog) {
  return catalog.providers.flatMap((provider) =>
    provider.enabled
      ? provider.models
          .filter((model) => model.capabilities.toolUse)
          .map((model) => ({
            value: selectionValue(provider.providerId, model.modelId),
            label: `${provider.name}/${model.name}`,
            selection: selectionForModel(provider, model),
          }))
      : [],
  );
}

function selectionValue(providerId: string, modelId: string): string {
  return JSON.stringify([providerId, modelId]);
}

function selectionForModel(
  provider: ModelProviderProfile,
  model: ModelProfile,
): ModelSelection {
  const preferred = model.reasoningEfforts.includes("medium")
    ? "medium"
    : model.reasoningEfforts[0];
  return {
    providerId: provider.providerId,
    modelId: model.modelId,
    ...(preferred === undefined ? {} : { reasoningEffort: preferred }),
  };
}

function resolveCatalogModel(
  catalog: ModelProviderCatalog,
  selection: ModelSelection,
): { provider: ModelProviderProfile; model: ModelProfile } | undefined {
  const provider = catalog.providers.find(
    (candidate) =>
      candidate.enabled && candidate.providerId === selection.providerId,
  );
  const model = provider?.models.find(
    (candidate) =>
      candidate.capabilities.toolUse && candidate.modelId === selection.modelId,
  );
  if (!provider || !model) return undefined;
  if (
    selection.reasoningEffort !== undefined &&
    !model.reasoningEfforts.includes(selection.reasoningEffort)
  )
    return undefined;
  return { provider, model };
}

function firstValidSelection(
  catalog: ModelProviderCatalog,
  preferred: ModelSelection | undefined,
): ModelSelection | null {
  if (preferred && resolveCatalogModel(catalog, preferred))
    return { ...preferred };
  return selectableModels(catalog)[0]?.selection ?? null;
}
