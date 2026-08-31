import { describe, expect, it } from "vitest";
import { projectAgentEvent } from "./agent-event";

describe("projectAgentEvent", () => {
  it("preserves an already valid Agent event", () => {
    const event = {
      type: "agent.connected",
      protocolVersion: "3.13.0",
    } as const;
    expect(projectAgentEvent(event)).toBe(event);
  });

  it("turns an invalid Main event into a visible correlated error", () => {
    const projected = projectAgentEvent({
      type: "session.history",
      requestId: "history_invalid_1",
      sessionId: "session_1",
      timeline: "invalid",
    });
    expect(projected).toMatchObject({
      type: "agent.error",
      code: "invalid_main_event",
      requestId: "history_invalid_1",
    });
    expect(projected.type).toBe("agent.error");
    if (projected.type !== "agent.error") return;
    expect(projected.message).toContain(
      "agent_event.schema_invalid at /timeline",
    );
  });
});
