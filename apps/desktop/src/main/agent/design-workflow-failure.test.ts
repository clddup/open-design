import { isTrustedToolFailure } from "../../shared/design-tool-bridge";
import { describe, expect, it } from "vitest";
import { trustedDesignWorkflowFailure } from "./design-workflow-failure";

describe("structured design workflow recovery", () => {
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

  it("leaves unrelated failures unchanged", () => {
    expect(
      trustedDesignWorkflowFailure(new Error("Provider disconnected")),
    ).toBeUndefined();
  });
});
