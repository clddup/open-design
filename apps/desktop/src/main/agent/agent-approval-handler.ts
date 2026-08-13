import type { AgentRequest } from "@opendesign/agent-contracts";
import {
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  isPageStructureAccessToolInput,
} from "../../shared/design-agent-tools.js";
import type { AgentHost } from "./agent-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";

export function handleAgentApprovalRequest(
  request: Extract<AgentRequest, { type: "approval.resolve" }>,
  dependencies: {
    agentHost: AgentHost;
    globalTaskCoordinator: GlobalTaskCoordinator;
  },
): void {
  const { agentHost, globalTaskCoordinator } = dependencies;
  const pending = agentHost.prepareApprovalResolution(request);
  const pageStructureInput =
    pending.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME &&
    isPageStructureAccessToolInput(pending.input)
      ? pending.input
      : undefined;
  if (pending.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME) {
    if (pending.risk !== "design_write" || !pageStructureInput) {
      agentHost.rollbackApprovalResolution(request.approvalId);
      throw new TypeError("Invalid Page structure approval request");
    }
    if (request.decision === "allow_session") {
      agentHost.rollbackApprovalResolution(request.approvalId);
      throw new TypeError(
        "Page structure access can only be allowed for the current task",
      );
    }
  }
  const grantPageStructure =
    pageStructureInput !== undefined && request.decision === "allow_once";
  if (grantPageStructure) {
    globalTaskCoordinator.grantPageStructureAccess(
      request.runId,
      request.approvalId,
      request.toolCallId,
      pageStructureInput?.actions ?? [],
    );
  }
  try {
    agentHost.send(request);
  } catch (error) {
    agentHost.rollbackApprovalResolution(request.approvalId);
    if (grantPageStructure) {
      globalTaskCoordinator.revokePageStructureAccess(
        request.runId,
        request.approvalId,
      );
    }
    throw error;
  }
}
