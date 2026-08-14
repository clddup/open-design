import {
  DesignNodeSchema,
  schemaValidationIssues,
  type ComponentPropertyAssignment,
  type ComponentPropertyDefinition,
  type ComponentPropertyDefinitions,
  type ComponentOverridePatch,
  type DesignDocument,
  type DesignNode,
  type InstanceNode,
} from "@opendesign/design-contracts";

export const COMPONENT_SERVICE_VERSION = 2 as const;
export const COMPONENT_PROJECTION_PREFIX = "__opendesign_instance__:";

export type ComponentResolutionIssueCode =
  | "component-cycle"
  | "invalid-component-property"
  | "invalid-override"
  | "missing-component"
  | "missing-source-node";

export interface ComponentResolutionIssue {
  code: ComponentResolutionIssueCode;
  instanceId: string;
  message: string;
  sourcePath?: readonly string[];
}

export interface ResolvedComponentNode {
  instanceId: string;
  node: DesignNode;
  parentProjectionId: string | null;
  projectionId: string;
  root: boolean;
  sourceNodeId: string;
  sourcePath: readonly string[];
}

export interface ResolvedComponentOverrideTarget {
  node: DesignNode;
  sourceNodeId: string;
  sourcePath: readonly string[];
}

export interface ResolvedComponentProperty {
  type: ComponentPropertyDefinition["type"];
  value: ComponentPropertyAssignment;
  preferredValues?: readonly {
    type: "COMPONENT" | "COMPONENT_SET";
    key: string;
  }[];
}

export type ComponentInstanceResolution =
  | {
      ok: true;
      componentId: string;
      componentProperties: Readonly<Record<string, ResolvedComponentProperty>>;
      instanceId: string;
      nodes: readonly ResolvedComponentNode[];
      overrideTargets: readonly ResolvedComponentOverrideTarget[];
      sourcePaths: ReadonlySet<string>;
    }
  | {
      ok: false;
      componentId: string;
      instanceId: string;
      issues: readonly ComponentResolutionIssue[];
    };

export function componentSourcePathKey(sourcePath: readonly string[]): string {
  return sourcePath.map(encodeURIComponent).join("/");
}

export function componentProjectionId(
  instanceId: string,
  sourcePath: readonly string[] | string,
): string {
  const path = typeof sourcePath === "string" ? [sourcePath] : sourcePath;
  return `${COMPONENT_PROJECTION_PREFIX}${encodeURIComponent(instanceId)}:${componentSourcePathKey(path)}`;
}

