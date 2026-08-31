import {
  BooleanOperationSchema,
  executableJsonSchema,
  PaintSchema,
  VectorGeometryIdSchema,
} from "@opendesign/design-contracts";

const HIERARCHY_ACTIONS = [
  "group",
  "ungroup",
  "create-mask",
  "set-mask-type",
  "remove-mask",
  "create-boolean",
  "set-boolean-operation",
  "ungroup-boolean",
  "reorder",
  "reparent",
] as const;

const VECTOR_ACTIONS = [
  "set-closed",
  "bend-segment",
  "set-region-fills",
  "reverse-path",
  "connect-endpoints",
  "disconnect-vertex",
  "transform-vertices",
  "transform-layers-vertices",
  "cut-path",
  "cut-with-line",
  "cut-layers-with-line",
] as const;

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const VECTOR_ID_SCHEMA = VectorGeometryIdSchema;

const LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const MASK_TYPE_SCHEMA = {
  enum: ["alpha", "vector", "luminance"],
} as const;

const ORDER_SCHEMA = {
  enum: ["bring-forward", "bring-to-front", "send-backward", "send-to-back"],
} as const;

function nodeIdsSchema(minItems: number, maxItems: number) {
  return {
    type: "array" as const,
    minItems,
    maxItems,
    uniqueItems: true,
    items: ID_SCHEMA,
  };
}

function vertexIdsSchema(minItems: number, maxItems: number) {
  return {
    type: "array" as const,
    minItems,
    maxItems,
    uniqueItems: true,
    items: VECTOR_ID_SCHEMA,
  };
}

const HIERARCHY_COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
} as const;

function compactHierarchyBranchProperty(
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (name === "nodeIds") return schema;
  if (Array.isArray(schema.enum)) return { enum: schema.enum };
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf };
  return { type: schema.type };
}

function hierarchyBranch<
  const TAction extends (typeof HIERARCHY_ACTIONS)[number],
  const TProperties extends Record<string, unknown>,
>(
  action: TAction,
  properties: TProperties,
  required: readonly (keyof TProperties & string)[],
) {
  return {
    type: "object" as const,
    properties: {
      action: { const: action },
      ...HIERARCHY_COMMON_PROPERTIES,
      ...Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => [
          name,
          compactHierarchyBranchProperty(
            name,
            schema as Record<string, unknown>,
          ),
        ]),
      ),
    },
    required: ["action", "label", "pageId", ...required],
    additionalProperties: false,
  };
}

const HIERARCHY_ACTION_BRANCHES = [
  hierarchyBranch(
    "group",
    { nodeIds: nodeIdsSchema(2, 249), groupId: ID_SCHEMA, name: NAME_SCHEMA },
    ["nodeIds", "groupId", "name"],
  ),
  hierarchyBranch("ungroup", { groupId: ID_SCHEMA }, ["groupId"]),
  hierarchyBranch(
    "create-mask",
    {
      nodeIds: nodeIdsSchema(2, 249),
      groupId: ID_SCHEMA,
      name: NAME_SCHEMA,
      maskType: MASK_TYPE_SCHEMA,
    },
    ["nodeIds", "groupId", "name", "maskType"],
  ),
  hierarchyBranch(
    "set-mask-type",
    { maskNodeId: ID_SCHEMA, maskType: MASK_TYPE_SCHEMA },
    ["maskNodeId", "maskType"],
  ),
  hierarchyBranch("remove-mask", { maskNodeId: ID_SCHEMA }, ["maskNodeId"]),
  hierarchyBranch(
    "create-boolean",
    {
      nodeIds: nodeIdsSchema(2, 249),
      booleanId: ID_SCHEMA,
      name: NAME_SCHEMA,
      operation: BooleanOperationSchema,
    },
    ["nodeIds", "booleanId", "name", "operation"],
  ),
  hierarchyBranch(
    "set-boolean-operation",
    { booleanId: ID_SCHEMA, operation: BooleanOperationSchema },
    ["booleanId", "operation"],
  ),
  hierarchyBranch("ungroup-boolean", { booleanId: ID_SCHEMA }, ["booleanId"]),
  hierarchyBranch(
    "reorder",
    { nodeIds: nodeIdsSchema(1, 500), order: ORDER_SCHEMA },
    ["nodeIds", "order"],
  ),
  hierarchyBranch(
    "reparent",
    {
      nodeIds: nodeIdsSchema(1, 500),
      parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
      index: { type: "integer", minimum: 0 },
    },
    ["nodeIds", "parentId", "index"],
  ),
] as const;

