import {
  SessionTimelineItemContract,
  type SessionTimelineItem,
} from "@opendesign/agent-contracts";

export function normalizeSessionHistory(
  timeline: readonly unknown[],
): SessionTimelineItem[] {
  return timeline.map((item, index) => {
    const parsed = SessionTimelineItemContract.parse(item);
    if (!parsed.ok) {
      throw new TypeError(
        `Session history item ${index} (${itemType(item)}) is incompatible with the current Agent protocol`,
      );
    }
    return parsed.value;
  });
}

function itemType(value: unknown): string {
  return isRecord(value) && typeof value.type === "string"
    ? value.type.slice(0, 128)
    : "unknown";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
