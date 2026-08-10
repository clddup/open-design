import { formatDiagnosticReport } from "../../shared/diagnostics";
import type { DiagnosticEvent } from "../../shared/diagnostics";
import { Button, IconButton } from "@opendesign/ui";
import { useEffect, useState } from "react";
import type { MessageKey } from "../../shared/i18n/messages";
import { useI18n } from "../i18n";

export type DiagnosticNotificationsProps = {
  events: readonly DiagnosticEvent[];
  onDismiss: (eventId: string) => void;
};

function titleKey(level: DiagnosticEvent["level"]): MessageKey {
  if (level === "error") return "diagnostic.errorTitle";
  if (level === "warning") return "diagnostic.warningTitle";
  return "diagnostic.infoTitle";
}

function compactIdentifier(value: string): string {
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function contextSummary(event: DiagnosticEvent): string[] {
  const values: string[] = [];
  if (event.context?.conversationId) {
    values.push(
      `Conversation ${compactIdentifier(event.context.conversationId)}`,
    );
  }
  if (event.context?.runId) {
    values.push(`Run ${compactIdentifier(event.context.runId)}`);
  }
  if (event.context?.requestId) {
    values.push(`Request ${compactIdentifier(event.context.requestId)}`);
  }
  if (event.context?.toolCallId) {
    values.push(`Tool ${compactIdentifier(event.context.toolCallId)}`);
  }
  return values;
}

function DiagnosticNotification({
  event,
  onDismiss,
}: {
  event: DiagnosticEvent;
  onDismiss: (eventId: string) => void;
}) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const context = contextSummary(event);

  useEffect(() => {
    if (event.level === "error") return;
    const timeout = window.setTimeout(
      () => onDismiss(event.eventId),
      event.level === "warning" ? 10_000 : 6_000,
    );
    return () => window.clearTimeout(timeout);
  }, [event.eventId, event.level, onDismiss]);

  useEffect(() => {
    if (copyState === "idle") return;
    const timeout = window.setTimeout(() => setCopyState("idle"), 2_500);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(formatDiagnosticReport(event));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      aria-atomic="true"
      className={`diagnostic-notification diagnostic-notification--${event.level}`}
      role={event.level === "error" ? "alert" : "status"}
    >
      <header>
        <span aria-hidden="true" className="diagnostic-notification__mark" />
        <strong>{t(titleKey(event.level))}</strong>
        <IconButton
          icon="close"
          label={t("diagnostic.dismiss")}
          onClick={() => onDismiss(event.eventId)}
        />
      </header>
      <div className="diagnostic-notification__identity">
        <span>{event.source}</span>
        <code>{event.code}</code>
      </div>
      <p title={event.message}>{event.message}</p>
      {context.length > 0 && (
        <small title={context.join(" · ")}>{context.join(" · ")}</small>
      )}
      <footer>
        <Button onClick={() => void copyDiagnostic()} tone="quiet">
          {copyState === "copied"
            ? t("diagnostic.copied")
            : copyState === "failed"
              ? t("diagnostic.copyFailed")
              : t("diagnostic.copy")}
        </Button>
      </footer>
    </section>
  );
}

export function DiagnosticNotifications({
  events,
  onDismiss,
}: DiagnosticNotificationsProps) {
  const { t } = useI18n();
  if (events.length === 0) return null;
  return (
    <aside
      aria-label={t("diagnostic.notifications")}
      className="diagnostic-notifications"
    >
      {events.map((event) => (
        <DiagnosticNotification
          event={event}
          key={event.eventId}
          onDismiss={onDismiss}
        />
      ))}
    </aside>
  );
}
