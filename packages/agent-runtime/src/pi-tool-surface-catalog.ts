import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentToolCallRecord } from "./completion-guard.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import { selectSafeDefinitions } from "./tool-definition-safety.js";
import {
  disclosedToolDefinitions,
  resolveModelToolDisclosurePhase,
  type ModelToolDisclosurePhase,
} from "./tool-disclosure.js";

type ToolFactory = (
  execution: AgentToolDefinition,
  model?: AgentToolDefinition,
) => AgentTool;

export class PiToolSurfaceCatalog {
  readonly #phases: Record<ModelToolDisclosurePhase, Map<string, AgentTool>>;
  readonly #initialInspection: boolean;
  readonly definitions = new Map<string, AgentToolDefinition>();
  readonly executionTools: AgentTool[];
  readonly safeDefinitions: readonly AgentToolDefinition[];

  constructor(
    definitions: readonly AgentToolDefinition[],
    createTool: ToolFactory,
    options: { initialInspection: boolean },
  ) {
    this.#initialInspection = options.initialInspection;
    this.safeDefinitions = selectSafeDefinitions(definitions);
    for (const definition of this.safeDefinitions) {
      this.definitions.set(definition.name, definition);
    }
    const materialize = (phase: ModelToolDisclosurePhase) =>
      new Map(
        disclosedToolDefinitions(this.safeDefinitions, phase).map((model) => {
          const execution = this.definitions.get(model.name);
          if (!execution) {
            throw new Error(
              `Model tool ${model.name} is missing its trusted definition`,
            );
          }
          return [model.name, createTool(execution, model)] as const;
        }),
      );
    this.executionTools = this.safeDefinitions.map((definition) =>
      createTool(definition),
    );
    this.#phases = {
      bootstrap: materialize("bootstrap"),
      "host-inspected": materialize("host-inspected"),
      inspected: materialize("inspected"),
      continuation: materialize("continuation"),
    };
  }

  definition(toolName: string): AgentToolDefinition | undefined {
    return this.definitions.get(toolName);
  }

  modelTools(records: readonly AgentToolCallRecord[]): readonly AgentTool[] {
    const phase = resolveModelToolDisclosurePhase(
      this.safeDefinitions,
      records,
      { initialInspection: this.#initialInspection },
    );
    const selected = new Set(this.#latestSelection(records));
    const projected = this.#phases[phase];
    return this.executionTools.flatMap((tool) => {
      if (selected.has(tool.name)) return [tool];
      const model = projected.get(tool.name);
      return model ? [model] : [];
    });
  }

  #latestSelection(records: readonly AgentToolCallRecord[]) {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (
        record?.modelToolSelection !== undefined &&
        this.definition(record.toolName)?.modelDisclosure?.role ===
          "capability-discovery"
      ) {
        return record.modelToolSelection;
      }
    }
    return undefined;
  }
}
