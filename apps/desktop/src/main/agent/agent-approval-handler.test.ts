import { describe, expect, it, vi } from "vitest";
import { PAGE_STRUCTURE_ACCESS_TOOL_NAME } from "@/shared/design-agent-tools.js";
import type { AgentHost } from "./agent-host.js";
import type { GlobalTaskCoordinator } from "./global-task-coordinator.js";
import { handleAgentApprovalRequest } from "./agent-approval-handler.js";

describe("Agent approval handler", () => {
  it("preauthorizes approved Page structure access before utility execution", () => {
    const send = vi.fn();
    const rollbackApprovalResolution = vi.fn();
    const agentHost = {
      prepareApprovalResolution: vi.fn(() => ({
        approvalId: "approval_pages",
        input: {
          actions: ["create-page"],
          reason: "Create the requested research Page",
        },
        runId: "run_pages",
        toolCallId: "pages_call",
        toolName: PAGE_STRUCTURE_ACCESS_TOOL_NAME,
        risk: "design_write" as const,
      })),
      rollbackApprovalResolution,
      send,
    } as unknown as AgentHost;
    const grantPageStructureAccess = vi.fn();
    const coordinator = {
      grantPageStructureAccess,
      revokePageStructureAccess: vi.fn(),
    } as unknown as GlobalTaskCoordinator;
    const request = {
      type: "approval.resolve" as const,
      runId: "run_pages",
      toolCallId: "pages_call",
      approvalId: "approval_pages",
      decision: "allow_once" as const,
    };

    handleAgentApprovalRequest(request, {
      agentHost,
      globalTaskCoordinator: coordinator,
    });

    expect(grantPageStructureAccess).toHaveBeenCalledWith(
      "run_pages",
      "approval_pages",
      "pages_call",
      ["create-page"],
    );
    expect(send).toHaveBeenCalledWith(request);
    expect(rollbackApprovalResolution).not.toHaveBeenCalled();
  });
});
