import {
  MAX_TRANSACTION_COMMANDS,
  type ComponentDefinition,
  type DesignDocument,
  type DesignNode,
  type DesignOperation,
  type FrameNode,
  type Transform,
  type VariantProperties,
  type VariantPropertyDefinitions,
} from "@opendesign/design-contracts";
import { getLocalSelectionBounds, multiplyTransforms } from "./geometry.js";

export type VariantSetOperationFailureCode =
  | "duplicate"
  | "invalid"
  | "locked"
  | "missing-component"
  | "mixed-parent"
  | "operation-limit";

export type VariantSetOperationPlan =
  | {
      ok: true;
      commands: DesignOperation[];
      componentId: string;
      mainNodeId: string;
      variantSetId: string;
      rootNodeId: string;
      componentIds: readonly string[];
      defaultComponentId: string;
      selectionNodeIds: readonly string[];
    }
  | {
      ok: false;
      code: VariantSetOperationFailureCode;
      message: string;
    };

export function planCombineComponentsAsVariants(
  document: DesignDocument,
  input: {
    pageId: string;
    componentIds: readonly string[];
    variantSetId: string;
    rootNodeId: string;
    name: string;
    variantPropertiesByComponentId: Readonly<
      Record<string, Readonly<Record<string, string>>>
    >;
    commandPrefix: string;
    padding?: number;
  },
): VariantSetOperationPlan {
  if (!document.pagesById[input.pageId]) {
    return failure("invalid", `Page ${input.pageId} does not exist`);
  }
  if (document.variantSetsById[input.variantSetId]) {
    return failure(
      "duplicate",
      `Component set ${input.variantSetId} already exists`,
    );
  }
  if (document.nodesById[input.rootNodeId]) {
    return failure("duplicate", `Layer ${input.rootNodeId} already exists`);
  }
  const name = input.name.trim();
  if (!name || name.length > 256 || /\p{Cc}/u.test(name)) {
    return failure(
      "invalid",
      "Component set name must contain 1 to 256 non-control characters",
    );
  }
  const componentIds = [...new Set(input.componentIds)];
  if (componentIds.length !== input.componentIds.length) {
    return failure("duplicate", "A Component can appear only once in a set");
  }
  if (componentIds.length < 2) {
    return failure(
      "invalid",
      "Combine as variants requires at least two Components",
    );
  }
  if (2 + componentIds.length * 3 > MAX_TRANSACTION_COMMANDS) {
    return failure(
      "operation-limit",
      `Combining ${componentIds.length} Components exceeds the ${MAX_TRANSACTION_COMMANDS}-command transaction limit`,
    );
  }

  const components: ComponentDefinition[] = [];
  const roots: DesignNode[] = [];
  for (const componentId of componentIds) {
    const component = document.componentsById[componentId];
    if (!component) {
      return failure(
        "missing-component",
        `Component ${componentId} does not exist`,
      );
    }
    if (component.variantSetId) {
      return failure(
        "invalid",
        `Component ${componentId} already belongs to set ${component.variantSetId}`,
      );
    }
    const root = document.nodesById[component.rootNodeId];
    if (!root || (root.kind !== "frame" && root.kind !== "group")) {
      return failure(
        "missing-component",
        `Component root ${component.rootNodeId} is unavailable`,
      );
    }
    if (!nodeBelongsToPage(document, input.pageId, root.id)) {
      return failure(
        "invalid",
        `Component ${componentId} is outside Page ${input.pageId}`,
      );
    }
    if (isEffectivelyLocked(document, root.id)) {
      return failure(
        "locked",
        `Component ${componentId} or one of its ancestors is locked`,
      );
    }
    components.push(component);
    roots.push(root);
  }

  const parentId = roots[0]?.parentId ?? null;
  if (roots.some((root) => root.parentId !== parentId)) {
    return failure(
      "mixed-parent",
      "Components must share one immediate parent before combining as variants",
    );
  }
  const parent = parentId ? document.nodesById[parentId] : undefined;
  if (
    parent?.kind === "frame" &&
    (parent.properties.autoLayout?.mode ?? "none") !== "none"
  ) {
    return failure(
      "invalid",
      "Combine as variants currently requires the Page root or a non-Auto-Layout Frame parent",
    );
  }
  if (parent && parent.kind !== "frame") {
    return failure(
      "invalid",
      "Component set roots can currently be inserted only at the Page root or in a non-Auto-Layout Frame",
    );
  }
  const siblings = parentId
    ? document.nodesById[parentId]?.childIds
    : document.pagesById[input.pageId]?.rootNodeIds;
  if (!siblings || roots.some((root) => !siblings.includes(root.id))) {
    return failure("invalid", "Component hierarchy is unavailable");
  }

  const properties = normalizeVariantProperties(
    componentIds,
    input.variantPropertiesByComponentId,
  );
  if (!properties.ok) return properties;

  const bounds = getLocalSelectionBounds(roots);
  if (!bounds) {
    return failure("invalid", "Component bounds are unavailable");
  }
  const padding = input.padding ?? 40;
  if (!Number.isFinite(padding) || padding < 0 || padding > 1_024) {
    return failure("invalid", "Component set padding must be from 0 to 1024");
  }
  const setX = bounds.x - padding;
  const setY = bounds.y - padding;
  const setRoot: FrameNode = {
    id: input.rootNodeId,
    name,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, setX, setY],
    size: {
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
    },
    opacity: 1,
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: false,
    },
    extensions: { semanticRole: "component-set" },
  };
  const spatialComponents = components
    .map((component) => ({
      component,
      root: document.nodesById[component.rootNodeId]!,
    }))
    .sort(
      (left, right) =>
        left.root.transform[5] - right.root.transform[5] ||
        left.root.transform[4] - right.root.transform[4] ||
        left.component.id.localeCompare(right.component.id),
    );
  const defaultComponent = spatialComponents[0]!.component;
  const definitions: VariantPropertyDefinitions = Object.fromEntries(
    properties.propertyNames.map((propertyName) => [
      propertyName,
      {
        type: "VARIANT" as const,
        defaultValue:
          properties.byComponentId[defaultComponent.id]![propertyName]!,
        variantOptions: spatialComponents
          .map(
            ({ component }) =>
              properties.byComponentId[component.id]![propertyName]!,
          )
          .filter((value, index, values) => values.indexOf(value) === index),
      },
    ]),
  );
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_insert_set_root`,
      type: "insert_element",
      pageId: input.pageId,
      parentId,
      index: Math.min(...roots.map((root) => siblings.indexOf(root.id))),
      node: setRoot,
    },
  ];
  const toSetLocal: Transform = [1, 0, 0, 1, -setX, -setY];
  for (const [index, { component, root }] of spatialComponents.entries()) {
    commands.push(
      {
        commandId: `${input.commandPrefix}_transform_${index}`,
        type: "update_properties",
        nodeId: root.id,
        transform: multiplyTransforms(toSetLocal, root.transform),
        ...(root.constraints ? { constraints: null } : {}),
        ...(root.layoutPositioning ? { layoutPositioning: null } : {}),
        ...(root.layoutSizing ? { layoutSizing: null } : {}),
        ...(root.layoutLimits ? { layoutLimits: null } : {}),
      },
      {
        commandId: `${input.commandPrefix}_move_${index}`,
        type: "move_element",
        nodeId: root.id,
        pageId: input.pageId,
        parentId: setRoot.id,
        index,
      },
      {
        commandId: `${input.commandPrefix}_put_component_${index}`,
        type: "put_component",
        component: {
          ...structuredClone(component),
          variantSetId: input.variantSetId,
          variantProperties: structuredClone(
            properties.byComponentId[component.id]!,
          ),
        },
      },
    );
  }
  commands.push({
    commandId: `${input.commandPrefix}_put_variant_set`,
    type: "put_variant_set",
    variantSet: {
      id: input.variantSetId,
      name,
      rootNodeId: setRoot.id,
      defaultComponentId: defaultComponent.id,
      componentPropertyDefinitions: definitions,
      extensions: {},
    },
  });
  return {
    ok: true,
    commands,
    componentId: defaultComponent.id,
    mainNodeId: defaultComponent.rootNodeId,
    variantSetId: input.variantSetId,
    rootNodeId: setRoot.id,
    componentIds: spatialComponents.map(({ component }) => component.id),
    defaultComponentId: defaultComponent.id,
    selectionNodeIds: [setRoot.id],
  };
}

function normalizeVariantProperties(
  componentIds: readonly string[],
  input: Readonly<Record<string, Readonly<Record<string, string>>>>,
):
  | {
      ok: true;
      propertyNames: string[];
      byComponentId: Record<string, VariantProperties>;
    }
  | Extract<VariantSetOperationPlan, { ok: false }> {
  const inputIds = Object.keys(input).sort();
  const expectedIds = [...componentIds].sort();
  if (
    inputIds.length !== expectedIds.length ||
    inputIds.some((componentId, index) => componentId !== expectedIds[index])
  ) {
    return failure(
      "invalid",
      "Variant properties must describe every selected Component exactly once",
    );
  }
  const propertyNames = Object.keys(input[componentIds[0]!] ?? {}).sort();
  if (propertyNames.length === 0) {
    return failure("invalid", "A Component set requires a variant property");
  }
  if (
    propertyNames.some(
      (name) =>
        name !== name.trim() ||
        !name ||
        name.length > 256 ||
        name.includes("#") ||
        /\p{Cc}/u.test(name),
    )
  ) {
    return failure(
      "invalid",
      "Variant property names must be trimmed, non-control labels without #",
    );
  }
  const byComponentId: Record<string, VariantProperties> = {};
  const combinations = new Set<string>();
  for (const componentId of componentIds) {
    const raw = input[componentId] ?? {};
    const names = Object.keys(raw).sort();
    if (
      names.length !== propertyNames.length ||
      names.some((name, index) => name !== propertyNames[index])
    ) {
      return failure(
        "invalid",
        "Every Variant must define the same complete property collection",
      );
    }
    const normalized: VariantProperties = {};
    for (const propertyName of propertyNames) {
      const value = raw[propertyName]?.trim() ?? "";
      if (!value || value.length > 256 || /\p{Cc}/u.test(value)) {
        return failure(
          "invalid",
          `Variant value for ${propertyName} must contain 1 to 256 non-control characters`,
        );
      }
      normalized[propertyName] = value;
    }
    const combination = propertyNames
      .map((propertyName) => normalized[propertyName])
      .join("\u0000");
    if (combinations.has(combination)) {
      return failure(
        "duplicate",
        "Every Variant must have a unique property combination",
      );
    }
    combinations.add(combination);
    byComponentId[componentId] = normalized;
  }
  return { ok: true, propertyNames, byComponentId };
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node) {
    if (visited.has(node.id)) return false;
    visited.add(node.id);
    if (node.parentId === null) {
      return document.pagesById[pageId]?.rootNodeIds.includes(node.id) ?? false;
    }
    node = document.nodesById[node.parentId];
  }
  return false;
}

function isEffectivelyLocked(
  document: DesignDocument,
  nodeId: string,
): boolean {
  const visited = new Set<string>();
  let node: DesignNode | undefined = document.nodesById[nodeId];
  while (node) {
    if (visited.has(node.id)) return true;
    if (node.locked) return true;
    visited.add(node.id);
    node = node.parentId ? document.nodesById[node.parentId] : undefined;
  }
  return false;
}

function failure(
  code: VariantSetOperationFailureCode,
  message: string,
): Extract<VariantSetOperationPlan, { ok: false }> {
  return { ok: false, code, message };
}
