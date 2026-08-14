import { describe, expect, it } from "vitest";
import { DESIGN_COMPONENT_TOOL_NAME } from "../../../shared/design-agent-tools.js";
import {
  friendlyAgentError,
  isNativeDesignTool,
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
      "agent.hierarchyUpdated",
    );
  });

  it("keeps recoverable component-plan repair in the normal workflow state", () => {
    expect(
      friendlyAgentError(
        "design_workflow.component_strategy_incomplete: Instance is missing",
        t,
      ),
    ).toBe("agent.workflowApplyingDraft");
  });
});
