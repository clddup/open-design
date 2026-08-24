import type { AgentRequest } from "@opendesign/agent-contracts";
import {
  DeliveryScopeContract,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  PageStructureAccessContract,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
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
  const pageStructureResult =
    pending.toolName === PAGE_STRUCTURE_ACCESS_TOOL_NAME
      ? PageStructureAccessContract.parse(pending.input)
      : undefined;
  const pageStructureInput =
    pageStructureResult?.ok === true ? pageStructureResult.value : undefined;
  const deliveryScopeResult =
    pending.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME
      ? DeliveryScopeContract.parse(pending.input)
      : undefined;
  const deliveryScopeInput =
    deliveryScopeResult?.ok === true ? deliveryScopeResult.value : undefined;
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
  if (pending.toolName === DESIGN_DELIVERY_SCOPE_TOOL_NAME) {
    if (
      pending.risk !== "read" ||
      !deliveryScopeInput ||
      request.decision === "allow_session"
    ) {
      agentHost.rollbackApprovalResolution(request.approvalId);
      throw new TypeError(
        "Delivery scope can only be approved once for the current task",
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
  const grantDeliveryScope =
    deliveryScopeInput !== undefined && request.decision === "allow_once";
  if (grantDeliveryScope) {
    globalTaskCoordinator.grantDeliveryScopeAuthorization(
      request.runId,
      request.approvalId,
      request.toolCallId,
      deliveryScopeInput,
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
    if (grantDeliveryScope) {
      globalTaskCoordinator.revokeDeliveryScopeAuthorization(
        request.runId,
        request.approvalId,
      );
    }
    throw error;
  }
}
