import { describe, expect, it, vi } from "vitest";
import type { AgentToolCallRecord } from "./completion-guard.js";
import { PiToolSurfaceCatalog } from "./pi-tool-surface-catalog.js";
import { createPiAgentTool } from "./pi-tool-execution.js";
import { disclosureProbeTools, tool } from "./pi-runtime-test-support.js";
import type { AgentToolDefinition } from "./runtime-ports.js";

const discoveryName = "opendesign_capabilities_probe";
const materialName = "opendesign_material_probe";
const vectorName = "opendesign_edit_vector";
const definitions = [
  ...disclosureProbeTools(),
  {
    ...tool,
    name: vectorName,
    modelDisclosure: { bootstrap: "deferred" },
  } as const,
];

function record(facts: Partial<AgentToolCallRecord> = {}): AgentToolCallRecord {
  return {
    toolCallId: "call_selection",
    toolName: discoveryName,
    status: "completed",
    input: {},
    ...facts,
  };
}

function catalog(initialInspection = false, tools = definitions) {
  const factory = vi.fn(
    (execution: AgentToolDefinition, model: AgentToolDefinition = execution) =>
      createPiAgentTool(model, () =>
        Promise.resolve({ content: [], details: {} }),
      ),
  );
  return {
    catalog: new PiToolSurfaceCatalog(tools, factory, { initialInspection }),
    factory,
  };
}

const names = (tools: readonly { name: string }[]) =>
  tools.map((tool) => tool.name);

describe("Pi directed tool surface catalog", () => {
  it("uses the original full tool for selection and leaves other schemas projected", () => {
    const { catalog: surface, factory } = catalog();
    const fullTool = surface.executionTools.find(
      (tool) => tool.name === materialName,
    );
    const material = surface.definition(materialName);
    const selected = surface.modelTools([
      record({ modelToolSelection: [materialName, vectorName] }),
    ]);
    expect(selected.find((tool) => tool.name === materialName)).toBe(fullTool);
    expect(fullTool?.parameters).toBe(material?.inputSchema);
    expect(fullTool?.description).toBe(material?.description);
    expect(factory).toHaveBeenCalledWith(material);
    expect(names(selected)).not.toContain("opendesign_advanced_probe");
    expect(names(selected)).toContain(vectorName);
    expect(selected.find((tool) => tool.name === "opendesign_plan_probe")).toBe(
      surface
        .modelTools([])
        .find((tool) => tool.name === "opendesign_plan_probe"),
    );
  });

  it("replaces rather than accumulates selection and resets to the current phase", () => {
    const { catalog: surface } = catalog(true);
    const records = [
      record({ modelToolSelection: [materialName, vectorName] }),
    ];
    records.push(record({ modelToolSelection: ["opendesign_advanced_probe"] }));
    const replacement = surface.modelTools(records);
    expect(names(replacement)).not.toContain(vectorName);
    expect(names(replacement)).toContain("opendesign_advanced_probe");
    expect(
      replacement.find((tool) => tool.name === materialName)?.parameters,
    ).toEqual(
      surface.definition(materialName)?.modelDisclosure?.bootstrapInputSchema,
    );
    records.push(record({ modelToolSelection: [] }));
    expect(surface.modelTools(records)).toEqual(surface.modelTools([]));
  });

  it("ignores omitted selections, result/input text and selections from other tools", () => {
    const { catalog: surface } = catalog();
    const selected = record({ modelToolSelection: [vectorName] });
    expect(
      surface.modelTools([
        selected,
        record({ input: { tools: [] }, result: { modelToolSelection: [] } }),
        record({ toolName: materialName, modelToolSelection: [] }),
        record({ toolName: "opendesign_unknown", modelToolSelection: [] }),
      ]),
    ).toEqual(surface.modelTools([selected]));
  });

  it("retains selection across inspection and material revisions without changing phase facts", () => {
    const { catalog: surface } = catalog();
    const records = [
      record({ modelToolSelection: [materialName, vectorName] }),
    ];
    records.push(record({ toolName: "opendesign_inspect_probe" }));
    records.push(
      record({ toolName: materialName, revision: 8, revisionAdvanced: true }),
    );
    const current = surface.modelTools(records);
    expect(names(current)).toContain(discoveryName);
    expect(names(current)).toContain(vectorName);
    expect(current.find((tool) => tool.name === materialName)?.parameters).toBe(
      surface.definition(materialName)?.inputSchema,
    );
    records.push(record({ modelToolSelection: [] }));
    expect(surface.modelTools(records)).toEqual(
      surface.modelTools(records.slice(1, -1)),
    );
  });

  it("never registers unknown, unsafe or duplicate definitions through selection", () => {
    const unsafe = { ...tool, name: "shell" };
    const { catalog: surface, factory } = catalog(false, [
      ...definitions,
      unsafe,
      tool,
      tool,
    ]);
    const registrations = factory.mock.calls.length;
    const current = surface.modelTools([
      record({
        modelToolSelection: ["shell", "opendesign_unknown", tool.name],
      }),
    ]);
    expect(names(current).filter((name) => name === tool.name)).toHaveLength(1);
    expect(names(current)).not.toContain("shell");
    expect(names(current)).not.toContain("opendesign_unknown");
    expect(factory).toHaveBeenCalledTimes(registrations);
  });

  it("allows selection of every existing tool without a selection-count gate", () => {
    const { catalog: surface } = catalog();
    expect(
      surface.modelTools([record({ modelToolSelection: names(definitions) })]),
    ).toEqual(surface.executionTools);
  });
});
