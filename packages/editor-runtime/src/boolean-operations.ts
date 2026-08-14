import {
  MAX_TRANSACTION_COMMANDS,
  type BooleanNode,
  type BooleanOperation,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type Transform,
} from "@opendesign/design-contracts";
import { multiplyTransforms } from "./geometry.js";
import {
  analyzeContainerSelection,
  childIds,
  isEffectivelyLocked,
  nodeBelongsToPage,
  type LayerOperationFailureCode,
} from "./layer-operations.js";

export type BooleanOperationFailureCode =
  LayerOperationFailureCode | "invalid-operation" | "unsupported-operand";

export type BooleanOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      selectionNodeIds: string[];
    }
  | {
      ok: false;
      code: BooleanOperationFailureCode;
      message: string;
    };

type CurrentBooleanOperand = Extract<
  DesignNode,
  {
    kind:
      | "rectangle"
      | "ellipse"
      | "polygon"
      | "star"
      | "path"
      | "vector"
      | "boolean";
  }
>;

export function planCreateBooleanGroup(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  operation: BooleanOperation,
  options: { booleanId: string; name: string; commandPrefix: string },
): BooleanOperationPlan {
  if (!isBooleanOperation(operation)) {
    return failure("invalid-operation", "Unsupported Boolean operation");
  }
  if (document.nodesById[options.booleanId]) {
    return failure(
      "invalid-selection",
      `Node ${options.booleanId} already exists`,
    );
  }
  const eligibility = analyzeContainerSelection(document, pageId, nodeIds, {
    action: "Boolean operation",
    minimum: 2,
  });
  if (!eligibility.ok) return eligibility;
  const { bounds, ordered, parentId, siblings } = eligibility;
  const operands = ordered.map((nodeId) => document.nodesById[nodeId]!);
  const unsupported = operands.find((node) => !isCurrentBooleanOperand(node));
  if (unsupported) {
    return failure(
      "unsupported-operand",
      `${unsupported.kind} node ${unsupported.id} cannot yet be resolved to Boolean path geometry`,
    );
  }
  const roundedRegularShape = operands.find(
    (node) =>
      (node.kind === "polygon" || node.kind === "star") &&
      node.properties.cornerRadius > 0,
  );
  if (roundedRegularShape) {
    return failure(
      "visual-fidelity",
      `Rounded ${roundedRegularShape.kind} node ${roundedRegularShape.id} cannot enter a Boolean group until its exact rounded outline is available`,
    );
  }
  if (
    operands.some(
      (node) => node.maskMode !== undefined && node.maskMode !== "none",
    )
  ) {
    return failure(
      "visual-fidelity",
      "Masked layers cannot yet be converted into a Boolean group without changing their rendered result",
    );
  }
  if (1 + ordered.length * 2 > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Boolean grouping ${ordered.length} layers exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }

  const appearanceSourceId =
    operation === "subtract" ? ordered[0] : ordered.at(-1);
  const appearanceSource = appearanceSourceId
    ? document.nodesById[appearanceSourceId]
    : undefined;
  if (!appearanceSource || !isCurrentBooleanOperand(appearanceSource)) {
    return failure(
      "unsupported-operand",
      "Boolean appearance source is unavailable",
    );
  }
  const booleanTransform: Transform = [1, 0, 0, 1, bounds.x, bounds.y];
  const toBooleanLocal: Transform = [1, 0, 0, 1, -bounds.x, -bounds.y];
  const booleanNode: BooleanNode = {
    id: options.booleanId,
    kind: "boolean",
    name: options.name,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: booleanTransform,
    size: { width: bounds.width, height: bounds.height },
    opacity: appearanceSource.opacity,
    exportSettings: [],
    ...(appearanceSource.blendMode === undefined
      ? {}
      : { blendMode: appearanceSource.blendMode }),
    ...(appearanceSource.effects === undefined
      ? {}
      : { effects: structuredClone(appearanceSource.effects) }),
    properties: {
      operation,
      ...copyBooleanAppearance(appearanceSource),
    },
    extensions: {},
  };

  const commands: DesignOperation[] = [
    {
      commandId: `${options.commandPrefix}_insert`,
      type: "insert_element",
      pageId,
      parentId,
      index: Math.min(...ordered.map((nodeId) => siblings.indexOf(nodeId))),
      node: booleanNode,
    },
  ];
  for (const [index, nodeId] of ordered.entries()) {
    const node = document.nodesById[nodeId]!;
    commands.push(
      {
        commandId: `${options.commandPrefix}_transform_${index}`,
        type: "update_properties",
        nodeId,
        transform: multiplyTransforms(toBooleanLocal, node.transform),
      },
      {
        commandId: `${options.commandPrefix}_move_${index}`,
        type: "move_element",
        nodeId,
        pageId,
        parentId: options.booleanId,
        index,
      },
    );
  }
  return {
    ok: true,
    commands,
    selectionNodeIds: [options.booleanId],
  };
}

