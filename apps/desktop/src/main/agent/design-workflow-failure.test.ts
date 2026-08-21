import { isTrustedToolFailure } from "../../shared/design-tool-bridge";
import { describe, expect, it } from "vitest";
import { trustedDesignWorkflowFailure } from "./design-workflow-failure";

describe("structured design workflow recovery", () => {
  it("keeps a pre-write Logo exploration correction on the compact tool without forcing inspection", () => {
    const failure = trustedDesignWorkflowFailure(
      new Error(
        "design_workflow.logo_exploration_required: Declare three directions in the compact first-slice call",
      ),
    );

    expect(failure).toEqual({
      code: "design_logo_exploration_required",
      message:
        "design_workflow.logo_exploration_required: Declare three directions in the compact first-slice call",
      retryable: false,
      recoverable: true,
    });
  });

  it("requires inspection while preserving material Plan identities", () => {
    const failure = trustedDesignWorkflowFailure(
      new Error(
        "design_workflow.plan_amendment_invalid: Material target home cannot be removed from an amended plan",
      ),
    );

    expect(failure).toMatchObject({
      code: "design_plan_amendment_invalid",
      recoverable: true,
      details: {
        recovery: {
          action: "inspect-and-revise",
          required: true,
          toolName: "opendesign_inspect_document",
        },
      },
    });
    expect(failure?.message).toContain(
      "Preserve every material targetId, pageId, artboard frameId",
    );
    expect(isTrustedToolFailure(failure)).toBe(true);
  });

  it("identifies the stale command and requires current artboard descendants", () => {
    const failure = trustedDesignWorkflowFailure(
      new Error(
        "Design command refine-home-button targets content outside every declared delivery artboard",
      ),
    );

    expect(failure).toMatchObject({
      code: "design_target_stale",
      details: {
        issues: [{ commandId: "refine-home-button" }],
      },
    });
    expect(failure?.message).toContain(
      "Use only current node IDs that are descendants of the active delivery artboard",
    );
    expect(isTrustedToolFailure(failure)).toBe(true);
  });

  it("returns one exact component repair call and forbids Plan amendment", () => {
    const failure = trustedDesignWorkflowFailure(
      new Error(
        "design_workflow.component_strategy_incomplete: Declared Component Main component-panel-header must bind Frame/Group cmp-panel-header-main on Page page_editor; call opendesign_manage_components action=create-component with rootNodeId=cmp-panel-header-main, preserve the current Plan, inspect the current document, and capture again",
      ),
    );

    expect(failure).toMatchObject({
      code: "design_component_strategy_incomplete",
      recoverable: true,
    });
    expect(failure?.message).toContain('"rootNodeId":"cmp-panel-header-main"');
    expect(failure?.message).toContain('"pageId":"page_editor"');
    expect(failure?.message).toContain("Do not submit a Plan amendment");
    expect(isTrustedToolFailure(failure)).toBe(true);
  });

  it("leaves unrelated failures unchanged", () => {
    expect(
      trustedDesignWorkflowFailure(new Error("Provider disconnected")),
    ).toBeUndefined();
  });
});
