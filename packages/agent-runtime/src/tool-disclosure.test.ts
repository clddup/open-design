import { describe, expect, it } from "vitest";
import type { AgentToolCallRecord } from "./completion-guard.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import {
  disclosedToolDefinitions,
  resolveModelToolDisclosurePhase,
} from "./tool-disclosure.js";
import { ModelToolDisclosureContract } from "./model-tool-disclosure-contract.js";

const validateInputIssues = () => [];

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
  validateInputIssues,
};

function probe(
  name: string,
  modelDisclosure: NonNullable<AgentToolDefinition["modelDisclosure"]>,
): AgentToolDefinition {
  return { ...definition, name: `opendesign_${name}`, modelDisclosure };
}

const inspection = probe("inspect", {
  bootstrap: "available",
  role: "inspection",
});
const plan = probe("plan", { bootstrap: "available", role: "plan" });
const scope = probe("scope", {
  bootstrap: "available",
  role: "delivery-scope",
});
const material = probe("material", {
  bootstrap: "available",
  role: "material-write",
});
const edit = probe("edit", {
  bootstrap: "deferred",
  afterInspection: "available",
  continuation: "available",
  role: "material-write",
});
const discovery = probe("discovery", {
  bootstrap: "deferred",
  afterInspection: "available",
  continuation: "available",
  role: "capability-discovery",
});
const advanced = probe("advanced", { bootstrap: "deferred" });
const definitions = [
  inspection,
  plan,
  scope,
  material,
  edit,
  discovery,
  advanced,
];
const names = (tools: readonly AgentToolDefinition[]) =>
  tools.map((tool) => tool.name);
const record = (
  tool: AgentToolDefinition,
  facts: Partial<AgentToolCallRecord> = {},
): AgentToolCallRecord => ({
  toolCallId: `call_${tool.name}`,
  toolName: tool.name,
  input: {},
  status: "completed",
  ...facts,
});

describe("model tool disclosure", () => {
  it("narrows only the Provider view and retains trusted execution metadata", () => {
    const [bootstrap] = disclosedToolDefinitions([definition], "bootstrap");
    expect(bootstrap).toMatchObject({
      name: definition.name,
      description: "Bootstrap probe",
      inputSchema: definition.modelDisclosure?.bootstrapInputSchema,
      risk: definition.risk,
      approval: definition.approval,
    });
    expect(bootstrap).toHaveProperty(
      "validateInputIssues",
      validateInputIssues,
    );
  });

  it("keeps all bootstrap tools available without expanding deferred tools", () => {
    expect(names(disclosedToolDefinitions(definitions, "bootstrap"))).toEqual(
      names([inspection, plan, scope, material]),
    );
  });

  it.each(["host-inspected", "inspected"] as const)(
    "uses the same inspection availability for %s",
    (phase) => {
      expect(names(disclosedToolDefinitions(definitions, phase))).toEqual(
        names([inspection, plan, scope, material, edit, discovery]),
      );
    },
  );

  it("keeps bootstrap Plan and scope alongside explicitly available continuation tools", () => {
    const inspectionOnly = probe("inspection_only", {
      bootstrap: "deferred",
      afterInspection: "available",
    });
    const continuationOnly = probe("continuation_only", {
      bootstrap: "deferred",
      continuation: "available",
    });
    expect(
      names(
        disclosedToolDefinitions(
          [...definitions, inspectionOnly, continuationOnly],
          "continuation",
        ),
      ),
    ).toEqual(
      names([
        inspection,
        plan,
        scope,
        material,
        edit,
        discovery,
        continuationOnly,
      ]),
    );
  });

  it("uses a continuation Provider schema without replacing its validator", () => {
    const continuationSchema = {
      type: "object",
      additionalProperties: false,
    } as const;
    const continuation = probe("continuation", {
      bootstrap: "deferred",
      continuation: "available",
      continuationDescription: "Compact continuation",
      continuationInputSchema: continuationSchema,
    });
    const [projected] = disclosedToolDefinitions(
      [continuation],
      "continuation",
    );
    expect(projected).toMatchObject({
      description: "Compact continuation",
      inputSchema: continuationSchema,
    });
    expect(projected).toHaveProperty(
      "validateInputIssues",
      validateInputIssues,
    );
    const [fallback] = disclosedToolDefinitions([definition], "continuation");
    expect(fallback?.inputSchema).toBe(
      definition.modelDisclosure?.bootstrapInputSchema,
    );
  });

  it("does not expand a catalog just because its tools have no phase roles", () => {
    const unannotated = { ...definition };
    delete unannotated.modelDisclosure;
    const tools = [unannotated, advanced];
    expect(resolveModelToolDisclosurePhase(tools, [])).toBe("bootstrap");
    expect(names(disclosedToolDefinitions(tools, "bootstrap"))).toEqual(
      names([unannotated]),
    );
  });

  it.each([false, true])(
    "ignores Plan, scope, and observed revisions with initialInspection=%s",
    (initialInspection) => {
      const records = [
        record(plan, { revisionAdvanced: true }),
        record(scope),
        record(material, { revision: 4 }),
      ];
      expect(
        resolveModelToolDisclosurePhase(definitions, records, {
          initialInspection,
        }),
      ).toBe(initialInspection ? "host-inspected" : "bootstrap");
      expect(
        resolveModelToolDisclosurePhase(
          definitions,
          [...records, record(inspection)],
          { initialInspection },
        ),
      ).toBe("inspected");
    },
  );

  it("enters continuation only after a real material revision and keeps it after inspection", () => {
    const records = [record(material, { revision: 4, revisionAdvanced: true })];
    expect(resolveModelToolDisclosurePhase(definitions, records)).toBe(
      "continuation",
    );
    expect(
      resolveModelToolDisclosurePhase(definitions, [
        ...records,
        record(inspection),
      ]),
    ).toBe("continuation");
  });

  it("keeps capability discovery independent of execution-fact phases", () => {
    const write = record(material, { revisionAdvanced: true });
    const selection = record(discovery, {
      modelToolSelection: [advanced.name],
    });
    for (const records of [[record(discovery)], [selection]]) {
      expect(resolveModelToolDisclosurePhase(definitions, records)).toBe(
        "bootstrap",
      );
    }
    for (const records of [
      [write, selection],
      [selection, write],
    ]) {
      const phase = resolveModelToolDisclosurePhase(definitions, records);
      expect(phase).toBe("continuation");
      expect(disclosedToolDefinitions(definitions, phase)).not.toContain(
        advanced,
      );
    }
  });

  it.each([
    null,
    { bootstrap: "available", bootstrapInputSchema: null },
    { bootstrap: "available", extra: true },
    { bootstrap: "deferred", afterInspection: "sometimes" },
    { bootstrap: "available", role: "unknown" },
    { bootstrap: "available", beforePlan: "available" },
    { bootstrap: "available", surfaces: ["general"] },
    { bootstrap: "available", whenDeliveryScopeReview: "required" },
  ])("rejects malformed or removed disclosure metadata: %j", (metadata) => {
    expect(ModelToolDisclosureContract.issues(metadata)).not.toEqual([]);
  });

  it("accepts delivery-scope and reports exact schema failure paths", () => {
    expect(ModelToolDisclosureContract.issues(scope.modelDisclosure)).toEqual(
      [],
    );
    expect(
      ModelToolDisclosureContract.issues(definition.modelDisclosure),
    ).toEqual([]);
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