export function planSetBooleanOperation(
  document: DesignDocument,
  pageId: string,
  booleanId: string,
  operation: BooleanOperation,
  commandPrefix: string,
): BooleanOperationPlan {
  if (!isBooleanOperation(operation)) {
    return failure("invalid-operation", "Unsupported Boolean operation");
  }
  const node = document.nodesById[booleanId];
  if (!node) return failure("not-found", `Boolean ${booleanId} does not exist`);
  if (node.kind !== "boolean") {
    return failure("invalid-target", `Node ${booleanId} is not Boolean`);
  }
  if (!nodeBelongsToPage(document, pageId, node.id)) {
    return failure(
      "invalid-target",
      `Boolean ${booleanId} does not belong to page ${pageId}`,
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    return failure("locked", "Locked Boolean groups cannot be changed");
  }
  if (node.properties.operation === operation) {
    return failure(
      "invalid-operation",
      `Boolean ${booleanId} already uses ${operation}`,
    );
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${commandPrefix}_operation`,
        type: "update_properties",
        nodeId: node.id,
        properties: { operation },
      },
    ],
    selectionNodeIds: [node.id],
  };
}

export function planUngroupBooleanGroup(
  document: DesignDocument,
  pageId: string,
  booleanId: string,
  commandPrefix: string,
): BooleanOperationPlan {
  if (!document.pagesById[pageId]) {
    return failure("not-found", `Page ${pageId} does not exist`);
  }
  const node = document.nodesById[booleanId];
  if (!node) return failure("not-found", `Boolean ${booleanId} does not exist`);
  if (node.kind !== "boolean" || node.childIds.length < 2) {
    return failure(
      "invalid-target",
      "Ungrouping requires one valid Boolean group",
    );
  }
  if (!nodeBelongsToPage(document, pageId, node.id)) {
    return failure(
      "invalid-target",
      `Boolean ${booleanId} does not belong to page ${pageId}`,
    );
  }
  const children = node.childIds.map((childId) => document.nodesById[childId]);
  if (children.some((child) => !child || child.parentId !== node.id)) {
    return failure("not-found", "One or more Boolean operands are missing");
  }
  if (
    isEffectivelyLocked(document, node.id) ||
    node.childIds.some((childId) => isEffectivelyLocked(document, childId))
  ) {
    return failure(
      "locked",
      "Locked Boolean groups or operands cannot be ungrouped",
    );
  }
  if (1 + node.childIds.length * 2 > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Ungrouping ${node.childIds.length} Boolean operands exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }
  const siblings = childIds(document, pageId, node.parentId);
  const booleanIndex = siblings?.indexOf(node.id) ?? -1;
  if (!siblings || booleanIndex < 0) {
    return failure(
      "invalid-target",
      `Boolean ${booleanId} does not belong to page ${pageId}`,
    );
  }

  const commands: DesignOperation[] = [];
  for (const [index, childId] of node.childIds.entries()) {
    const child = document.nodesById[childId]!;
    commands.push(
      {
        commandId: `${commandPrefix}_transform_${index}`,
        type: "update_properties",
        nodeId: child.id,
        transform: multiplyTransforms(node.transform, child.transform),
      },
      {
        commandId: `${commandPrefix}_move_${index}`,
        type: "move_element",
        nodeId: child.id,
        pageId,
        parentId: node.parentId,
        index: booleanIndex + index,
      },
    );
  }
  commands.push({
    commandId: `${commandPrefix}_delete`,
    type: "delete_element",
    nodeId: node.id,
  });
  return {
    ok: true,
    commands,
    selectionNodeIds: [...node.childIds],
  };
}

export function canCreateBooleanGroup(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  const eligibility = analyzeContainerSelection(document, pageId, nodeIds, {
    action: "Boolean operation",
    minimum: 2,
  });
  if (!eligibility.ok) return false;
  return (
    1 + eligibility.ordered.length * 2 <= MAX_TRANSACTION_COMMANDS &&
    eligibility.ordered.every((nodeId) => {
      const node = document.nodesById[nodeId];
      return (
        node !== undefined &&
        isCurrentBooleanOperand(node) &&
        (node.maskMode === undefined || node.maskMode === "none")
      );
    })
  );
}

export function canUngroupBooleanGroup(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
): boolean {
  return (
    nodeIds.length === 1 &&
    planUngroupBooleanGroup(
      document,
      pageId,
      nodeIds[0]!,
      "boolean_capability_check",
    ).ok
  );
}

function copyBooleanAppearance(
  node: CurrentBooleanOperand,
): Omit<BooleanNode["properties"], "operation"> {
  const fillRule =
    node.kind === "path" || node.kind === "vector" || node.kind === "boolean"
      ? node.properties.fillRule
      : undefined;
  const properties = node.properties;
  return {
    fills: structuredClone(properties.fills),
    strokes: structuredClone(properties.strokes),
    strokeWidth: properties.strokeWidth,
    ...(properties.strokeAlign === undefined
      ? {}
      : { strokeAlign: properties.strokeAlign }),
    ...(properties.strokeCap === undefined
      ? {}
      : { strokeCap: properties.strokeCap }),
    ...(properties.strokeJoin === undefined
      ? {}
      : { strokeJoin: properties.strokeJoin }),
    ...(properties.dashPattern === undefined
      ? {}
      : { dashPattern: [...properties.dashPattern] }),
    ...(fillRule === undefined ? {} : { fillRule }),
  };
}

function isCurrentBooleanOperand(
  node: DesignNode,
): node is CurrentBooleanOperand {
  return (
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
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

function failure(
  code: BooleanOperationFailureCode,
  message: string,
): BooleanOperationPlan & { ok: false } {
  return { ok: false, code, message };
}