export const DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Edit explicit existing layer hierarchy and Figma-compatible sibling masks or Boolean groups. Every action has one closed field shape. Group, mask, and Boolean creation require two to 249 inspected same-parent layer IDs and a stable allocated result ID. Reorder and reparent accept one to 500 explicit IDs. The host preserves world transforms, derives Group bounds, previews the complete change, and commits one undoable transaction. Empty Groups, invalid mask sources, lossy ungrouping, cycles, locked layers, stale revisions, and unsupported Boolean operands fail in the document runtime.",
  properties: {
    action: { enum: HIERARCHY_ACTIONS },
    label: LABEL_SCHEMA,
    pageId: ID_SCHEMA,
    nodeIds: nodeIdsSchema(1, 500),
    groupId: ID_SCHEMA,
    maskNodeId: ID_SCHEMA,
    maskType: MASK_TYPE_SCHEMA,
    booleanId: ID_SCHEMA,
    operation: BooleanOperationSchema,
    parentId: { anyOf: [ID_SCHEMA, { type: "null" }] },
    index: { type: "integer", minimum: 0 },
    order: ORDER_SCHEMA,
    name: NAME_SCHEMA,
  },
  required: ["action", "label", "pageId"],
  anyOf: HIERARCHY_ACTION_BRANCHES,
  additionalProperties: false,
});

const BOUNDED_POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    y: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const BOUNDED_TRANSFORM_SCHEMA = {
  type: "array",
  minItems: 6,
  maxItems: 6,
  items: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
} as const;

const VECTOR_VERTEX_TARGET_SCHEMA = {
  type: "object",
  properties: {
    nodeId: ID_SCHEMA,
    vertexIds: vertexIdsSchema(1, 16_384),
  },
  required: ["nodeId", "vertexIds"],
  additionalProperties: false,
} as const;

const VECTOR_TARGETS_SCHEMA = {
  type: "array",
  minItems: 1,
  maxItems: 500,
  items: VECTOR_VERTEX_TARGET_SCHEMA,
} as const;

const VECTOR_CUT_AT_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        kind: { const: "vertex" },
        vertexId: VECTOR_ID_SCHEMA,
      },
      required: ["kind", "vertexId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "segment" },
        segmentId: VECTOR_ID_SCHEMA,
        t: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["kind", "segmentId", "t"],
      additionalProperties: false,
    },
  ],
} as const;

const VECTOR_COMMON_PROPERTIES = {
  label: LABEL_SCHEMA,
  pageId: ID_SCHEMA,
} as const;

const FULL_VECTOR_BRANCH_PROPERTIES = new Set([
  "at",
  "fills",
  "nodeIds",
  "point",
  "targets",
  "vertexIds",
]);

function compactVectorBranchProperty(
  name: string,
  schema: Record<string, unknown>,
): Record<string, unknown> {
  if (FULL_VECTOR_BRANCH_PROPERTIES.has(name)) return schema;
  if (Array.isArray(schema.enum)) return { enum: schema.enum };
  if (Array.isArray(schema.anyOf)) return { anyOf: schema.anyOf };
  if (schema.type === "array") {
    return { type: "array", items: { type: "number" } };
  }
  return { type: schema.type };
}

function vectorBranch<
  const TAction extends (typeof VECTOR_ACTIONS)[number],
  const TProperties extends Record<string, unknown>,
>(
  action: TAction,
  properties: TProperties,
  required: readonly (keyof TProperties & string)[],
) {
  return {
    type: "object" as const,
    properties: {
      action: { const: action },
      ...VECTOR_COMMON_PROPERTIES,
      ...Object.fromEntries(
        Object.entries(properties).map(([name, schema]) => [
          name,
          compactVectorBranchProperty(name, schema as Record<string, unknown>),
        ]),
      ),
    },
    required: ["action", "label", "pageId", ...required],
    additionalProperties: false,
  };
}

