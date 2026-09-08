import { describe, expect, it } from "vitest";
import { isTrustedToolFailure } from "@opendesign/agent-contracts";
import { designWorkflowError } from "@/shared/design-workflow-failure-classification";
import {
  DESIGN_SYSTEM_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
} from "@/shared/design-agent-tools.js";
import {
  friendlyAgentError,
  isNativeDesignTool,
  isRoutineRecoverableToolFailure,
  runFailurePresentation,
  structuredToolFailureDetail,
  toolFailureTitle,
  toolTitle,
} from "./timeline-presentation.js";
import type { Translate } from "./timeline-types.js";

const t: Translate = (key) => key;

describe("Agent design-system timeline presentation", () => {
  it("presents design-system work as one native visible step", () => {
    expect(isNativeDesignTool(DESIGN_SYSTEM_TOOL_NAME)).toBe(true);
    expect(toolTitle(DESIGN_SYSTEM_TOOL_NAME, "active", t)).toBe(
      "agent.updatingDesignSystem",
    );
    expect(toolTitle(DESIGN_SYSTEM_TOOL_NAME, "done", t)).toBe(
      "agent.designSystemUpdated",
    );
  });

  it("presents delivery scope review as a native planning step", () => {
    expect(isNativeDesignTool(DESIGN_DELIVERY_SCOPE_TOOL_NAME)).toBe(true);
    expect(toolTitle(DESIGN_DELIVERY_SCOPE_TOOL_NAME, "active", t)).toBe(
      "agent.preparingDeliveryPlan",
    );
    expect(toolTitle(DESIGN_DELIVERY_SCOPE_TOOL_NAME, "done", t)).toBe(
      "agent.deliveryPlanReady",
    );
  });

  it("keeps recoverable component-plan repair in the normal workflow state", () => {
    expect(
      friendlyAgentError(
        "message wording is irrelevant",
        t,
        "design_component_strategy_incomplete",
      ),
    ).toBe("agent.workflowRepairingComponents");
  });

  it("presents no-revision circuits as truthful terminal product states", () => {
    expect(toolFailureTitle("tool_protocol_no_progress", t)).toBe(
      "agent.toolProtocolNoProgress",
    );
    expect(
      structuredToolFailureDetail(
        "design_recovery_no_progress",
        "raw internal recovery detail",
        undefined,
        t,
      ),
    ).toBe("agent.designRecoveryNoProgressDetail");
    expect(
      runFailurePresentation(
        {
          code: "tool_protocol_no_progress",
          message: "raw internal protocol detail",
          retryable: false,
        },
        "fallback",
        "zh-CN",
        t,
      ),
    ).toEqual({
      title: "agent.toolProtocolNoProgress",
      detail: [
        "agent.toolProtocolNoProgressDetail",
        "agent.failureNeedsChange",
      ].join("\n"),
    });
  });

  it("shows a critic connection failure as unavailable review rather than active capture", () => {
    const message =
      "Independent visual review is unavailable: Connection error. Revision 656 is preserved.";
    const result = runFailurePresentation(
      { code: "design_visual_critic_unavailable", message, retryable: false },
      "fallback",
      "zh-CN",
      t,
    );
    expect(result.detail).toContain(message);
    expect(result.detail).toContain("agent.visualReviewUnavailable");
    expect(result.detail).toContain("agent.visualReviewUnavailableRecovery");
    expect(result.detail).not.toContain("agent.workflowCapturingCanvas");
    expect(result.detail).not.toContain("agent.failureNeedsChange");
    const failure = designWorkflowError(
      "visual_critic_unavailable",
      message,
    ).cause;
    if (!isTrustedToolFailure(failure)) throw new Error("Invalid test failure");
    const detail = structuredToolFailureDetail(
      failure.code,
      failure.message,
      failure.details,
      t,
    );
    expect(detail).toContain(message);
    expect(detail).toContain("agent.visualReviewUnavailable");
    expect(detail).not.toContain("agent.workflowCapturingCanvas");
  });

  it("presents structured tool validation by stable code and field path", () => {
    expect(
      structuredToolFailureDetail(
        "invalid_tool_input",
        "generic schema mismatch",
        {
          kind: "tool-validation",
          fingerprint: "validation_design_generation",
          issues: [
            {
              code: "design_generation.element_limit_exceeded",
              path: "/designGeneration/elements",
              message:
                "49 content elements exceed the design-generation budget",
              expected: 48,
              actual: 49,
              recovery: "Defer secondary content to continuation.",
            },
          ],
          recovery: { action: "correct-and-retry", required: false },
        },
        t,
      ),
    ).toBe(
      [
        "design_generation.element_limit_exceeded: 49 content elements exceed the design-generation budget",
        "/designGeneration/elements",
        "Defer secondary content to continuation.",
      ].join("\n"),
    );
  });

  it("uses structured design issues for transaction recovery presentation", () => {
    const details = {
      kind: "design-transaction" as const,
      fingerprint: "design_layout",
      issues: [
        {
          code: "design.layout.width_invalid",
          commandId: "resize_card",
          nodeId: "card",
          path: "/nodesById/card/size/width",
          message: "Card width exceeds its parent",
          expected: 280,
          actual: 320,
          recovery: "Reduce the card width to fit its parent.",
        },
      ],
      recovery: {
        action: "inspect-and-revise" as const,
        toolName: "opendesign_inspect_document" as const,
        required: true as const,
      },
    };

    expect(
      structuredToolFailureDetail(
        "design.invalid",
        "generic transaction failure",
        details,
        t,
      ),
    ).toBe(
      [
        "design.layout.width_invalid: Card width exceeds its parent",
        "command resize_card · node card · /nodesById/card/size/width",
        "Reduce the card width to fit its parent.",
      ].join("\n"),
    );
    expect(isRoutineRecoverableToolFailure("design.invalid", details)).toBe(
      true,
    );
    expect(
      isRoutineRecoverableToolFailure("design.permission-denied", details),
    ).toBe(false);
  });
});
