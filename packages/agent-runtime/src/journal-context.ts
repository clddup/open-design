import type { JournalEvent } from "@opendesign/session-store";
import type { ContextCheckpointPayload } from "./context-budget.js";

export function latestContextCheckpoint(
  events: readonly JournalEvent[],
): ContextCheckpointPayload | undefined {
  let latest:
    { eventSequence: number; payload: ContextCheckpointPayload } | undefined;
  for (const event of events) {
    if (event.type !== "context.compacted") continue;
    const payload = event.payload as {
      fromSequence?: unknown;
      toSequence?: unknown;
      summary?: unknown;
    };
    if (
      payload.fromSequence !== 1 ||
      !Number.isInteger(payload.toSequence) ||
      typeof payload.summary !== "string"
    ) {
      continue;
    }
    const candidate = {
      eventSequence: event.sequence,
      payload: {
        fromSequence: 1,
        toSequence: payload.toSequence as number,
        summary: payload.summary,
      },
    };
    if (
      !latest ||
      candidate.payload.toSequence > latest.payload.toSequence ||
      (candidate.payload.toSequence === latest.payload.toSequence &&
        candidate.eventSequence > latest.eventSequence)
    ) {
      latest = candidate;
    }
  }
  return latest?.payload;
}

export function sortJournalEvents(
  events: readonly JournalEvent[],
): JournalEvent[] {
  return [...events].sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.eventId.localeCompare(right.eventId),
  );
}
