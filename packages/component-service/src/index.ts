import {
  DesignNodeSchema,
  schemaValidationIssues,
  type ComponentOverridePatch,
  type DesignDocument,
  type DesignNode,
  type InstanceNode,
} from "@opendesign/design-contracts";

export const COMPONENT_SERVICE_VERSION = 1 as const;
export const COMPONENT_PROJECTION_PREFIX = "__opendesign_instance__:";

export type ComponentResolutionIssueCode =
  | "component-cycle"
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

export type ComponentInstanceResolution =
  | {
      ok: true;
      componentId: string;
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
  if (
    !Object.values(document.nodesById).some((node) => node.kind === "instance")
  ) {
    return document;
  }
  const nodesById: DesignDocument["nodesById"] = { ...document.nodesById };
  for (const node of Object.values(document.nodesById)) {
    if (node.kind !== "instance") continue;
    const resolution = resolveComponentInstance(document, node.id);
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
  return { ...document, nodesById };
}

function resolveInstance(
  document: DesignDocument,
  instance: InstanceNode,
): ComponentInstanceResolution {
  const issues: ComponentResolutionIssue[] = [];
  const nodes: ResolvedComponentNode[] = [];
  const overrideTargets: ResolvedComponentOverrideTarget[] = [];
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
        const nestedShell = applyOverride(source, patch);
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
      const clone = applyOverride(source, patch);
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
        instanceId: instance.id,
        nodes,
        overrideTargets,
        sourcePaths,
      };
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
