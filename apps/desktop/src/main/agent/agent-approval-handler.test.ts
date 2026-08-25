import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  type DesignDeliveryScope,
} from "@/shared/design-agent-tools.js";
import type { AgentHost } from "./agent-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleAgentApprovalRequest } from "./agent-approval-handler.js";

const scope: DesignDeliveryScope = {
  version: 1,
  deliverable: "ui",
  objective: "Design the complete product",
  targets: [
    {
      targetId: "home",
      label: "Home",
      objective: "Present the core product entry",
      requiredContent: ["Core entry"],
    },
  ],
  exclusions: [],
  assumptions: [],
};

describe("Agent approval handler", () => {
  it("preauthorizes the exact confirmed delivery scope before utility execution", () => {
    const send = vi.fn();
    const rollbackApprovalResolution = vi.fn();
    const agentHost = {
      prepareApprovalResolution: vi.fn(() => ({
        approvalId: "approval_scope",
        input: scope,
        runId: "run_scope",
        toolCallId: "scope_call",
        toolName: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
        risk: "read" as const,
      })),
      rollbackApprovalResolution,
      send,
    } as unknown as AgentHost;
    const grantDeliveryScopeAuthorization = vi.fn();
    const coordinator = {
      grantDeliveryScopeAuthorization,
      revokeDeliveryScopeAuthorization: vi.fn(),
    } as unknown as GlobalTaskCoordinator;
    const request = {
      type: "approval.resolve" as const,
      runId: "run_scope",
      toolCallId: "scope_call",
      approvalId: "approval_scope",
      decision: "allow_once" as const,
    };

    handleAgentApprovalRequest(request, {
      agentHost,
      globalTaskCoordinator: coordinator,
    });

    expect(grantDeliveryScopeAuthorization).toHaveBeenCalledWith(
      "run_scope",
      "approval_scope",
      "scope_call",
      scope,
    );
    expect(send).toHaveBeenCalledWith(request);
    expect(rollbackApprovalResolution).not.toHaveBeenCalled();
  });
});
