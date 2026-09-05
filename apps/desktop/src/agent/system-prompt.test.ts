import { describe, expect, it } from "vitest";
import {
  agentSystemPromptForRequest,
  designThinkingLevelForRequest,
  newDesignSystemPromptForRequest,
  OPENDESIGN_AGENT_SYSTEM_PROMPT,
  OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT,
} from "./system-prompt";

describe("OpenDesign Agent system prompt", () => {
  it("keeps the new-design first-slice kernel compact and truthful", () => {
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "opendesign_generate_first_slice",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "ui-visual-direction",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "graphic-visual-direction",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "logo-visual-direction",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "graphic-capture-critic",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "first unplanned target",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain("briefFidelity");
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "semanticObjects decision",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "each Plan is one target",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "stages are semantic commits",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).not.toContain(
      "at most 48 authored elements",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "shared DesignTransaction safety limit",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "Main owns and creates the real region Frames",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "one or more planned regions",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "surfaceMode/expressiveness/density",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "When three directions are requested",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "every logoExploration direction owns a different form hypothesis",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "deliveryStage.nextTarget",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "Do not claim completion after the first slice",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain("editable SVG Path");
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "canonical fills/strokes, gradients",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "only when they serve the chosen form",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "width/height do not rescale path commands",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain(
      "inspection.document.componentCatalog",
    );
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain("linked Instances");
    expect(OPENDESIGN_NEW_DESIGN_SYSTEM_PROMPT).toContain("persistent Image");
  });

  it.each([agentSystemPromptForRequest, newDesignSystemPromptForRequest])(
    "keeps planning methods available without classifying the latest message",
    (build) => {
      const continuation = build({ prompt: "继续" });
      for (const prompt of [
        "Design a logo",
        "做一个登录页",
        "根据附件完成",
        "再改一下",
        "Continue",
      ]) {
        expect(build({ prompt })).toBe(continuation);
      }
      for (const id of [
        "ui-visual-direction",
        "ui-ux-structure",
        "graphic-visual-direction",
        "logo-visual-direction",
      ]) {
        expect(continuation).toContain(`id="${id}"`);
      }
      expect(continuation).not.toContain('id="logo-capture-critic"');
      expect(continuation).toContain("full Conversation");
    },
  );

  it("uses one quality execution policy without a fast-mode bypass", () => {
    const newDesign = newDesignSystemPromptForRequest({
      prompt: "设计一个 OpenDesign 应用图标",
    });
    const refinement = agentSystemPromptForRequest({
      prompt: "继续精修当前设计",
    });

    expect(newDesign).toContain("execution policy: produce a strong first");
    expect(newDesign).toContain("one requested Logo/Icon focused");
    expect(newDesign).not.toContain("logoOutputs is optional");
    expect(newDesign).toContain("exact-revision independent visual review");
    expect(refinement).toContain("first meaningful revision immediately");
    expect(refinement).not.toContain("Fast mode");
    expect(refinement).not.toContain("THOROUGH");
  });

  it("defines broad Delivery Plans without adding an approval pause", () => {
    const reviewed = agentSystemPromptForRequest({
      prompt: "根据 PRD 设计完整产品",
      deliveryScopeReview: "required",
    });
    expect(reviewed).toContain("DEFINITION REQUIRED");
    expect(reviewed).toContain("opendesign_review_delivery_scope");
    expect(reviewed).toContain("Do not replace requested product areas");
    expect(reviewed).toContain(
      "records stable target identities and geometry without writing empty Frames",
    );

    const direct = newDesignSystemPromptForRequest({
      prompt: "设计一个登录页面",
      deliveryScopeReview: "direct",
    });
    expect(direct).toContain("delivery-scope policy: DIRECT");
    expect(direct).toContain("do not add a planning approval step");
  });

  it("leaves content language to the user's contextual requirements, not host word counting", () => {
    const prompt = agentSystemPromptForRequest({ prompt: "继续" });
    expect(prompt).toContain(
      "Preserve the established canvas-content language",
    );
    expect(prompt).toContain("explicitly requested English wordmark");
    expect(prompt).not.toContain("trusted design-content language:");
    expect(agentSystemPromptForRequest({ prompt: "改用英文" })).toBe(prompt);
  });

  it("honors the user's selected reasoning effort on every design surface", () => {
    const request = {
      modelSelection: { reasoningEffort: "high" as const },
    };
    expect(designThinkingLevelForRequest(request, "new-design")).toBe("high");
    expect(designThinkingLevelForRequest(request, "general")).toBe("high");
  });

  it("keeps the general kernel focused on stable product rules", () => {
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "built-in visual design agent",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "not a coding, shell, browser, or filesystem agent",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "one persistent Conversation",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "failure, cancellation, timeout, or Provider error ends only that Run",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Existing user and Agent-created content is equally editable",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Plan is a real serial execution ledger owned by Main",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Tool schemas and descriptions are the authoritative operation instructions",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Do not default to concentric rings",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Do not let one failed Run block the next user message",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Model text is not execution proof",
    );
  });

  it("keeps tool-specific field manuals out of the general system kernel", () => {
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT.length).toBeLessThan(8_000);
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain("set-variable-width");
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain(
      "Current OpenDesign design capability manifest",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain(
      "exact fields action, label, pageId",
    );
  });
});
