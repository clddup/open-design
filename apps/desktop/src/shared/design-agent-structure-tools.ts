import {
  type BooleanOperation,
  type Point,
} from "@opendesign/design-contracts";
import {
  exactKeys,
  finiteBoundedPoint,
  isRecord,
  safeId,
  safeLabel,
} from "./design-agent-validation";

export type DesignHierarchyToolInput =
  | {
      action: "group";
      label: string;
      pageId: string;
      nodeIds: string[];
      groupId: string;
      name: string;
    }
  | {
      action: "ungroup";
      label: string;
      pageId: string;
      groupId: string;
    }
  | {
      action: "create-boolean";
      label: string;
      pageId: string;
      nodeIds: string[];
      booleanId: string;
      name: string;
      operation: BooleanOperation;
    }
  | {
      action: "set-boolean-operation";
      label: string;
      pageId: string;
      booleanId: string;
      operation: BooleanOperation;
    }
  | {
      action: "ungroup-boolean";
      label: string;
      pageId: string;
      booleanId: string;
    }
  | {
      action: "reorder";
      label: string;
      pageId: string;
      nodeIds: string[];
      order:
        "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back";
    }
  | {
      action: "reparent";
      label: string;
      pageId: string;
      nodeIds: string[];
      parentId: string | null;
      index: number;
    };

export type DesignVectorToolInput =
  | {
      action: "set-closed";
      closed: boolean;
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "reverse-path";
      label: string;
      nodeId: string;
      pageId: string;
      pathId?: string;
    }
  | {
      action: "connect-endpoints";
      label: string;
      nodeId: string;
      pageId: string;
      vertexIds: [string, string];
    }
  | {
      action: "disconnect-vertex";
      label: string;
      nodeId: string;
      pageId: string;
      pathId: string;
      vertexId: string;
    }
  | {
      action: "cut-path";
      at:
        | { kind: "vertex"; vertexId: string }
        | { kind: "segment"; segmentId: string; t: number };
      label: string;
      nodeId: string;
      pageId: string;
      pathId: string;
    }
  | {
      action: "cut-with-line";
      end: Point;
      label: string;
      nodeId: string;
      pageId: string;
      start: Point;
    }
  | {
      action: "cut-layers-with-line";
      end: Point;
      label: string;
      nodeIds: string[];
      pageId: string;
      start: Point;
    };

// The exhaustive runtime schema stays the trust boundary. This compact model
// schema avoids repeating a 300+ KB node union and remains guidance only.

