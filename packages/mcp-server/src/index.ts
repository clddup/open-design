import type {
  DesignEngineAdapter,
  DesignQuery,
} from "@opendesign/design-engine";

export const DEFAULT_TREE_DEPTH = 2;
export const DEFAULT_NODE_LIMIT = 150;
export const MAX_STRUCTURED_BYTES = 256 * 1024;

export interface DesignMcpTool {
  name: string;
  description: string;
  readOnly: true;
  execute(input: unknown): Promise<unknown>;
}

export function createReadOnlyDesignTools(
  engine: DesignEngineAdapter,
): DesignMcpTool[] {
  return [
    queryTool(
      engine,
      "get_node_outline",
      "Read a shallow outline of the current design or a target node.",
      (input) => createOutlineQuery(input),
    ),
    queryTool(
      engine,
      "get_node_tree",
      "Read a bounded design subtree at a pinned document revision.",
      (input) => createOutlineQuery(input, requiredString(input, "nodeId")),
    ),
    queryTool(
      engine,
      "get_computed_layout",
      "Read computed layout for selected design nodes.",
      (input) => ({
        type: "read_layout_snapshot",
        nodeIds: requiredStringArray(input, "nodeIds"),
      }),
    ),
  ];
}

function createOutlineQuery(
  input: Record<string, unknown>,
  requiredNodeId?: string,
): DesignQuery {
  const nodeId = requiredNodeId ?? optionalString(input, "nodeId");
  const cursor = optionalString(input, "cursor");
  return {
    type: "read_document_outline",
    depth: optionalNumber(input, "depth") ?? DEFAULT_TREE_DEPTH,
    limit: optionalNumber(input, "limit") ?? DEFAULT_NODE_LIMIT,
    ...(nodeId ? { rootNodeId: nodeId } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

function queryTool(
  engine: DesignEngineAdapter,
  name: string,
  description: string,
  createQuery: (input: Record<string, unknown>) => DesignQuery,
): DesignMcpTool {
  return {
    name,
    description,
    readOnly: true,
    async execute(input) {
      const result = await engine.inspect(createQuery(asRecord(input)));
      const bytes = new TextEncoder().encode(JSON.stringify(result)).byteLength;
      if (bytes > MAX_STRUCTURED_BYTES) {
        throw new Error(`${name} result exceeds ${MAX_STRUCTURED_BYTES} bytes`);
      }
      return result;
    },
  };
}

function asRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool input must be an object");
  }
  return input as Record<string, unknown>;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  return requiredString(input, key);
}

function optionalNumber(
  input: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function requiredStringArray(
  input: Record<string, unknown>,
  key: string,
): string[] {
  const value = input[key];
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new Error(`${key} must be a string array`);
  }
  return value;
}
