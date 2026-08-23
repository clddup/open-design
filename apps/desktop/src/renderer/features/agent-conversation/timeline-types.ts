import type { AgentAttachment } from "@opendesign/agent-contracts";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";

export type Translate = (
  key: MessageKey,
  parameters?: MessageParameters,
) => string;

export interface AgentTimelineItem {
  id: string;
  runId?: string;
  kind?:
    "assistant" | "reasoning" | "user" | "tool" | "run" | "approval" | "system";
  state: "done" | "active" | "stopping" | "queued" | "error";
  time: string;
  title: string;
  detail?: string;
  reasoning?: string;
  reasoningCount?: number;
  attachments?: AgentAttachment[];
  toolName?: string;
  routine?: boolean;
  order: number;
  approvalId?: string;
  toolCallId?: string;
  historical?: boolean;
}
