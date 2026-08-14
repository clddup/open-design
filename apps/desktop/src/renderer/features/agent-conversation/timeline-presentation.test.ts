import { describe, expect, it } from "vitest";
import { DESIGN_COMPONENT_TOOL_NAME } from "../../../shared/design-agent-tools.js";
import {
  friendlyAgentError,
  isNativeDesignTool,
  runFailurePresentation,
  structuredToolFailureDetail,
  toolFailureTitle,
  toolTitle,
} from "./timeline-presentation.js";
import type { Translate } from "./timeline-types.js";

const t: Translate = (key) => key;

describe("Agent component timeline presentation", () => {
  it("presents component work as a native visible design step", () => {
    expect(isNativeDesignTool(DESIGN_COMPONENT_TOOL_NAME)).toBe(true);
    expect(toolTitle(DESIGN_COMPONENT_TOOL_NAME, "active", t)).toBe(
      "agent.updatingComponents",
    );
    expect(toolTitle(DESIGN_COMPONENT_TOOL_NAME, "done", t)).toBe(
      "agent.componentsUpdated",
    );
  });

  it("keeps recoverable component-plan repair in the normal workflow state", () => {
    expect(
      friendlyAgentError(
        "design_workflow.component_strategy_incomplete: Instance is missing",
        t,
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
});
