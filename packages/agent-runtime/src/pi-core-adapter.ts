import {
  Agent,
  type AgentOptions,
  type AgentTool,
} from "@earendil-works/pi-agent-core";

const OPENDESIGN_TOOL_PREFIX = "opendesign_";

type AgentInitialState = NonNullable<AgentOptions["initialState"]>;

export type OpenDesignPiAgentOptions = Omit<
  AgentOptions,
  | "followUpMode"
  | "getApiKey"
  | "initialState"
  | "steeringMode"
  | "toolExecution"
> & {
  initialState: Omit<AgentInitialState, "tools"> & {
    tools: AgentTool[];
  };
};

/**
 * Creates Pi's implemented headless Agent loop behind OpenDesign boundaries.
 *
 * The utility process never supplies credentials or built-in filesystem/shell
 * tools. Every registered tool must be an explicit OpenDesign host proxy and
 * executes sequentially so one assistant batch cannot race DesignDocument
 * revisions. Durable Conversation storage and compaction remain OpenDesign
 * responsibilities until Pi's harness passes the pinned-version contract gate.
 */
export function createOpenDesignPiAgent(
  options: OpenDesignPiAgentOptions,
): Agent {
  if ("getApiKey" in options) {
    throw new TypeError(
      "Pi Agent must use the Main-owned Model Gateway and cannot receive credentials",
    );
  }
  const toolNames = new Set<string>();
  const tools = options.initialState.tools.map((tool): AgentTool => {
    if (!tool.name.startsWith(OPENDESIGN_TOOL_PREFIX)) {
      throw new TypeError(
        `Pi Agent tool must use the ${OPENDESIGN_TOOL_PREFIX} namespace: ${tool.name}`,
      );
    }
    if (toolNames.has(tool.name)) {
      throw new TypeError(`Duplicate Pi Agent tool: ${tool.name}`);
    }
    toolNames.add(tool.name);
    return { ...tool, executionMode: "sequential" };
  });

  return new Agent({
    ...options,
    followUpMode: "one-at-a-time",
    initialState: { ...options.initialState, tools },
    steeringMode: "one-at-a-time",
    toolExecution: "sequential",
  });
}