const MODEL_VECTOR_LOCAL_POINT_SCHEMA = {
  type: "object",
  properties: {
    x: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
    y: { type: "number", minimum: -1_000_000, maximum: 1_000_000 },
  },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const MODEL_HIERARCHY_SCHEMA = {
  type: "object",
  description:
    "For group, nodeIds, groupId, and name are required. For ungroup, groupId is required. For create-boolean, nodeIds, booleanId, name, and operation are required. For set-boolean-operation and ungroup-boolean, booleanId is required. For reorder, nodeIds and order are required. For reparent, nodeIds, parentId, and final index are required. Runtime validation enforces the action-specific shape.",
  properties: {
    action: {
      enum: [
        "group",
        "ungroup",
        "create-boolean",
        "set-boolean-operation",
        "ungroup-boolean",
        "reorder",
        "reparent",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
      description:
        "Explicit same-parent layer IDs; required for group and create-boolean (2..249), reorder (1..500), and reparent (1..500).",
    },
    groupId: { type: "string", minLength: 1, maxLength: 256 },
    booleanId: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Stable new ID for create-boolean or existing Boolean ID for set-boolean-operation and ungroup-boolean.",
    },
    operation: {
      enum: ["union", "subtract", "intersect", "exclude"],
      description:
        "Boolean operation for create-boolean or set-boolean-operation.",
    },
    parentId: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
      description:
        "Destination Frame or Group ID, or null for the Page root; required only for reparent.",
    },
    index: {
      type: "integer",
      minimum: 0,
      description:
        "Final insertion index after moved nodes are removed from the destination; required only for reparent.",
    },
    order: {
      enum: [
        "bring-forward",
        "bring-to-front",
        "send-backward",
        "send-to-back",
      ],
      description: "Stacking action; required only for reorder.",
    },
    name: {
      type: "string",
      minLength: 1,
      maxLength: 256,
      description:
        "Name for the new Group or Boolean group; required for group and create-boolean.",
    },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const;

const MODEL_VECTOR_EDIT_SCHEMA = {
  type: "object",
  description:
    "Edit explicit existing editable Vector Networks by stable Page, node, path, vertex, and segment IDs from inspection. connect-endpoints joins exactly two real open endpoints without branches; disconnect-vertex breaks one internal vertex; set-closed requires closed; cut-path requires pathId and at; cut-with-line cuts one node's supported open or closed contours using node-local points; cut-layers-with-line cuts every crossed nodeId using one finite line in document coordinates. The host derives all new geometry, result layer IDs, bounds, transforms, and one atomic transaction.",
  properties: {
    action: {
      enum: [
        "set-closed",
        "reverse-path",
        "connect-endpoints",
        "disconnect-vertex",
        "cut-path",
        "cut-with-line",
        "cut-layers-with-line",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    nodeIds: {
      type: "array",
      minItems: 1,
      maxItems: 500,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 256 },
      description:
        "Required only for cut-layers-with-line. Explicit stable Vector layer IDs from inspection, in result order.",
    },
    pathId: { type: "string", minLength: 1, maxLength: 128 },
    vertexId: { type: "string", minLength: 1, maxLength: 128 },
    vertexIds: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: { type: "string", minLength: 1, maxLength: 128 },
      description: "Required only for connect-endpoints.",
    },
    closed: {
      type: "boolean",
      description: "Required only for set-closed.",
    },
    at: {
      description:
        "Required only for cut-path. t follows the inspected path run direction and must be between 0 and 1.",
      oneOf: [
        {
          type: "object",
          properties: {
            kind: { const: "vertex" },
            vertexId: { type: "string", minLength: 1, maxLength: 128 },
          },
          required: ["kind", "vertexId"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            kind: { const: "segment" },
            segmentId: { type: "string", minLength: 1, maxLength: 128 },
            t: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["kind", "segmentId", "t"],
          additionalProperties: false,
        },
      ],
    },
    start: {
      ...MODEL_VECTOR_LOCAL_POINT_SCHEMA,
      description:
        "Required for line Cut. For cut-with-line this is node-local; for cut-layers-with-line this is document-space.",
    },
    end: {
      ...MODEL_VECTOR_LOCAL_POINT_SCHEMA,
      description:
        "Required for line Cut. For cut-with-line this is node-local; for cut-layers-with-line this is document-space.",
    },
  },
  required: ["action", "label", "pageId"],
  oneOf: [
    {
      properties: {
        action: {
          enum: [
            "set-closed",
            "reverse-path",
            "connect-endpoints",
            "disconnect-vertex",
            "cut-path",
            "cut-with-line",
          ],
        },
      },
      required: ["nodeId"],
    },
    {
      properties: { action: { const: "cut-layers-with-line" } },
      required: ["nodeIds"],
    },
  ],
  additionalProperties: false,
} as const;

export function isDesignVectorToolInput(
  input: unknown,
): input is DesignVectorToolInput {
  if (
    !isRecord(input) ||
    (input.action !== "set-closed" &&
      input.action !== "reverse-path" &&
      input.action !== "connect-endpoints" &&
      input.action !== "disconnect-vertex" &&
      input.action !== "cut-path" &&
      input.action !== "cut-with-line" &&
      input.action !== "cut-layers-with-line") ||
    !safeLabel(input.label) ||
    !safeId(input.pageId)
  ) {
    return false;
  }
  if (input.action === "cut-layers-with-line") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every((nodeId) => safeId(nodeId)) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      finiteBoundedPoint(input.start, 1_000_000) &&
      finiteBoundedPoint(input.end, 1_000_000) &&
      exactKeys(input, ["action", "end", "label", "nodeIds", "pageId", "start"])
    );
  }
  if (!safeId(input.nodeId)) return false;
  const optionalPathId =
    input.pathId === undefined ||
    (typeof input.pathId === "string" && safeId(input.pathId));
  if (!optionalPathId) return false;
  if (input.action === "connect-endpoints") {
    return (
      Array.isArray(input.vertexIds) &&
      input.vertexIds.length === 2 &&
      input.vertexIds.every((vertexId) => safeId(vertexId)) &&
      new Set(input.vertexIds).size === 2 &&
      exactKeys(input, ["action", "label", "nodeId", "pageId", "vertexIds"])
    );
  }
  if (input.action === "disconnect-vertex") {
    return (
      safeId(input.pathId) &&
      safeId(input.vertexId) &&
      exactKeys(input, [
        "action",
        "label",
        "nodeId",
        "pageId",
        "pathId",
        "vertexId",
      ])
    );
  }
  if (input.action === "set-closed") {
    return (
      typeof input.closed === "boolean" &&
      exactKeys(
        input,
        input.pathId === undefined
          ? ["action", "closed", "label", "nodeId", "pageId"]
          : ["action", "closed", "label", "nodeId", "pageId", "pathId"],
      )
    );
  }
  if (input.action === "reverse-path") {
    return exactKeys(
      input,
      input.pathId === undefined
        ? ["action", "label", "nodeId", "pageId"]
        : ["action", "label", "nodeId", "pageId", "pathId"],
    );
  }
  if (input.action === "cut-with-line") {
    return (
      finiteBoundedPoint(input.start, 1_000_000) &&
      finiteBoundedPoint(input.end, 1_000_000) &&
      exactKeys(input, ["action", "end", "label", "nodeId", "pageId", "start"])
    );
  }
  if (!safeId(input.pathId) || !isRecord(input.at)) return false;
  return (
    exactKeys(input, ["action", "at", "label", "nodeId", "pageId", "pathId"]) &&
    (input.at.kind === "vertex"
      ? safeId(input.at.vertexId) && exactKeys(input.at, ["kind", "vertexId"])
      : input.at.kind === "segment" &&
        safeId(input.at.segmentId) &&
        typeof input.at.t === "number" &&
        Number.isFinite(input.at.t) &&
        input.at.t >= 0 &&
        input.at.t <= 1 &&
        exactKeys(input.at, ["kind", "segmentId", "t"]))
  );
}

export function isDesignHierarchyToolInput(
  input: unknown,
): input is DesignHierarchyToolInput {
  if (!isRecord(input)) return false;
  const common =
    (input.action === "group" ||
      input.action === "ungroup" ||
      input.action === "create-boolean" ||
      input.action === "set-boolean-operation" ||
      input.action === "ungroup-boolean" ||
      input.action === "reorder" ||
      input.action === "reparent") &&
    typeof input.label === "string" &&
    input.label.trim().length > 0 &&
    input.label.length <= 256 &&
    safeId(input.pageId);
  if (!common) return false;
  if (input.action === "set-boolean-operation") {
    return (
      safeId(input.booleanId) &&
      isBooleanOperation(input.operation) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "booleanId", "operation"].includes(key),
      )
    );
  }
  if (input.action === "ungroup-boolean") {
    return (
      safeId(input.booleanId) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "booleanId"].includes(key),
      )
    );
  }
  if (input.action === "create-boolean") {
    return (
      safeId(input.booleanId) &&
      typeof input.name === "string" &&
      input.name.trim().length > 0 &&
      input.name.length <= 256 &&
      isBooleanOperation(input.operation) &&
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 2 &&
      input.nodeIds.length <= 249 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      Object.keys(input).every((key) =>
        [
          "action",
          "label",
          "pageId",
          "nodeIds",
          "booleanId",
          "name",
          "operation",
        ].includes(key),
      )
    );
  }
  if (input.action === "ungroup") {
    return (
      safeId(input.groupId) &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "groupId"].includes(key),
      )
    );
  }
  if (input.action === "reorder") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      (input.order === "bring-forward" ||
        input.order === "bring-to-front" ||
        input.order === "send-backward" ||
        input.order === "send-to-back") &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeIds", "order"].includes(key),
      )
    );
  }
  if (input.action === "reparent") {
    return (
      Array.isArray(input.nodeIds) &&
      input.nodeIds.length >= 1 &&
      input.nodeIds.length <= 500 &&
      input.nodeIds.every(safeId) &&
      new Set(input.nodeIds).size === input.nodeIds.length &&
      (input.parentId === null || safeId(input.parentId)) &&
      Number.isInteger(input.index) &&
      Number(input.index) >= 0 &&
      Object.keys(input).every((key) =>
        ["action", "label", "pageId", "nodeIds", "parentId", "index"].includes(
          key,
        ),
      )
    );
  }
  return (
    safeId(input.groupId) &&
    typeof input.name === "string" &&
    input.name.trim().length > 0 &&
    input.name.length <= 256 &&
    Array.isArray(input.nodeIds) &&
    input.nodeIds.length >= 2 &&
    input.nodeIds.length <= 249 &&
    input.nodeIds.every(safeId) &&
    new Set(input.nodeIds).size === input.nodeIds.length &&
    Object.keys(input).every((key) =>
      ["action", "label", "pageId", "nodeIds", "groupId", "name"].includes(key),
    )
  );
}

function isBooleanOperation(value: unknown): value is BooleanOperation {
  return (
    value === "union" ||
    value === "subtract" ||
    value === "intersect" ||
    value === "exclude"
  );
}

export const DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA = MODEL_HIERARCHY_SCHEMA;
export const DESIGN_VECTOR_TOOL_INPUT_SCHEMA = MODEL_VECTOR_EDIT_SCHEMA;
