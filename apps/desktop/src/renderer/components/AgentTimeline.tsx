import type {
  AgentAttachment,
  AgentEvent,
  SessionTimelineItem,
} from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import type { ConversationDescriptor } from "@opendesign/workspace-contracts";
import { Button, DesktopSelect, Glyph } from "@opendesign/ui";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { PAGE_STRUCTURE_ACCESS_TOOL_NAME } from "../../shared/design-agent-tools";
import {
  formatBytes,
  isImageAttachment,
} from "../features/agent-conversation/attachment-format";
import {
  projectAgentTimeline,
  timelineRenderMarker,
} from "../features/agent-conversation/timeline-projection";
import { friendlyAgentError } from "../features/agent-conversation/timeline-presentation";
import { projectAgentRunExperience } from "../features/agent-conversation/agent-run-experience";
import type {
  AgentTimelineItem,
  Translate,
} from "../features/agent-conversation/timeline-types";
import { useAgentComposerController } from "../features/agent-conversation/use-agent-composer-controller";
import { useI18n } from "../i18n";
import { AgentComposer } from "./AgentComposer";
import { AgentRunStatus } from "./AgentRunStatus";
import styles from "./AgentTimeline.module.scss";

const itemStateStyles: Record<AgentTimelineItem["state"], string> = {
  active: styles.itemActive,
  done: styles.itemDone,
  error: styles.itemError,
  queued: styles.itemQueued,
  stopping: styles.itemStopping,
};

const itemKindStyles: Partial<
  Record<NonNullable<AgentTimelineItem["kind"]>, string>
> = {
  approval: styles.itemApproval,
  assistant: styles.itemAssistant,
  user: styles.itemUser,
};

function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

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
  approvalResourceName?: string;
  onResolveApproval?: (resolution: {
    runId: string;
    toolCallId: string;
    approvalId: string;
    decision: "allow_once" | "deny";
  }) => Promise<boolean>;
  scope?:
    { kind: "page"; name?: string } | { kind: "selection"; count: number };
};