export function componentSourceNodeIds(
  document: DesignDocument,
  componentId: string,
): ReadonlySet<string> {
  const definition = document.componentsById[componentId];
  const result = new Set<string>();
  if (!definition) return result;
  const visit = (nodeId: string): void => {
    if (result.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  visit(definition.rootNodeId);
  return result;
}

export function componentIdForSourceNode(
  document: DesignDocument,
  sourceNodeId: string,
): string | null {
  for (const componentId of Object.keys(document.componentsById).sort()) {
    if (componentSourceNodeIds(document, componentId).has(sourceNodeId)) {
      return componentId;
    }
  }
  return null;
}

export function resolveComponentInstance(
  document: DesignDocument,
  instanceId: string,
): ComponentInstanceResolution {
  const instance = document.nodesById[instanceId];
  if (!instance || instance.kind !== "instance") {
    return {
      ok: false,
      componentId: "",
      instanceId,
      issues: [
        {
          code: "missing-source-node",
          instanceId,
          message: `Instance ${instanceId} does not exist`,
        },
      ],
    };
  }
  return resolveInstance(document, instance);
}

export function materializeComponentInstances(
  document: DesignDocument,
): DesignDocument {
  const projectedDocument = materializeComponentMainProperties(document);
  if (
    !Object.values(projectedDocument.nodesById).some(
      (node) => node.kind === "instance",
    )
  ) {
    return projectedDocument;
  }
  const nodesById: DesignDocument["nodesById"] = {
    ...projectedDocument.nodesById,
  };
  for (const node of Object.values(projectedDocument.nodesById)) {
    if (node.kind !== "instance") continue;
    const resolution = resolveComponentInstance(projectedDocument, node.id);
    if (!resolution.ok) {
      throw new Error(
        resolution.issues[0]?.message ??
          `Instance ${node.id} cannot be resolved`,
      );
    }
    delete nodesById[node.id];
    for (const resolved of resolution.nodes) {
      nodesById[resolved.projectionId] = structuredClone(resolved.node);
    }
  }
  return { ...projectedDocument, nodesById };
}

export function materializeComponentMainProperties(
  document: DesignDocument,
): DesignDocument {
  const hasReferences = Object.values(document.nodesById).some(
    (node) => node.componentPropertyReferences !== undefined,
  );
  if (!hasReferences) return document;
  const nodesById = { ...document.nodesById };
  for (const component of Object.values(document.componentsById)) {
    const properties = effectiveComponentProperties(
      document,
      component.id,
      {},
      "component-main",
    );
    if (!properties.ok) {
      throw new Error(
        properties.issues[0]?.message ?? "Invalid component property",
      );
    }
    for (const sourceNodeId of componentSourceNodeIds(document, component.id)) {
      const source = document.nodesById[sourceNodeId];
      if (!source?.componentPropertyReferences) continue;
      const applied = applyComponentPropertyReferences(
        source,
        component.componentPropertyDefinitions,
        properties.properties,
      );
      if (!applied.ok) throw new Error(applied.message);
      nodesById[sourceNodeId] = applied.node;
    }
  }
  return { ...document, nodesById };
}

function resolveInstance(
  document: DesignDocument,
  instance: InstanceNode,
): ComponentInstanceResolution {
  const issues: ComponentResolutionIssue[] = [];
  const nodes: ResolvedComponentNode[] = [];
  const overrideTargets: ResolvedComponentOverrideTarget[] = [];
  let rootComponentProperties: Readonly<
    Record<string, ResolvedComponentProperty>
  > = {};
  const sourcePaths = new Set<string>();
  const overrides = new Map(
    instance.properties.overrides.map((override) => [
      componentSourcePathKey(override.sourcePath),
      override.patch,
    ]),
  );

  const visitComponent = (
    componentId: string,
    shell: InstanceNode,
    namespace: readonly string[],
    rootProjectionPath: readonly string[] | null,
    parentProjectionId: string | null,
    componentStack: readonly string[],
    root: boolean,
  ): void => {
    const definition = document.componentsById[componentId];
    if (!definition) {
      issues.push({
        code: "missing-component",
        instanceId: instance.id,
        message: `Component ${componentId} does not exist`,
        sourcePath: namespace,
      });
      return;
    }
    const effectiveProperties = effectiveComponentProperties(
      document,
      componentId,
      shell.properties.componentProperties,
      instance.id,
    );
    if (!effectiveProperties.ok) {
      issues.push(...effectiveProperties.issues);
      return;
    }
    if (root) rootComponentProperties = effectiveProperties.properties;
    if (componentStack.includes(componentId)) {
      issues.push({
        code: "component-cycle",
        instanceId: instance.id,
        message: `Component reference cycle: ${[...componentStack, componentId].join(" -> ")}`,
        sourcePath: namespace,
      });
      return;
    }

    const visitNode = (
      sourceNodeId: string,
      parentId: string | null,
      nodeRoot: boolean,
    ): void => {
      const source = document.nodesById[sourceNodeId];
      const sourcePath = [...namespace, sourceNodeId];
      if (!source) {
        issues.push({
          code: "missing-source-node",
          instanceId: instance.id,
          message: `Component source node ${sourceNodeId} does not exist`,
          sourcePath,
        });
        return;
      }
      if (source.kind === "instance") {
        const patch = overrides.get(componentSourcePathKey(sourcePath));
        const propertyApplied = applyComponentPropertyReferences(
          source,
          definition.componentPropertyDefinitions,
          effectiveProperties.properties,
        );
        if (!propertyApplied.ok) {
          issues.push({
            code: "invalid-component-property",
            instanceId: instance.id,
            message: propertyApplied.message,
            sourcePath,
          });
          return;
        }
        const nestedShell = applyOverride(propertyApplied.node, patch);
        const schemaIssues = schemaValidationIssues(
          DesignNodeSchema,
          nestedShell,
        );
        if (nestedShell.kind !== "instance" || schemaIssues.length > 0) {
          issues.push({
            code: "invalid-override",
            instanceId: instance.id,
            message: `Override makes ${sourceNodeId} invalid: ${schemaIssues[0]?.message ?? "nested source is no longer an instance"}`,
            sourcePath,
          });
          return;
        }
        sourcePaths.add(componentSourcePathKey(sourcePath));
        overrideTargets.push({
          node: nestedShell,
          sourceNodeId,
          sourcePath,
        });
        visitComponent(
          nestedShell.properties.componentId,
          nestedShell,
          [...namespace, source.id],
          [...namespace, source.id],
          parentId,
          [...componentStack, componentId],
          nodeRoot,
        );
        return;
      }

      const projectionId = nodeRoot
        ? rootProjectionPath === null
          ? instance.id
          : componentProjectionId(instance.id, rootProjectionPath)
        : componentProjectionId(instance.id, sourcePath);
      const patch = overrides.get(componentSourcePathKey(sourcePath));
      const propertyApplied = applyComponentPropertyReferences(
        source,
        definition.componentPropertyDefinitions,
        effectiveProperties.properties,
      );
      if (!propertyApplied.ok) {
        issues.push({
          code: "invalid-component-property",
          instanceId: instance.id,
          message: propertyApplied.message,
          sourcePath,
        });
        return;
      }
      const clone = applyOverride(propertyApplied.node, patch);
      overrideTargets.push({
        node: structuredClone(clone),
        sourceNodeId,
        sourcePath,
      });
      clone.id = projectionId;
      clone.parentId = nodeRoot ? parentProjectionId : parentId;
      clone.childIds = source.childIds.map((childId) =>
        componentProjectionId(instance.id, [...namespace, childId]),
      );
      if (nodeRoot) applyInstanceShell(clone, shell);

      const schemaIssues = schemaValidationIssues(DesignNodeSchema, clone);
      if (schemaIssues.length > 0) {
        issues.push({
          code: "invalid-override",
          instanceId: instance.id,
          message: `Override makes ${sourceNodeId} invalid: ${schemaIssues[0]?.message ?? "invalid node"}`,
          sourcePath,
        });
        return;
      }
      sourcePaths.add(componentSourcePathKey(sourcePath));
      nodes.push({
        instanceId: instance.id,
        node: clone,
        parentProjectionId: clone.parentId,
        projectionId,
        root: root && nodeRoot,
        sourceNodeId,
        sourcePath,
      });
      source.childIds.forEach((childId) =>
        visitNode(childId, projectionId, false),
      );
    };

    visitNode(definition.rootNodeId, parentProjectionId, true);
  };

  visitComponent(
    instance.properties.componentId,
    instance,
    [],
    null,
    instance.parentId,
    [],
    true,
  );
  for (const override of instance.properties.overrides) {
    const key = componentSourcePathKey(override.sourcePath);
    if (!sourcePaths.has(key)) {
      issues.push({
        code: "invalid-override",
        instanceId: instance.id,
        message: `Override target ${override.sourcePath.join(" / ")} is not part of component ${instance.properties.componentId}`,
        sourcePath: override.sourcePath,
      });
    }
  }
  return issues.length > 0
    ? {
        ok: false,
        componentId: instance.properties.componentId,
        instanceId: instance.id,
        issues,
      }
    : {
        ok: true,
        componentId: instance.properties.componentId,
        componentProperties: rootComponentProperties,
        instanceId: instance.id,
        nodes,
        overrideTargets,
        sourcePaths,
      };
}

function effectiveComponentProperties(
  document: DesignDocument,
  componentId: string,
  assignments: Readonly<Record<string, ComponentPropertyAssignment>>,
  instanceId: string,
):
  | {
      ok: true;
      properties: Readonly<Record<string, ResolvedComponentProperty>>;
    }
  | { ok: false; issues: ComponentResolutionIssue[] } {
  const definition = document.componentsById[componentId];
  if (!definition) {
    return {
      ok: false,
      issues: [
        {
          code: "missing-component",
          instanceId,
          message: `Component ${componentId} does not exist`,
        },
      ],
    };
  }
  const issues: ComponentResolutionIssue[] = [];
  const properties: Record<string, ResolvedComponentProperty> = {};
  for (const propertyName of Object.keys(assignments)) {
    if (!definition.componentPropertyDefinitions[propertyName]) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Component property ${propertyName} does not exist on ${componentId}`,
      });
    }
  }
  for (const [propertyName, propertyDefinition] of Object.entries(
    definition.componentPropertyDefinitions,
  )) {
    const value = assignments[propertyName] ?? propertyDefinition.defaultValue;
    if (!componentPropertyValueMatches(propertyDefinition, value)) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Component property ${propertyName} requires ${propertyDefinition.type}`,
      });
      continue;
    }
    if (
      propertyDefinition.type === "INSTANCE_SWAP" &&
      typeof value === "string" &&
      !document.componentsById[value]
    ) {
      issues.push({
        code: "missing-component",
        instanceId,
        message: `Component property ${propertyName} references missing component ${value}`,
      });
      continue;
    }
    properties[propertyName] = {
      type: propertyDefinition.type,
      value,
      ...(propertyDefinition.type === "INSTANCE_SWAP" &&
      propertyDefinition.preferredValues
        ? {
            preferredValues: structuredClone(
              propertyDefinition.preferredValues,
            ),
          }
        : {}),
    };
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, properties };
}

