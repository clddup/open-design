import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentToolCallRecord } from "./completion-guard.js";
import type { ModelToolSurface } from "./run-request.js";
import type { AgentToolDefinition } from "./runtime-ports.js";
import { selectSafeDefinitions } from "./tool-definition-safety.js";
import {
  deliveryScopeReviewToolDefinitions,
  disclosedToolDefinitions,
  resolveModelToolDisclosurePhase,
} from "./tool-disclosure.js";

type ToolFactory = (
  execution: AgentToolDefinition,
  model?: AgentToolDefinition,
) => AgentTool;

export class PiToolSurfaceCatalog {
  readonly #bootstrap: AgentTool[];
  readonly #continuation: AgentTool[];
  readonly #expanded: AgentTool[];
  readonly #hostInspected: AgentTool[];
  readonly #initialInspection: boolean;
  readonly #initialSurface: ModelToolSurface;
  readonly #inspected: AgentTool[];
  readonly #scopeReview: AgentTool[];
  readonly definitions = new Map<string, AgentToolDefinition>();
  readonly executionTools: AgentTool[];
  readonly safeDefinitions: readonly AgentToolDefinition[];

  constructor(
    definitions: readonly AgentToolDefinition[],
    createTool: ToolFactory,
    options: {
      initialInspection: boolean;
      initialSurface: ModelToolSurface;
    },
  ) {
    this.#initialInspection = options.initialInspection;
    this.#initialSurface = options.initialSurface;
    this.safeDefinitions = selectSafeDefinitions(definitions);
    for (const definition of this.safeDefinitions) {
      this.definitions.set(definition.name, definition);
    }
    const materialize = (visible: readonly AgentToolDefinition[]) =>
      visible.map((modelDefinition) => {
        const execution = this.definitions.get(modelDefinition.name);
        if (!execution) {
          throw new Error(
            `Model tool ${modelDefinition.name} is missing its trusted definition`,
          );
        }
        return createTool(execution, modelDefinition);
      });
    this.executionTools = this.safeDefinitions.map((definition) =>
      createTool(definition),
    );
    this.#expanded = materialize(
      disclosedToolDefinitions(this.safeDefinitions, "expanded", {
        surface: "general",
        deliveryScopeReview: "direct",
      }),
    );
    this.#continuation = materialize(
      disclosedToolDefinitions(this.safeDefinitions, "continuation", {
        surface: this.#initialSurface,
        deliveryScopeReview: "direct",
      }),
    );
    this.#bootstrap = materialize(
      disclosedToolDefinitions(this.safeDefinitions, "bootstrap", {
        surface: this.#initialSurface,
        deliveryScopeReview: "direct",
      }),
    );
    this.#hostInspected = materialize(
      disclosedToolDefinitions(this.safeDefinitions, "host-inspected", {
        surface: this.#initialSurface,
        deliveryScopeReview: "direct",
      }),
    );
    this.#inspected = materialize(
      disclosedToolDefinitions(this.safeDefinitions, "inspected", {
        surface: this.#initialSurface,
        deliveryScopeReview: "direct",
      }),
    );
    this.#scopeReview = materialize(
      deliveryScopeReviewToolDefinitions(
        this.safeDefinitions,
        this.#initialInspection ? "host-inspected" : "bootstrap",
        { surface: this.#initialSurface },
      ),
    );
  }

  definition(toolName: string): AgentToolDefinition | undefined {
    return this.definitions.get(toolName);
  }

  modelTools(
    records: readonly AgentToolCallRecord[],
    deliveryScopeReview: "direct" | "required" | undefined,
  ): readonly AgentTool[] {
    if (
      deliveryScopeReview === "required" &&
      !records.some(
        (record) =>
          this.definition(record.toolName)?.modelDisclosure
            ?.whenDeliveryScopeReview === "required",
      )
    ) {
      return this.#scopeReview;
    }
    const phase = resolveModelToolDisclosurePhase(
      this.safeDefinitions,
      records,
      {
        initialInspection: this.#initialInspection,
        surface: this.#initialSurface,
      },
    );
    if (phase === "bootstrap") return this.#bootstrap;
    if (phase === "host-inspected") return this.#hostInspected;
    if (phase === "inspected") return this.#inspected;
    if (phase === "continuation") return this.#continuation;
    return this.#expanded;
  }
}
