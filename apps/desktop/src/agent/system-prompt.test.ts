import { describe, expect, it } from "vitest";
import { BUILTIN_DESIGN_PLANNING_SKILLS } from "@opendesign/design-skills";
import {
  designThinkingLevelForRequest,
  OPENDESIGN_AGENT_SYSTEM_PROMPT,
} from "./system-prompt";

describe("OpenDesign Agent system prompt", () => {
  it("offers declared design methods without classifying user messages", () => {
    for (const skill of BUILTIN_DESIGN_PLANNING_SKILLS) {
      expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(`id="${skill.id}"`);
    }
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain("full Conversation");
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "UI-specific patterns are not requirements for a Logo",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain(
      'id="logo-capture-critic"',
    );
  });

  it("distinguishes contextual content language from conversational language", () => {
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Preserve the established canvas-content language",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "explicitly requested English wordmark",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain(
      "trusted design-content language:",
    );
  });

  it("lets the model select actual operations without a host-selected workflow mode", () => {
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "For a new composition, define its complete",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Ordinary inspected edits and Page operations do not require a new Plan",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "Plan is a real serial execution ledger owned by Main",
    );
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).not.toContain(
      "delivery-scope policy:",
    );
  });

  it("honors selected reasoning effort without a fast-mode override", () => {
    expect(
      designThinkingLevelForRequest({
        modelSelection: { reasoningEffort: "high" },
      }),
    ).toBe("high");
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain("produce a strong first");
    expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(
      "exact-revision independent visual review",
    );
  });

  it("keeps ownership, continuity and truthful results explicit", () => {
    for (const boundary of [
      "not a coding, shell, browser, or filesystem agent",
      "one persistent Conversation",
      "failure, cancellation, timeout, or Provider error ends only that Run",
      "Existing user and Agent-created content is equally editable",
      "Tool schemas and descriptions are the authoritative operation instructions",
      "Do not default to concentric rings",
      "Do not let one failed Run block the next user message",
      "Model text is not execution proof",
    ])
      expect(OPENDESIGN_AGENT_SYSTEM_PROMPT).toContain(boundary);
  });
});
