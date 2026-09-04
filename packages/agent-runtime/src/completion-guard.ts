import type { AgentToolFailureDetails } from "@opendesign/agent-contracts";
import type { AgentRunRequest } from "./run-request.js";

export interface AgentToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  status: "completed";
  result?: unknown;
  revision?: number;
  revisionAdvanced?: true;
}

export interface AgentUnresolvedDesignWriteFailure {
  toolCallId: string;
  toolName: string;
  code: string;
  message: string;
  inspectionCompleted: boolean;
  details?: AgentToolFailureDetails;
}

export interface AgentCompletionContext {
  request: Readonly<AgentRunRequest>;
  currentRevision: number;
  turn: number;
  rejectionCount: number;
  toolCalls: readonly AgentToolCallRecord[];
  unresolvedDesignWriteFailure?: Readonly<AgentUnresolvedDesignWriteFailure>;
}

export type AgentCompletionDecision =
  { allow: true } | { allow: false; message: string; terminal?: true };

export interface CompletionGuardPort {
  review(
    context: AgentCompletionContext,
  ): AgentCompletionDecision | Promise<AgentCompletionDecision>;
}
