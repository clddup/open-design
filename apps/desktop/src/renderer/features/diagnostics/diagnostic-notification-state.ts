import type { DiagnosticEvent } from "../../../shared/diagnostics";

export const MAX_DIAGNOSTIC_NOTIFICATIONS = 4;

export function isTaskScopedDiagnostic(event: DiagnosticEvent): boolean {
  return Boolean(event.context?.conversationId && event.context.runId);
}

export function isToastNotification(event: DiagnosticEvent): boolean {
  return event.presentation === "toast" && !isTaskScopedDiagnostic(event);
}

export function mergeDiagnosticNotifications(
  current: readonly DiagnosticEvent[],
  incoming: readonly DiagnosticEvent[],
  limit = MAX_DIAGNOSTIC_NOTIFICATIONS,
): DiagnosticEvent[] {
  const boundedLimit = Math.max(0, limit);
  if (boundedLimit === 0) return [];
  const byId = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) {
    if (!isToastNotification(event)) continue;
    const existing = byId.get(event.eventId);
    if (!existing || compareDiagnosticEvents(existing, event) <= 0) {
      byId.set(event.eventId, event);
    }
  }
  return [...byId.values()].sort(compareDiagnosticEvents).slice(-boundedLimit);
}

function compareDiagnosticEvents(
  left: DiagnosticEvent,
  right: DiagnosticEvent,
): number {
  const occurred = Date.parse(left.occurredAt) - Date.parse(right.occurredAt);
  return occurred !== 0 ? occurred : left.eventId.localeCompare(right.eventId);
}