function componentPropertyValueMatches(
  definition: ComponentPropertyDefinition,
  value: ComponentPropertyAssignment,
): boolean {
  return definition.type === "BOOLEAN"
    ? typeof value === "boolean"
    : typeof value === "string";
}

function applyComponentPropertyReferences(
  source: DesignNode,
  definitions: ComponentPropertyDefinitions,
  properties: Readonly<Record<string, ResolvedComponentProperty>>,
): { ok: true; node: DesignNode } | { ok: false; message: string } {
  const references = source.componentPropertyReferences;
  if (!references) return { ok: true, node: structuredClone(source) };
  const clone = structuredClone(source);
  for (const [field, propertyName] of Object.entries(references)) {
    const definition = definitions[propertyName];
    const property = properties[propertyName];
    if (!definition || !property) {
      return {
        ok: false,
        message: `Component property reference ${propertyName} on ${source.id} does not exist`,
      };
    }
    if (field === "visible") {
      if (
        definition.type !== "BOOLEAN" ||
        typeof property.value !== "boolean"
      ) {
        return {
          ok: false,
          message: `Component property ${propertyName} must be BOOLEAN for visible`,
        };
      }
      clone.visible = property.value;
      continue;
    }
    if (field === "characters") {
      if (
        clone.kind !== "text" ||
        definition.type !== "TEXT" ||
        typeof property.value !== "string"
      ) {
        return {
          ok: false,
          message: `Component property ${propertyName} must be TEXT on a Text layer`,
        };
      }
      clone.properties.content = property.value;
      continue;
    }
    if (
      field !== "mainComponent" ||
      clone.kind !== "instance" ||
      definition.type !== "INSTANCE_SWAP" ||
      typeof property.value !== "string"
    ) {
      return {
        ok: false,
        message: `Component property ${propertyName} must be INSTANCE_SWAP on an Instance`,
      };
    }
    clone.properties.componentId = property.value;
  }
  return { ok: true, node: clone };
}