const VECTOR_ACTION_BRANCHES = [
  vectorBranch(
    "set-closed",
    {
      nodeId: ID_SCHEMA,
      pathId: VECTOR_ID_SCHEMA,
      closed: { type: "boolean" },
    },
    ["nodeId", "closed"],
  ),
  vectorBranch(
    "bend-segment",
    {
      nodeId: ID_SCHEMA,
      pathId: VECTOR_ID_SCHEMA,
      segmentId: VECTOR_ID_SCHEMA,
      t: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
      point: BOUNDED_POINT_SCHEMA,
    },
    ["nodeId", "pathId", "segmentId", "t", "point"],
  ),
  vectorBranch(
    "set-region-fills",
    {
      nodeId: ID_SCHEMA,
      regionId: VECTOR_ID_SCHEMA,
      fills: { type: "array", maxItems: 4_096, items: PaintSchema },
    },
    ["nodeId", "regionId", "fills"],
  ),
  vectorBranch(
    "reverse-path",
    { nodeId: ID_SCHEMA, pathId: VECTOR_ID_SCHEMA },
    ["nodeId"],
  ),
  vectorBranch(
    "connect-endpoints",
    { nodeId: ID_SCHEMA, vertexIds: vertexIdsSchema(2, 2) },
    ["nodeId", "vertexIds"],
  ),
  vectorBranch(
    "disconnect-vertex",
    { nodeId: ID_SCHEMA, pathId: VECTOR_ID_SCHEMA, vertexId: VECTOR_ID_SCHEMA },
    ["nodeId", "pathId", "vertexId"],
  ),
  vectorBranch(
    "transform-vertices",
    {
      nodeId: ID_SCHEMA,
      transform: BOUNDED_TRANSFORM_SCHEMA,
      vertexIds: vertexIdsSchema(1, 16_384),
    },
    ["nodeId", "transform", "vertexIds"],
  ),
  vectorBranch(
    "transform-layers-vertices",
    { targets: VECTOR_TARGETS_SCHEMA, transform: BOUNDED_TRANSFORM_SCHEMA },
    ["targets", "transform"],
  ),
  vectorBranch(
    "cut-path",
    { nodeId: ID_SCHEMA, pathId: VECTOR_ID_SCHEMA, at: VECTOR_CUT_AT_SCHEMA },
    ["nodeId", "pathId", "at"],
  ),
  vectorBranch(
    "cut-with-line",
    {
      nodeId: ID_SCHEMA,
      start: BOUNDED_POINT_SCHEMA,
      end: BOUNDED_POINT_SCHEMA,
    },
    ["nodeId", "start", "end"],
  ),
  vectorBranch(
    "cut-layers-with-line",
    {
      nodeIds: nodeIdsSchema(1, 500),
      start: BOUNDED_POINT_SCHEMA,
      end: BOUNDED_POINT_SCHEMA,
    },
    ["nodeIds", "start", "end"],
  ),
] as const;

export const DESIGN_VECTOR_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  description:
    "Edit explicit existing editable Vector Networks by stable Page, node, path, region, vertex, and segment IDs from current inspection. Every action has one closed field shape. The host derives local transforms, topology, result layer IDs, bounds, and one atomic transaction. set-region-fills applies typed paints to one inspected closed region without changing geometry. bend-segment moves one inspected point on a segment to a node-local point and derives its Bézier handles. transform-vertices uses one node-local affine matrix; transform-layers-vertices uses one document-space matrix across explicit layer targets. Paint, Bend, Cut, connect, disconnect, open, close, and reverse preserve unaffected stable IDs and reject unsupported branching or ambiguous geometry.",
  properties: {
    action: { enum: VECTOR_ACTIONS },
    label: LABEL_SCHEMA,
    pageId: ID_SCHEMA,
    nodeId: ID_SCHEMA,
    nodeIds: nodeIdsSchema(1, 500),
    pathId: VECTOR_ID_SCHEMA,
    point: BOUNDED_POINT_SCHEMA,
    regionId: VECTOR_ID_SCHEMA,
    fills: { type: "array", maxItems: 4_096, items: PaintSchema },
    segmentId: VECTOR_ID_SCHEMA,
    t: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
    vertexId: VECTOR_ID_SCHEMA,
    vertexIds: vertexIdsSchema(1, 16_384),
    transform: BOUNDED_TRANSFORM_SCHEMA,
    targets: VECTOR_TARGETS_SCHEMA,
    closed: { type: "boolean" },
    at: VECTOR_CUT_AT_SCHEMA,
    start: BOUNDED_POINT_SCHEMA,
    end: BOUNDED_POINT_SCHEMA,
  },
  required: ["action", "label", "pageId"],
  anyOf: VECTOR_ACTION_BRANCHES,
  additionalProperties: false,
});
