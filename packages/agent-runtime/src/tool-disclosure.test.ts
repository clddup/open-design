import { describe, expect, it } from "vitest";
import type { AgentToolDefinition } from "./index.js";
import {
  disclosedToolDefinitions,
  isSafeModelDisclosure,
} from "./tool-disclosure.js";

const definition: AgentToolDefinition = {
  name: "opendesign_probe",
  description: "Complete probe",
  inputSchema: {
    type: "object",
    properties: { advanced: { type: "string" } },
    additionalProperties: false,
  },
  risk: "read",
  approval: "never",
  modelDisclosure: {
    bootstrap: "available",
    bootstrapDescription: "Bootstrap probe",
    bootstrapInputSchema: {
      type: "object",
      properties: { basic: { type: "string" } },
      additionalProperties: false,
    },
  },
  validateInput: () => true,
};

describe("model tool disclosure", () => {
  it("narrows only the Provider view and retains the trusted validator", () => {
    const [bootstrap] = disclosedToolDefinitions([definition], "bootstrap");

    expect(bootstrap).toMatchObject({
      name: definition.name,
      description: "Bootstrap probe",
      inputSchema: definition.modelDisclosure?.bootstrapInputSchema,
    });
    expect(bootstrap?.validateInput({ basic: "content" })).toBe(true);
    expect(disclosedToolDefinitions([definition], "expanded")[0]).toBe(
      definition,
    );
  });

  it("adds inspection-dependent tools without expanding the complete catalog", () => {
    const exportDefinition: AgentToolDefinition = {
      ...definition,
      name: "opendesign_export_probe",
      modelDisclosure: {
        bootstrap: "deferred",
        afterInspection: "available",
      },
    };

    expect(
      disclosedToolDefinitions([definition, exportDefinition], "bootstrap").map(
        (tool) => tool.name,
      ),
    ).toEqual([definition.name]);
    expect(
      disclosedToolDefinitions([definition, exportDefinition], "inspected").map(
        (tool) => tool.name,
      ),
    ).toEqual([definition.name, exportDefinition.name]);
  });

  it("rejects malformed disclosure metadata at the catalog boundary", () => {
    expect(isSafeModelDisclosure(definition.modelDisclosure)).toBe(true);
    expect(isSafeModelDisclosure(null as never)).toBe(false);
    expect(
      isSafeModelDisclosure({
        bootstrap: "available",
        bootstrapInputSchema: null,
      } as never),
    ).toBe(false);
    expect(
      isSafeModelDisclosure({ bootstrap: "available", extra: true } as never),
    ).toBe(false);
    expect(
      isSafeModelDisclosure({
        bootstrap: "deferred",
        afterInspection: "sometimes",
      } as never),
    ).toBe(false);
  });
});
