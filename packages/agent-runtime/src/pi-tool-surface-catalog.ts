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
  readonly #phases: Record<ModelToolDisclosurePhase, AgentTool[]>;
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
      disclosedToolDefinitions(this.safeDefinitions, phase).map((model) => {
        const execution = this.definitions.get(model.name);
        if (!execution) {
          throw new Error(
            `Model tool ${model.name} is missing its trusted definition`,
          );
        }
        return createTool(execution, model);
      });
    this.executionTools = this.safeDefinitions.map((definition) =>
      createTool(definition),
    );
    this.#phases = {
      bootstrap: materialize("bootstrap"),
      "host-inspected": materialize("host-inspected"),
      inspected: materialize("inspected"),
      continuation: materialize("continuation"),
      expanded: materialize("expanded"),
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
    return this.#phases[phase];
  }
}