function ReasoningDisclosure({
  item,
  t,
}: {
  item: AgentTimelineItem;
  t: Translate;
}) {
  if (!item.reasoning) return null;
  return (
    <details className={styles.reasoning} data-agent-reasoning="">
      <summary>
        <span aria-hidden="true" className={styles.reasoningChevron}>
          ›
        </span>
        <span>{item.title}</span>
      </summary>
      <p>{item.reasoning}</p>
      <small>{t("agent.reasoningSummaryNotice")}</small>
    </details>
  );
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
  approvalResourceName,
  onResolveApproval,
  scope,
}: AgentTimelineProps) {
  const { locale, t } = useI18n();
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [resolvingApprovalId, setResolvingApprovalId] = useState<string | null>(
    null,
  );
  const thread = useRef<HTMLOListElement | null>(null);
  const followsLatest = useRef(true);
  const renderedConversation = useRef<string | null>(conversationId);
  const composer = useAgentComposerController({
    activeRunId,
    conversationId,
    conversationTitle,
    onCreateConversation,
    onStop,
    onSubmit,
    timeline,
    t,
  });
  const items = projectAgentTimeline({
    activeRunId,
    events,
    locale,
    stoppingRunId: composer.stopping ? activeRunId : null,
    timeline,
    t,
  });
  const runExperience = projectAgentRunExperience({
    activeRunId,
    events,
    timeline,
    stopping: composer.stopping,
    error,
  });
  const pendingApprovalIds = items
    .filter((item) => item.kind === "approval" && item.state === "queued")
    .map((item) => item.approvalId)
    .filter(Boolean)
    .join("|");
  const renderMarker = timelineRenderMarker(items);
  const hasConversation = composer.hasConversation;

  useLayoutEffect(() => {
    const element = thread.current;
    if (!element) return;
    if (renderedConversation.current !== conversationId) {
      renderedConversation.current = conversationId;
      followsLatest.current = true;
    }
    if (followsLatest.current) element.scrollTop = element.scrollHeight;
  }, [conversationId, renderMarker]);

  useEffect(() => {
    if (
      resolvingApprovalId &&
      !pendingApprovalIds.split("|").includes(resolvingApprovalId)
    ) {
      setResolvingApprovalId(null);
    }
  }, [pendingApprovalIds, resolvingApprovalId]);

  const status = !hasConversation
    ? t("agent.selectConversation")
    : composer.stopping
      ? t("agent.stoppingRequest")
      : activeRunId
        ? t("agent.requestProgress")
        : error
          ? t("agent.requestFailed")
          : conversationTitle;
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
    approvalError ??
    composer.attachmentError ??
    composer.catalogError ??
    (composer.hasImageAttachments && !composer.supportsImageInput
      ? t("agent.modelNoImageInput")
      : composer.attachments.length > 0 && composer.selectedModelName
        ? t("agent.attachmentsWillBeSent", {
            count: composer.attachments.length,
            model: composer.selectedModelName,
          })
        : undefined) ??
    standaloneAgentError ??
    (hasConversation
      ? composer.modelOptions.length === 0
        ? t("agent.configureModel")
        : undefined
      : t("agent.conversationRequired"));
  const helperIsError = Boolean(
    composer.attachmentError ||
    composer.catalogError ||
    (composer.hasImageAttachments && !composer.supportsImageInput) ||
    standaloneAgentError,
  );

  const resolveApproval = async (
    item: AgentTimelineItem,
    decision: "allow_once" | "deny",
  ) => {
    if (
      !onResolveApproval ||
      !item.runId ||
      !item.toolCallId ||
      !item.approvalId ||
      resolvingApprovalId
    ) {
      return;
    }
    setResolvingApprovalId(item.approvalId);
    setApprovalError(null);
    try {
      const accepted = await onResolveApproval({
        runId: item.runId,
        toolCallId: item.toolCallId,
        approvalId: item.approvalId,
        decision,
      });
      if (!accepted) setResolvingApprovalId(null);
    } catch (approvalFailure) {
      setResolvingApprovalId(null);
      setApprovalError(
        approvalFailure instanceof Error
          ? approvalFailure.message
          : t("agent.approvalResolveFailed"),
      );
    }
  };

  return (
    <section aria-label={t("agent.timeline")} className={styles.root}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <span className={styles.mark}>
            <Glyph name="agent" />
          </span>
          <span>
            <strong>{t("agent.designAgent")}</strong>
            <small>{status}</small>
          </span>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.conversationBar}>
          <DesktopSelect
            ariaLabel={t("agent.conversation")}
            className={styles.conversationSelect}
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
              composer.creatingConversation ||
              Boolean(activeRunId)
            }
            icon="plus"
            onClick={() => void composer.createConversation()}
            tone={hasConversation ? "quiet" : "primary"}
          >
            {composer.creatingConversation
              ? t("common.creating")
              : t("agent.newConversation")}
          </Button>
        </div>
        {runExperience && <AgentRunStatus experience={runExperience} t={t} />}
        <ol
          aria-live="polite"
          className={styles.thread}
          onScroll={(event) => {
            const element = event.currentTarget;
            followsLatest.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <=
              48;
          }}
          ref={thread}
        >
          {items.length === 0 ? (
            <li className={styles.empty}>
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
                className={cx(
                  styles.item,
                  itemStateStyles[item.state],
                  item.kind ? itemKindStyles[item.kind] : null,
                  item.historical && styles.itemHistorical,
                )}
                data-agent-item=""
                data-historical={item.historical ? "true" : "false"}
                data-kind={item.kind ?? "activity"}
                data-state={item.state}
                key={item.id}
              >
                {item.kind === "reasoning" ? (
                  <ReasoningDisclosure item={item} t={t} />
                ) : item.kind === "user" || item.kind === "assistant" ? (
                  <article
                    className={styles.message}
                    data-agent-message=""
                    title={item.time}
                  >
                    {(item.detail || item.state === "active") && (
                      <p>
                        {item.detail}
                        {item.kind === "assistant" &&
                          item.state === "active" && (
                            <span
                              aria-hidden="true"
                              className={styles.messageCaret}
                              data-agent-caret=""
                            />
                          )}
                      </p>
                    )}
                    {item.kind === "assistant" && (
                      <ReasoningDisclosure
                        item={{
                          ...item,
                          title:
                            item.reasoningCount && item.reasoningCount > 1
                              ? t("agent.designProcessCount", {
                                  count: item.reasoningCount,
                                })
                              : t("agent.designProcess"),
                        }}
                        t={t}
                      />
                    )}
                    {item.attachments && item.attachments.length > 0 && (
                      <TimelineAttachments attachments={item.attachments} />
                    )}
                  </article>
                ) : item.kind === "approval" &&
                  item.state === "queued" &&
                  item.runId === activeRunId &&
                  item.approvalId &&
                  item.toolCallId &&
                  item.runId &&
                  onResolveApproval ? (
                  <div
                    aria-label={
                      item.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME
                        ? t("agent.pageStructureApprovalTitle", {
                            file:
                              approvalResourceName ??
                              t("agent.currentDesignFile"),
                          })
                        : item.title
                    }
                    className={styles.approval}
                    role="group"
                  >
                    <span
                      aria-hidden="true"
                      className={styles.activityIndicator}
                    />
                    <span className={styles.approvalCopy}>
                      <strong>
                        {item.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME
                          ? t("agent.pageStructureApprovalTitle", {
                              file:
                                approvalResourceName ??
                                t("agent.currentDesignFile"),
                            })
                          : item.title}
                      </strong>
                      <small>
                        {item.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME
                          ? t("agent.pageStructureApprovalDetail")
                          : item.detail}
                      </small>
                    </span>
                    <span className={styles.approvalActions}>
                      <Button
                        disabled={resolvingApprovalId !== null}
                        onClick={() => void resolveApproval(item, "deny")}
                        tone="quiet"
                      >
                        {t("agent.approvalDeny")}
                      </Button>
                      <Button
                        disabled={resolvingApprovalId !== null}
                        onClick={() => void resolveApproval(item, "allow_once")}
                        tone="primary"
                      >
                        {t("agent.approvalAllowTask")}
                      </Button>
                    </span>
                  </div>
                ) : (
                  <div className={styles.activity} title={item.time}>
                    <span
                      aria-hidden="true"
                      className={styles.activityIndicator}
                    />
                    <span className={styles.activityCopy}>
                      <strong>{item.title}</strong>
                      {item.detail && <small>{item.detail}</small>}
                    </span>
                  </div>
                )}
              </li>
            ))
          )}
        </ol>
        <AgentComposer
          activeRunId={activeRunId}
          controller={composer}
          helperIsError={helperIsError}
          helperMessage={helperMessage}
          onWillSubmit={() => {
            followsLatest.current = true;
          }}
          scopeLabel={scopeLabel}
          t={t}
        />
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
    <span className={styles.timelineAttachments}>
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
