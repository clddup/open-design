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
  kind?: "assistant" | "user" | "tool" | "run" | "approval" | "system" | "plan";
  state: "done" | "active" | "stopping" | "queued" | "error";
  time: string;
  title: string;
  detail?: string;
  assistantBlocks?: AgentAssistantBlock[];
  attachments?: AgentAttachment[];
  toolName?: string;
  routine?: boolean;
  recoverableFailure?: boolean;
  failureCode?: string;
  failureMessage?: string;
  /** Internal document revision used for reconciliation, never rendered as UI text. */
  revision?: number;
  order: number;
  approvalId?: string;
  toolCallId?: string;
  historical?: boolean;
  plan?: {
    planRevision: number;
    stage: number;
    totalTargets?: number;
    status: "active" | "verified";
    targets: Array<{
      targetId: string;
      label: string;
      objective: string;
      implementationSteps: Array<{
        stepId: string;
        kind?: "implementation" | "review-refine";
        label: string;
        status: "pending" | "active" | "completed" | "failed";
      }>;
      status?: DesignDeliveryStatus;
    }>;
  };
}

export interface AgentAssistantBlock {
  blockId: string;
  blockIndex: number;
  type: "text" | "reasoning_summary";
  content: string;
  state: "active" | "done";
}
