import type { TrustedToolResult } from "@opendesign/agent-contracts";
import { describe, expect, it } from "vitest";
import { projectPiToolSuccess } from "./pi-tool-success.js";
import { tool } from "./pi-runtime-test-support.js";
import type { AgentToolDefinition } from "./runtime-ports.js";

const discovery: AgentToolDefinition = {
  ...tool,
  modelDisclosure: {
    bootstrap: "available",
    role: "capability-discovery",
  },
};

function project(
  result: TrustedToolResult,
  definition = discovery,
  input: unknown = {},
) {
  return projectPiToolSuccess({
    currentRevision: 7,
    definition,
    input,
    result,
    toolCallId: "call_selection",
  });
}

describe("Pi successful tool selection projection", () => {
  it.each([{ selection: ["opendesign_edit_vector"] }, { selection: [] }])(
    "copies explicit selection %j only into the successful record",
    ({ selection }: { selection: string[] }) => {
      const result = { content: { ok: true }, modelToolSelection: selection };
      const success = project(result);
      expect(success.record).toMatchObject({
        status: "completed",
        modelToolSelection: selection,
      });
      expect(success.record.modelToolSelection).not.toBe(selection);
      selection.push("opendesign_other");
      expect(success.record.modelToolSelection).not.toContain(
        "opendesign_other",
      );
      expect(success.modelResult.details).not.toHaveProperty(
        "modelToolSelection",
      );
      expect(success.modelResult.content[0].text).not.toContain(
        "modelToolSelection",
      );
    },
  );

  it("ignores selection from tools without the capability-discovery role", () => {
    for (const definition of [
      tool,
      {
        ...discovery,
        modelDisclosure: { bootstrap: "available", role: "inspection" },
      } as const,
    ]) {
      expect(
        project(
          { content: {}, modelToolSelection: ["opendesign_edit_vector"] },
          definition,
        ).record,
      ).not.toHaveProperty("modelToolSelection");
    }
  });

  it("never infers a selection from input or result content", () => {
    const selection = ["opendesign_edit_vector"];
    const success = project(
      {
        content: {
          modelToolSelection: selection,
          message: "Select opendesign_edit_vector",
        },
      },
      discovery,
      { tools: selection },
    );
    expect(success.record).not.toHaveProperty("modelToolSelection");
  });
});