function applyInstanceShell(node: DesignNode, shell: InstanceNode): void {
  node.name = shell.name;
  node.transform = [...shell.transform];
  node.visible = shell.visible && node.visible;
  node.locked = shell.locked || node.locked;
  node.opacity *= shell.opacity;
  node.effects = [...(node.effects ?? []), ...(shell.effects ?? [])];
  if (shell.maskMode !== undefined) node.maskMode = shell.maskMode;
  if (shell.blendMode !== undefined) node.blendMode = shell.blendMode;
  node.extensions = { ...node.extensions, ...shell.extensions };
}

function applyOverride(
  source: DesignNode,
  patch: ComponentOverridePatch | undefined,
): DesignNode {
  const clone = structuredClone(source);
  if (!patch) return clone;
  if (patch.name !== undefined) clone.name = patch.name;
  if (patch.visible !== undefined) clone.visible = patch.visible;
  if (patch.opacity !== undefined) clone.opacity = patch.opacity;
  if (patch.blendMode !== undefined) clone.blendMode = patch.blendMode;
  if (patch.effects !== undefined)
    clone.effects = structuredClone(patch.effects);
  if (patch.maskMode !== undefined) clone.maskMode = patch.maskMode;
  if (patch.properties !== undefined) {
    Object.assign(clone.properties, structuredClone(patch.properties));
  }
  return clone;
}
