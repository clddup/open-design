import { describe, expect, it } from "vitest";
import { AgentRequestResultContract } from "./agent-request-contract";

describe("Agent request result contract", () => {
  it("accepts exact success and structured failure results", () => {
    expect(AgentRequestResultContract.parse({ ok: true })).toEqual({
      ok: true,
      value: { ok: true },
    });
    expect(
      AgentRequestResultContract.parse({
        ok: false,
        error: {
          code: "conversation_busy",
          message: "Conversation already has an active task",
        },
      }).ok,
    ).toBe(true);
  });

  it("rejects message-only and unknown-code failures", () => {
    expect(
      AgentRequestResultContract.parse({
        ok: false,
        error: { message: "Conversation already has an active task" },
      }).ok,
    ).toBe(false);
    expect(
      AgentRequestResultContract.parse({
        ok: false,
        error: { code: "busy", message: "Busy" },
      }).ok,
    ).toBe(false);
  });
});
