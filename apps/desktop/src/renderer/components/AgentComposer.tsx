import { MAX_AGENT_ATTACHMENTS } from "@opendesign/agent-contracts";
import type { ModelSelection } from "@opendesign/model-gateway";
import { Button, DesktopSelect, Icon, IconButton } from "@opendesign/ui";
import type {
  ClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
} from "react";
import {
  formatAttachmentKind,
  formatBytes,
} from "../features/agent-conversation/attachment-format";
import { selectionValue } from "../features/agent-conversation/composer-models";
import type { AgentComposerController } from "../features/agent-conversation/use-agent-composer-controller";
import type { Translate } from "../features/agent-conversation/timeline-types";
import styles from "./AgentComposer.module.scss";

export interface AgentComposerProps {
  activeRunId: string | null;
  controller: AgentComposerController;
  helperIsError: boolean;
  helperMessage: string | undefined;
  onWillSubmit: () => void;
  scopeLabel: string;
  t: Translate;
}

export function AgentComposer({
  activeRunId,
  controller,
  helperIsError,
  helperMessage,
  onWillSubmit,
  scopeLabel,
  t,
}: AgentComposerProps) {
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

  const handleAttachmentPaste = (
    event: ClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const files = [...event.clipboardData.files];
    if (files.length === 0) return;
    event.preventDefault();
    void controller.importAttachmentFiles(files);
  };

  const handleAttachmentDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    controller.setAttachmentDropActive(false);
    void controller.importAttachmentFiles([...event.dataTransfer.files]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!controller.canSubmit) return;
    onWillSubmit();
    void controller.submit();
  };

  return (
    <form className={styles.root} data-agent-prompt="" onSubmit={submit}>
      <div
        className={cx(
          styles.editor,
          controller.attachmentDropActive && styles.editorDrop,
        )}
        data-agent-prompt-editor=""
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            controller.setAttachmentDropActive(true);
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            controller.setAttachmentDropActive(false);
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
        {controller.hasConversation && (
          <div className={styles.scope}>
            <span className={styles.context}>
              <Icon name="lucide:mouse-pointer-2" size={12} />
              <span>{t("agent.contextScope", { scope: scopeLabel })}</span>
            </span>
          </div>
        )}
        {controller.attachments.length > 0 && (
          <ul
            aria-label={t("agent.attachments")}
            className={styles.attachments}
          >
            {controller.attachments.map((attachment) => (
              <li key={attachment.attachmentId}>
                {attachment.previewDataUrl ? (
                  <img alt={attachment.name} src={attachment.previewDataUrl} />
                ) : (
                  <span
                    aria-hidden="true"
                    className={styles.attachmentFileIcon}
                  >
                    <Icon name="lucide:file" />
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
                  icon="lucide:x"
                  label={t("agent.removeAttachment", { name: attachment.name })}
                  onClick={() =>
                    controller.removeAttachment(attachment.attachmentId)
                  }
                />
              </li>
            ))}
          </ul>
        )}
        <div className={styles.inputRow}>
          <textarea
            aria-label={t("agent.continueTask")}
            aria-busy={Boolean(activeRunId)}
            disabled={
              !controller.hasConversation || !controller.submissionAvailable
            }
            id="agent-prompt"
            onChange={(event) => controller.setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            onPaste={handleAttachmentPaste}
            placeholder={
              !controller.hasConversation
                ? t("agent.selectConversationPlaceholder")
                : activeRunId
                  ? t("agent.workingPlaceholder")
                  : t("agent.promptPlaceholder")
            }
            rows={3}
            value={controller.prompt}
          />
          <IconButton
            disabled={
              !controller.hasConversation ||
              !controller.submissionAvailable ||
              controller.selectingAttachments ||
              controller.attachments.length >= MAX_AGENT_ATTACHMENTS
            }
            icon="lucide:paperclip"
            label={t("agent.addAttachments")}
            onClick={() => void controller.selectAttachments()}
          />
          {activeRunId ? (
            <Button
              className={styles.stop}
              disabled={controller.stopping}
              icon="lucide:square"
              onClick={() => void controller.stop()}
              tone="quiet"
              type="button"
            >
              {t(controller.stopping ? "common.stopping" : "common.stop")}
            </Button>
          ) : (
            <Button
              disabled={!controller.canSubmit}
              icon="lucide:sparkles"
              tone="primary"
              type="submit"
            >
              {controller.submitting ? t("common.sending") : t("common.send")}
            </Button>
          )}
        </div>
      </div>
      <div className={styles.modelRow}>
        <DesktopSelect
          ariaLabel={t("agent.model")}
          className={styles.modelSelect}
          disabled={
            Boolean(activeRunId) ||
            !controller.submissionAvailable ||
            controller.modelOptions.length === 0
          }
          onValueChange={(value) => {
            const next = controller.modelOptions.find(
              (option) => option.value === value,
            );
            if (next) controller.setModelSelection(next.selection);
          }}
          options={controller.modelOptions.map((option) => ({
            label: option.label,
            textValue: option.label,
            value: option.value,
          }))}
          placeholder={t("agent.noModels")}
          size="compact"
          value={
            controller.modelSelection
              ? selectionValue(
                  controller.modelSelection.providerId,
                  controller.modelSelection.modelId,
                )
              : null
          }
        />
        <DesktopSelect
          ariaLabel={t("agent.generationMode")}
          className={styles.generationModeSelect}
          disabled={Boolean(activeRunId) || !controller.submissionAvailable}
          onValueChange={(value) => {
            if (value === "fast" || value === "thorough") {
              controller.setGenerationMode(value);
            }
          }}
          options={(["fast", "thorough"] as const).map((mode) => ({
            label: t(`generationMode.${mode}`),
            textValue: t(`generationMode.${mode}`),
            value: mode,
          }))}
          size="compact"
          value={controller.generationMode}
        />
        {controller.selectedModelReasoningEfforts.length > 1 && (
          <DesktopSelect
            ariaLabel={t("agent.reasoning")}
            className={styles.reasoningSelect}
            disabled={Boolean(activeRunId) || !controller.submissionAvailable}
            onValueChange={(value) => {
              if (!controller.modelSelection) return;
              controller.setModelSelection({
                ...controller.modelSelection,
                reasoningEffort: value as ModelSelection["reasoningEffort"],
              });
            }}
            options={controller.selectedModelReasoningEfforts.map((effort) => ({
              label: t(`reasoning.${effort}`),
              textValue: t(`reasoning.${effort}`),
              value: effort,
            }))}
            size="compact"
            value={controller.modelSelection?.reasoningEffort ?? "off"}
          />
        )}
      </div>
      {helperMessage && (
        <small className={helperIsError ? styles.error : undefined}>
          {helperMessage}
        </small>
      )}
    </form>
  );
}

function cx(...classNames: Array<string | false | null | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}
