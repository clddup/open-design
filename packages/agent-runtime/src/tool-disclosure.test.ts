import { describe, expect, it } from "vitest";
import type { AgentToolDefinition } from "./index.js";
import {
  disclosedToolDefinitions,
  isSafeModelDisclosure,
  resolveModelToolDisclosurePhase,
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

  it("isolates the compact new-design surface and continues without reopening the full Plan after material revision", () => {
    const compact = {
      ...definition,
      name: "opendesign_generate_first_slice",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "material-write" as const,
        surfaces: ["new-design"] as const,
      },
    };
    const inspection = {
      ...definition,
      name: "opendesign_inspect_document",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "inspection" as const,
        surfaces: ["general", "new-design"] as const,
      },
    };
    const plan = {
      ...definition,
      name: "opendesign_define_design_plan",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "plan" as const,
      },
    };

    expect(
      disclosedToolDefinitions(
        [definition, compact, inspection, plan],
        "host-inspected",
        { surface: "new-design" },
      ).map((tool) => tool.name),
    ).toEqual([compact.name, inspection.name]);
    expect(
      disclosedToolDefinitions(
        [definition, compact, inspection, plan],
        "continuation",
        { surface: "new-design" },
      ).map((tool) => tool.name),
    ).toEqual([definition.name, inspection.name]);
    expect(
      resolveModelToolDisclosurePhase(
        [definition, compact, inspection, plan],
        [
          {
            toolCallId: "slice_1",
            toolName: compact.name,
            input: {},
            status: "completed",
            revision: 4,
          },
        ],
        { initialInspection: true, surface: "new-design" },
      ),
    ).toBe("continuation");
  });

  it("allows a compact first material slice beside Plan on the host-inspected surface", () => {
    const inspection = {
      ...definition,
      name: "opendesign_inspect_document",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "inspection" as const,
      },
    };
    const plan = {
      ...definition,
      name: "opendesign_define_design_plan",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "plan" as const,
      },
    };
    const material = {
      ...definition,
      name: "opendesign_apply_transaction",
      modelDisclosure: {
        bootstrap: "available" as const,
        beforePlan: "available" as const,
        role: "material-write" as const,
      },
    };
    const definitions = [inspection, plan, material];

    expect(
      disclosedToolDefinitions(definitions, "host-inspected").map(
        (tool) => tool.name,
      ),
    ).toEqual([inspection.name, plan.name, material.name]);
    expect(
      resolveModelToolDisclosurePhase(definitions, [], {
        initialInspection: true,
      }),
    ).toBe("host-inspected");
    expect(
      resolveModelToolDisclosurePhase(
        definitions,
        [
          {
            toolCallId: "read_1",
            toolName: "opendesign_read_image",
            input: { source: "image_reference" },
            status: "completed",
          },
        ],
        { initialInspection: true },
      ),
    ).toBe("host-inspected");
    expect(
      resolveModelToolDisclosurePhase(
        definitions,
        [
          {
            toolCallId: "plan_1",
            toolName: plan.name,
            input: { targets: [{ artboard: { mode: "create" } }] },
            status: "completed",
            revision: 1,
          },
        ],
        { initialInspection: true },
      ),
    ).toBe("inspected");
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
      isSafeModelDisclosure({
        bootstrap: "available",
        beforePlan: "sometimes",
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
