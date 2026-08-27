import { isAgentAttachment } from "@opendesign/agent-contracts";
import type {
  CanonicalMessage,
  CanonicalTool,
} from "@opendesign/model-gateway";
import type { JournalEvent } from "@opendesign/session-store";
import {
  contextExcerpt,
  modelContextFits,
  type ContextBudget,
  type ContextCheckpointPayload,
} from "./context-budget.js";
import {
  latestContextCheckpoint,
  sortJournalEvents,
} from "./journal-context.js";
import { restoreModelMessages } from "./model-message-projection.js";

export function planContextCompaction(
  events: JournalEvent[],
  options: {
    budget: ContextBudget;
    currentMessage: CanonicalMessage;
    system: string;
    tools: CanonicalTool[];
  },
): ContextCheckpointPayload | undefined {
  const current = restoreModelMessages(events);
  if (
    modelContextFits(
      [...current, options.currentMessage],
      options.system,
      options.tools,
      options.budget,
    )
  ) {
    return undefined;
  }

  const sorted = sortJournalEvents(events);
  const activeCheckpoint = latestContextCheckpoint(sorted);
  const ranges = uncompactedRunRanges(
    sorted,
    activeCheckpoint?.toSequence ?? 0,
  );
  if (ranges.length === 0) return undefined;

  for (const [index, range] of ranges.entries()) {
    const payload = buildContextCheckpoint(sorted, range.toSequence);
    const previewEvent: JournalEvent = {
      eventId: `context_compaction_preview_${range.toSequence}`,
      sessionId: sorted[0]?.sessionId ?? "context_preview",
      runId: "context_compaction_preview",
      sequence: (sorted.at(-1)?.sequence ?? 0) + 1,
      type: "context.compacted",
      createdAt: sorted.at(-1)?.createdAt ?? new Date(0).toISOString(),
      payload,
    };
    const projected = restoreModelMessages([...sorted, previewEvent]);
    if (
      modelContextFits(
        [...projected, options.currentMessage],
        options.system,
        options.tools,
        options.budget,
      ) ||
      index === ranges.length - 1
    ) {
      return payload;
    }
  }
  return undefined;
}

function uncompactedRunRanges(
  events: readonly JournalEvent[],
  afterSequence: number,
): Array<{ key: string; fromSequence: number; toSequence: number }> {
  const ranges: Array<{
    key: string;
    fromSequence: number;
    toSequence: number;
  }> = [];
  for (const event of events) {
    if (event.sequence <= afterSequence || event.type === "context.compacted") {
      continue;
    }
    const key = event.runId ?? `event_${event.sequence}`;
    const previous = ranges.at(-1);
    if (previous?.key === key) {
      previous.toSequence = event.sequence;
    } else {
      ranges.push({
        key,
        fromSequence: event.sequence,
        toSequence: event.sequence,
      });
    }
  }
  return ranges;
}

function buildContextCheckpoint(
  events: readonly JournalEvent[],
  toSequence: number,
): ContextCheckpointPayload {
  const included = events.filter(
    (event) =>
      event.sequence <= toSequence && event.type !== "context.compacted",
  );
  const userRequests = included
    .filter((event) => event.type === "message.user")
    .slice(-12)
    .flatMap((event) => {
      const payload = event.payload as { content?: unknown };
      return typeof payload.content === "string"
        ? [
            {
              sequence: event.sequence,
              text: contextExcerpt(payload.content),
            },
          ]
        : [];
    });
  const assistantOutcomes = included
    .filter((event) => event.type === "message.assistant")
    .slice(-8)
    .flatMap((event) => {
      const payload = event.payload as { blocks?: unknown };
      if (!Array.isArray(payload.blocks)) return [];
      const text = payload.blocks
        .flatMap((block) => {
          if (!block || typeof block !== "object") return [];
          const value = block as { summary?: unknown; text?: unknown };
          return typeof value.text === "string"
            ? [value.text]
            : typeof value.summary === "string"
              ? [value.summary]
              : [];
        })
        .join("\n");
      return text.length > 0
        ? [{ sequence: event.sequence, text: contextExcerpt(text) }]
        : [];
    });
  const attachments = uniqueCheckpointAttachments(included).slice(-12);
  const toolCounts = new Map<string, number>();
  for (const event of included) {
    if (event.type !== "tool.requested") continue;
    const payload = event.payload as { toolName?: unknown };
    if (typeof payload.toolName !== "string") continue;
    toolCounts.set(
      payload.toolName,
      (toolCounts.get(payload.toolName) ?? 0) + 1,
    );
  }
  const designState = new Map<
    string,
    { documentId: string; revision: number; transactionId?: string }
  >();
  for (const event of included) {
    if (event.type !== "design.revision") continue;
    const payload = event.payload as {
      documentId?: unknown;
      revision?: unknown;
      transactionId?: unknown;
    };
    if (
      typeof payload.documentId !== "string" ||
      !Number.isInteger(payload.revision)
    ) {
      continue;
    }
    designState.set(payload.documentId, {
      documentId: payload.documentId,
      revision: payload.revision as number,
      ...(typeof payload.transactionId === "string"
        ? { transactionId: payload.transactionId }
        : {}),
    });
  }
  const runStatuses = new Map<string, number>();
  for (const event of included) {
    if (event.type !== "run.state") continue;
    const payload = event.payload as { status?: unknown };
    if (typeof payload.status !== "string" || payload.status === "started") {
      continue;
    }
    runStatuses.set(payload.status, (runStatuses.get(payload.status) ?? 0) + 1);
  }

  return {
    fromSequence: 1,
    toSequence,
    summary: JSON.stringify({
      version: 1,
      compactedThroughSequence: toSequence,
      userRequests,
      assistantOutcomes,
      attachments,
      toolActivity: [...toolCounts.entries()]
        .slice(-32)
        .map(([toolName, count]) => ({ toolName, count })),
      designState: [...designState.values()].slice(-16),
      runStatuses: Object.fromEntries(runStatuses),
    }),
  };
}

function uniqueCheckpointAttachments(events: readonly JournalEvent[]): Array<{
  attachmentId: string;
  byteSize: number;
  mimeType: string;
  name: string;
}> {
  const attachments = new Map<
    string,
    { attachmentId: string; byteSize: number; mimeType: string; name: string }
  >();
  for (const event of events) {
    if (event.type !== "message.user") continue;
    const payload = event.payload as { attachments?: unknown };
    if (!Array.isArray(payload.attachments)) continue;
    for (const candidate of payload.attachments) {
      if (!isAgentAttachment(candidate)) continue;
      attachments.set(candidate.attachmentId, {
        attachmentId: candidate.attachmentId,
        byteSize: candidate.byteSize,
        mimeType: candidate.mimeType,
        name: candidate.name,
      });
    }
  }
  return [...attachments.values()];
}
