import type { AgentAttachment } from "@opendesign/agent-contracts";
import type { DesignDeliveryStatus } from "@opendesign/workspace-contracts";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";

export type Translate = (
  key: MessageKey,
  parameters?: MessageParameters,
) => string;

export interface AgentTimelineItem {
  id: string;
  runId?: string;
  kind?:
    | "assistant"
    | "reasoning"
    | "user"
    | "tool"
    | "run"
    | "approval"
    | "system"
    | "plan";
  state: "done" | "active" | "stopping" | "queued" | "error";
  time: string;
  title: string;
  detail?: string;
  reasoning?: string;
  reasoningCount?: number;
  attachments?: AgentAttachment[];
  toolName?: string;
  routine?: boolean;
  recoverableFailure?: boolean;
  failureCode?: string;
  failureMessage?: string;
  order: number;
  approvalId?: string;
  toolCallId?: string;
  historical?: boolean;
  plan?: {
    stage: number;
    totalTargets?: number;
    status: "active" | "verified";
    targets: Array<{
      targetId: string;
      label: string;
      objective: string;
      implementationSteps: Array<{
        label: string;
        status: "pending" | "committed";
        revision?: number;
      }>;
      status?: DesignDeliveryStatus;
    }>;
  };
}
