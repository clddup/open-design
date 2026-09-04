import { describe, expect, it } from "vitest";
import type { AgentToolDefinition } from "./index.js";
import {
  deliveryScopeReviewToolDefinitions,
  disclosedToolDefinitions,
  resolveModelToolDisclosurePhase,
} from "./tool-disclosure.js";
import { ModelToolDisclosureContract } from "./model-tool-disclosure-contract.js";

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
  validateInputIssues: () => [],
};

describe("model tool disclosure", () => {
  it("narrows only the Provider view and retains the trusted validator", () => {
    const [bootstrap] = disclosedToolDefinitions([definition], "bootstrap");

    expect(bootstrap).toMatchObject({
      name: definition.name,
      description: "Bootstrap probe",
      inputSchema: definition.modelDisclosure?.bootstrapInputSchema,
    });
    expect(bootstrap?.validateInputIssues({ basic: "content" })).toEqual([]);
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

  it("keeps compact rolling stages available without reopening the full Plan", () => {
    const compact = {
      ...definition,
      name: "opendesign_generate_first_slice",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "material-write" as const,
        surfaces: ["general", "new-design"] as const,
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
    const newDesignVisible = {
      ...definition,
      name: "opendesign_capture_canvas",
      modelDisclosure: {
        bootstrap: "deferred" as const,
        continuation: "available" as const,
        surfaces: ["general", "new-design"] as const,
      },
    };

    expect(
      disclosedToolDefinitions(
        [definition, compact, inspection, plan, newDesignVisible],
        "host-inspected",
        { surface: "new-design" },
      ).map((tool) => tool.name),
    ).toEqual([compact.name, inspection.name]);
    expect(
      disclosedToolDefinitions(
        [definition, compact, inspection, plan, newDesignVisible],
        "continuation",
        { surface: "new-design" },
      ).map((tool) => tool.name),
    ).toEqual([compact.name, inspection.name, newDesignVisible.name]);
    expect(
      resolveModelToolDisclosurePhase(
        [definition, compact, inspection, plan, newDesignVisible],
        [
          {
            toolCallId: "slice_observed",
            toolName: compact.name,
            input: {},
            status: "completed",
            revision: 4,
          },
        ],
        { initialInspection: true, surface: "new-design" },
      ),
    ).toBe("host-inspected");
    expect(
      resolveModelToolDisclosurePhase(
        [definition, compact, inspection, plan, newDesignVisible],
        [
          {
            toolCallId: "slice_1",
            toolName: compact.name,
            input: {},
            status: "completed",
            revision: 4,
            revisionAdvanced: true,
          },
        ],
        { initialInspection: true, surface: "new-design" },
      ),
    ).toBe("continuation");
  });

  it("keeps every ordinary continuation on its compact surface", () => {
    const generalOnly = {
      ...definition,
      name: "opendesign_manage_fonts",
      modelDisclosure: { bootstrap: "deferred" as const },
    };
    const compact = {
      ...definition,
      name: "opendesign_edit_design",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "material-write" as const,
        surfaces: ["general", "new-design"] as const,
      },
    };

    expect(
      disclosedToolDefinitions([generalOnly, compact], "continuation", {
        surface: "new-design",
      }).map((tool) => tool.name),
    ).toEqual([compact.name]);
    expect(
      disclosedToolDefinitions([generalOnly, compact], "continuation", {
        surface: "general",
      }).map((tool) => tool.name),
    ).toEqual([compact.name]);
  });

  it("uses a continuation-specific Provider schema without changing execution", () => {
    const continuationSchema = {
      type: "object",
      additionalProperties: false,
    } as const;
    const continuation = {
      ...definition,
      modelDisclosure: {
        bootstrap: "deferred" as const,
        continuation: "available" as const,
        continuationDescription: "Compact continuation",
        continuationInputSchema: continuationSchema,
      },
    };

    const [projected] = disclosedToolDefinitions(
      [continuation],
      "continuation",
      { surface: "general" },
    );

    expect(projected).toMatchObject({
      description: "Compact continuation",
      inputSchema: continuationSchema,
    });
    expect(projected?.validateInputIssues?.({})).toEqual([]);
  });

  it("expands advanced tools only after successful capability discovery", () => {
    const capabilityDiscovery = {
      ...definition,
      name: "opendesign_get_capabilities",
      modelDisclosure: {
        bootstrap: "deferred" as const,
        afterInspection: "available" as const,
        continuation: "available" as const,
        role: "capability-discovery" as const,
      },
    };
    const advanced = {
      ...definition,
      name: "opendesign_edit_vector",
      modelDisclosure: { bootstrap: "deferred" as const },
    };

    expect(
      resolveModelToolDisclosurePhase(
        [capabilityDiscovery, advanced],
        [
          {
            toolCallId: "capabilities_1",
            toolName: capabilityDiscovery.name,
            input: {},
            status: "completed",
          },
        ],
        { initialInspection: true, surface: "general" },
      ),
    ).toBe("expanded");
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

  it("shows scope review only before confirmation and restores the normal surface afterward", () => {
    const scopeReview = {
      ...definition,
      name: "opendesign_review_delivery_scope",
      modelDisclosure: {
        bootstrap: "available" as const,
        whenDeliveryScopeReview: "required" as const,
        surfaces: ["general", "new-design"] as const,
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
    const firstSlice = {
      ...definition,
      name: "opendesign_generate_first_slice",
      modelDisclosure: {
        bootstrap: "available" as const,
        role: "material-write" as const,
        surfaces: ["general", "new-design"] as const,
      },
    };

    expect(
      disclosedToolDefinitions(
        [scopeReview, inspection, firstSlice],
        "host-inspected",
        { surface: "new-design", deliveryScopeReview: "direct" },
      ).map((tool) => tool.name),
    ).toEqual([inspection.name, firstSlice.name]);
    expect(
      deliveryScopeReviewToolDefinitions(
        [scopeReview, inspection, firstSlice],
        "host-inspected",
        { surface: "new-design" },
      ).map((tool) => tool.name),
    ).toEqual([scopeReview.name, inspection.name]);
  });

  it("rejects malformed disclosure metadata at the catalog boundary", () => {
    expect(
      ModelToolDisclosureContract.issues(definition.modelDisclosure),
    ).toEqual([]);
    expect(ModelToolDisclosureContract.issues(null)).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "available",
        bootstrapInputSchema: null,
      }),
    ).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "available",
        beforePlan: "sometimes",
      }),
    ).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "available",
        extra: true,
      }),
    ).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "deferred",
        afterInspection: "sometimes",
      }),
    ).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "available",
        surfaces: ["general", "general"],
      }),
    ).not.toEqual([]);
    expect(
      ModelToolDisclosureContract.issues({
        bootstrap: "available",
        bootstrapInputSchema: { type: "array", additionalProperties: false },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "agent_tool_disclosure.schema_invalid",
        path: "/bootstrapInputSchema/type",
      }),
    ]);
  });
});
