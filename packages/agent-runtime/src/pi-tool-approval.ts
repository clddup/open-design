import type {
  ApprovalDecision,
  RunStopReason,
  ToolRisk,
} from "@opendesign/agent-contracts";
import type { AgentRunRequest } from "./run-request.js";
import type {
  AgentToolDefinition,
  ApprovalPort,
  ApprovalRequest,
} from "./runtime-ports.js";
import { resolveApprovalPrompt } from "./pi-tool-protocol.js";
import { createTrustedToolContext } from "./tool-execution-semantics.js";

export interface PiToolApprovalRequested {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  title: string;
  summary: string;
  risk: ToolRisk;
}

export interface PiToolApprovalResolved {
  approvalId: string;
  toolCallId: string;
  decision: ApprovalDecision;
  resolvedAt: string;
}

export interface PiToolLifecyclePort {
  approvalRequested(event: PiToolApprovalRequested): Promise<void>;
  approvalResolved(event: PiToolApprovalResolved): Promise<void>;
}

export type PiToolApprovalOutcome =
  | { allowed: true; approveForRun: boolean }
  | {
      allowed: false;
      code: string;
      message: string;
      terminate: boolean;
      stopReason?: RunStopReason;
    };

export async function requestPiToolApproval(options: {
  approvalPort?: ApprovalPort;
  currentRevision: number;
  definition: AgentToolDefinition;
  input: unknown;
  lifecycle: PiToolLifecyclePort;
  now: () => Date;
  request: Readonly<AgentRunRequest>;
  signal: AbortSignal;
  toolCallId: string;
}): Promise<PiToolApprovalOutcome> {
  const approvalId = `${options.toolCallId}_approval`;
  const prompt = resolveApprovalPrompt(
    options.definition.approvalPrompt,
    options.input,
    options.request,
    options.definition.name,
    options.definition.risk,
  );
  const approval = {
    approvalId,
    toolCallId: options.toolCallId,
    toolName: options.definition.name,
    title: prompt.title,
    summary: prompt.summary,
    risk: options.definition.risk,
  } satisfies ApprovalRequest;
  await options.lifecycle.approvalRequested(approval);
  if (!options.approvalPort) {
    return blocked("approval_unavailable", "Tool requires host approval");
  }
  const decision = await options.approvalPort.requestApproval(
    approval,
    createTrustedToolContext(options.request, options.currentRevision),
    options.signal,
  );
  await options.lifecycle.approvalResolved({
    approvalId,
    toolCallId: options.toolCallId,
    decision,
    resolvedAt: options.now().toISOString(),
  });
  if (options.signal.aborted) {
    return blocked(
      "run_cancelled",
      "Tool call was cancelled before execution",
      true,
      "cancelled",
    );
  }
  if (decision === "deny") {
    const cancelRun = options.definition.approvalDenial === "cancel-run";
    return blocked(
      "approval_denied",
      "Host denied this tool call",
      cancelRun,
      cancelRun ? "cancelled" : undefined,
    );
  }
  return {
    allowed: true,
    approveForRun: options.definition.approvalScope === "run",
  };
}

function blocked(
  code: string,
  message: string,
  terminate = false,
  stopReason?: RunStopReason,
): PiToolApprovalOutcome {
  return {
    allowed: false,
    code,
    message,
    terminate,
    ...(stopReason ? { stopReason } : {}),
  };
}
