import { describe, expect, it } from "vitest";
import type { AgentToolDefinition } from "./runtime-ports.js";
import { selectSafeDefinitions } from "./tool-definition-safety.js";

const validDefinition: AgentToolDefinition = {
  name: "opendesign_probe",
  description: "Probe the current design",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  modelDisclosure: {
    bootstrap: "available",
  },
  validateInputIssues: () => [],
};

describe("tool definition safety", () => {
  it("uses the disclosure contract and one catalog name owner", () => {
    const malformedDisclosure = {
      ...validDefinition,
      name: "opendesign_malformed",
      modelDisclosure: {
        bootstrap: "available",
        role: "unsupported",
      },
    } as unknown as AgentToolDefinition;

    expect(
      selectSafeDefinitions([
        validDefinition,
        { ...validDefinition },
        malformedDisclosure,
      ]),
    ).toEqual([validDefinition]);
  });
});
