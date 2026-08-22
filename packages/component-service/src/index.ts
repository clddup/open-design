import {
  DesignNodeSchema,
  schemaValidationIssues,
  type ComponentPropertyAssignment,
  type ComponentPropertyDefinition,
  type ComponentSelectionTarget,
  type DesignDocument,
  type DesignNode,
  type InstanceNode,
  type SlotSettings,
} from "@opendesign/design-contracts";
import {
  applyComponentPropertyReferences,
  applyInstanceShell,
  applyOverride,
  effectiveComponentProperties,
  slotLimitViolations,
} from "./component-resolution-support.js";
import {
  componentDefinition,
  componentProjectionAssets,
  componentSourceNode,
  componentSourceNodeIds,
} from "./component-source.js";

export {
  componentDefinition,
  componentDefinitions,
  componentProjectionAssets,
  componentSource,
  componentSourceNode,
  componentSourceNodeIds,
  componentVariantSet,
} from "./component-source.js";
export const COMPONENT_SERVICE_VERSION = 6 as const;
export const COMPONENT_PROJECTION_PREFIX = "__opendesign_instance__:";

export type ComponentResolutionIssueCode =
  | "component-cycle"
  | "invalid-component-property"
  | "invalid-override"
  | "invalid-slot-override"
  | "missing-component"
  | "missing-source-node";

export interface ComponentResolutionIssue {
  code: ComponentResolutionIssueCode;
  instanceId: string;
  message: string;
  sourcePath?: readonly string[];
}

export interface ResolvedComponentNode {
  editableNodeId?: string;
  instanceId: string;
  node: DesignNode;
  parentProjectionId: string | null;
  projectionId: string;
  root: boolean;
  selectionInstanceId: string;
  selectionSourcePath: readonly string[];
  sourceNodeId: string;
  sourcePath: readonly string[];
  slotPropertyName?: string;
  slotOverride?: boolean;
}

export interface ComponentProjectionTarget {
  instanceId: string;
  sourceNodeId: string;
  sourcePath: readonly string[];
}

export interface ComponentDocumentProjection {
  document: DesignDocument;
  issues: readonly ComponentResolutionIssue[];
  targetsByNodeId: ReadonlyMap<string, ComponentProjectionTarget>;
}

export type SlotLimitViolation =
  "BELOW_MIN" | "ABOVE_MAX" | "HAS_NON_PREFERRED";

export interface ResolvedComponentSlot {
  childCount: number;
  displayNodeId: string;
  limitViolations: readonly SlotLimitViolation[];
  overridden: boolean;
  propertyName: string;
  settings: SlotSettings;
  sourceSlotNodeId: string;
}

export interface ResolvedComponentOverrideTarget {
  node: DesignNode;
  sourceNodeId: string;
  sourcePath: readonly string[];
}

export type ComponentSelectionDirection =
  "enter" | "exit" | "next-sibling" | "previous-sibling";

export interface ComponentSelectionNavigationResult {
  instanceId: string;
  componentTarget?: ComponentSelectionTarget;
}

export interface ResolvedComponentProperty {
  type: ComponentPropertyDefinition["type"] | "VARIANT";
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
      slots: readonly ResolvedComponentSlot[];
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

/**
 * Navigates the disposable projected tree while returning only persistent
 * Instance identity plus a stable source path. No projected node ID enters
 * editor state or DesignDocument.
 */
export function navigateComponentSelection(
  document: DesignDocument,
  instanceId: string,
  currentTarget: ComponentSelectionTarget | undefined,
  direction: ComponentSelectionDirection,
): ComponentSelectionNavigationResult | null {
  const resolution = resolveComponentInstance(document, instanceId);
  if (!resolution.ok) return null;
  const selectable = resolution.nodes.filter(
    (candidate) =>
      !candidate.root &&
      candidate.editableNodeId === undefined &&
      candidate.selectionInstanceId === instanceId,
  );
  const currentKey = currentTarget
    ? componentSourcePathKey(currentTarget.sourcePath)
    : null;
  const current = currentKey
    ? selectable.find(
        (candidate) =>
          componentSourcePathKey(candidate.selectionSourcePath) === currentKey,
      )
    : undefined;
  const root = resolution.nodes.find(
    (candidate) =>
      candidate.root && candidate.selectionInstanceId === instanceId,
  );

  if (direction === "enter") {
    const parentProjectionId = current?.projectionId ?? root?.projectionId;
    if (!parentProjectionId) return null;
    const child = [...selectable]
      .reverse()
      .find(
        (candidate) =>
          candidate.parentProjectionId === parentProjectionId &&
          candidate.node.visible,
      );
    return child ? componentNavigationTarget(child) : null;
  }

  if (!current) return null;
  if (direction === "exit") {
    const parent = selectable.find(
      (candidate) => candidate.projectionId === current.parentProjectionId,
    );
    return parent ? componentNavigationTarget(parent) : { instanceId };
  }

  const siblings = selectable.filter(
    (candidate) =>
      candidate.parentProjectionId === current.parentProjectionId &&
      candidate.node.visible,
  );
  const index = siblings.indexOf(current);
  if (index < 0) return null;
  const sibling = siblings[index + (direction === "next-sibling" ? 1 : -1)];
  return sibling ? componentNavigationTarget(sibling) : null;
}

function componentNavigationTarget(
  node: ResolvedComponentNode,
): ComponentSelectionNavigationResult {
  return {
    instanceId: node.selectionInstanceId,
    componentTarget: {
      instanceId: node.selectionInstanceId,
      sourcePath: [...node.selectionSourcePath],
    },
  };
}

export function materializeComponentInstances(
  document: DesignDocument,
): DesignDocument {
  const projection = projectComponentInstances(document);
  if (projection.issues.length > 0) {
    throw new Error(
      projection.issues[0]?.message ?? "Component instance cannot be resolved",
    );
  }
  return projection.document;
}

export function projectComponentInstances(
  document: DesignDocument,
): ComponentDocumentProjection {
  const projectedDocument = materializeComponentMainProperties({
    ...document,
    assetsById: componentProjectionAssets(document),
  });
  if (
    !Object.values(projectedDocument.nodesById).some(
      (node) => node.kind === "instance",
    )
  ) {
    return {
      document: projectedDocument,
      issues: [],
      targetsByNodeId: new Map(),
    };
  }
  const nodesById: DesignDocument["nodesById"] = {
    ...projectedDocument.nodesById,
  };
  const issues: ComponentResolutionIssue[] = [];
  const targetsByNodeId = new Map<string, ComponentProjectionTarget>();
  for (const node of Object.values(projectedDocument.nodesById)) {
    if (node.kind !== "instance") continue;
    const resolution = resolveComponentInstance(projectedDocument, node.id);
    if (!resolution.ok) {
      issues.push(...resolution.issues);
      continue;
    }
    for (const resolved of resolution.nodes) {
      nodesById[resolved.projectionId] = structuredClone(resolved.node);
      if (resolved.selectionSourcePath.length > 0) {
        targetsByNodeId.set(resolved.projectionId, {
          instanceId: resolved.selectionInstanceId,
          sourceNodeId: resolved.sourceNodeId,
          sourcePath: [...resolved.selectionSourcePath],
        });
      }
    }
  }
  return {
    document: { ...projectedDocument, nodesById },
    issues,
    targetsByNodeId,
  };
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
  const slots: ResolvedComponentSlot[] = [];
  let rootComponentProperties: Readonly<
    Record<string, ResolvedComponentProperty>
  > = {};
  const sourcePaths = new Set<string>();
  const usedSlotOverrideIds = new Set<string>();
  let rootResolvedComponentId = instance.properties.componentId;
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
    selectionInstanceId: string,
    selectionNamespace: readonly string[],
    rootSelectionPath: readonly string[] | null,
    parentProjectionId: string | null,
    componentStack: readonly string[],
    root: boolean,
    shellSourceComponentId?: string,
    editableRootNodeId?: string,
  ): void => {
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
    const resolvedComponentId = effectiveProperties.componentId;
    const definition = componentDefinition(document, resolvedComponentId);
    if (!definition) return;
    if (root) {
      rootComponentProperties = effectiveProperties.properties;
      rootResolvedComponentId = resolvedComponentId;
    }
    if (componentStack.includes(resolvedComponentId)) {
      issues.push({
        code: "component-cycle",
        instanceId: instance.id,
        message: `Component reference cycle: ${[...componentStack, resolvedComponentId].join(" -> ")}`,
        sourcePath: namespace,
      });
      return;
    }
    const slotOverrides = new Map<
      string,
      Extract<DesignNode, { kind: "slot" }>
    >();
    for (const childId of shell.childIds) {
      const child = shellSourceComponentId
        ? componentSourceNode(document, shellSourceComponentId, childId)
        : document.nodesById[childId];
      if (child?.kind !== "slot" || child.properties.sourceSlotId === null)
        continue;
      if (slotOverrides.has(child.properties.sourceSlotId)) {
        issues.push({
          code: "invalid-slot-override",
          instanceId: instance.id,
          message: `Instance ${shell.id} has more than one override for Slot ${child.properties.sourceSlotId}`,
        });
        continue;
      }
      slotOverrides.set(child.properties.sourceSlotId, child);
    }

    const sourceChildProjectionId = (
      childId: string,
      childNamespace: readonly string[],
    ): string => {
      const child = componentSourceNode(document, resolvedComponentId, childId);
      if (child?.kind === "slot") {
        const override = slotOverrides.get(child.id);
        if (override) return override.id;
      }
      return componentProjectionId(instance.id, [...childNamespace, childId]);
    };

    const overrideNodeProjectionId = (
      nodeId: string,
      path: readonly string[],
    ): string =>
      document.nodesById[nodeId]?.kind === "instance"
        ? componentProjectionId(instance.id, path)
        : nodeId;

    const visitNode = (
      sourceNodeId: string,
      parentId: string | null,
      nodeRoot: boolean,
    ): void => {
      const source = componentSourceNode(
        document,
        resolvedComponentId,
        sourceNodeId,
      );
      const sourcePath = [...namespace, sourceNodeId];
      const selectionSourcePath = [...selectionNamespace, sourceNodeId];
      if (!source) {
        issues.push({
          code: "missing-source-node",
          instanceId: instance.id,
          message: `Component source node ${sourceNodeId} does not exist`,
          sourcePath,
        });
        return;
      }
      if (source.kind === "slot") {
        const propertyEntry = Object.entries(
          definition.componentPropertyDefinitions,
        ).find(
          ([, candidate]) =>
            candidate.type === "SLOT" && candidate.defaultValue === source.id,
        );
        if (!propertyEntry) {
          issues.push({
            code: "invalid-component-property",
            instanceId: instance.id,
            message: `Slot ${source.id} is not bound to a SLOT component property`,
            sourcePath,
          });
          return;
        }
        const [propertyName, propertyDefinition] = propertyEntry;
        if (propertyDefinition.type !== "SLOT") return;
        const override = slotOverrides.get(source.id);
        if (override) usedSlotOverrideIds.add(override.id);
        const projectionId =
          override?.id ?? componentProjectionId(instance.id, sourcePath);
        const clone = structuredClone(override ?? source);
        clone.id = projectionId;
        clone.parentId = parentId;
        clone.childIds = override
          ? override.childIds.map((childId) =>
              overrideNodeProjectionId(childId, [...sourcePath, childId]),
            )
          : source.childIds.map((childId) =>
              sourceChildProjectionId(childId, namespace),
            );
        sourcePaths.add(componentSourcePathKey(sourcePath));
        overrideTargets.push({
          node: structuredClone(clone),
          sourceNodeId,
          sourcePath,
        });
        nodes.push({
          ...(override ? { editableNodeId: override.id } : {}),
          instanceId: instance.id,
          node: clone,
          parentProjectionId: parentId,
          projectionId,
          root: false,
          selectionInstanceId,
          selectionSourcePath,
          sourceNodeId,
          sourcePath,
          slotPropertyName: propertyName,
          slotOverride: Boolean(override),
        });

        const contentRoot = override ?? source;
        slots.push({
          childCount: contentRoot.childIds.length,
          displayNodeId: projectionId,
          limitViolations: slotLimitViolations(
            document,
            contentRoot.childIds,
            propertyDefinition,
            override ? undefined : resolvedComponentId,
          ),
          overridden: Boolean(override),
          propertyName,
          settings: structuredClone(propertyDefinition.slotSettings ?? {}),
          sourceSlotNodeId: source.id,
        });

        const visitOverrideNode = (
          overrideNodeId: string,
          overrideParentId: string,
          overridePath: readonly string[],
        ): void => {
          const overrideNode = document.nodesById[overrideNodeId];
          if (!overrideNode) {
            issues.push({
              code: "missing-source-node",
              instanceId: instance.id,
              message: `Slot override node ${overrideNodeId} does not exist`,
              sourcePath: overridePath,
            });
            return;
          }
          if (overrideNode.kind === "instance") {
            visitComponent(
              overrideNode.properties.componentId,
              overrideNode,
              overridePath,
              overridePath,
              overrideNode.id,
              [],
              null,
              overrideParentId,
              [...componentStack, resolvedComponentId],
              false,
              undefined,
              overrideNode.id,
            );
            return;
          }
          const displayId = overrideNodeProjectionId(
            overrideNode.id,
            overridePath,
          );
          const overrideClone = structuredClone(overrideNode);
          overrideClone.id = displayId;
          overrideClone.parentId = overrideParentId;
          overrideClone.childIds = overrideNode.childIds.map((childId) =>
            overrideNodeProjectionId(childId, [...overridePath, childId]),
          );
          nodes.push({
            editableNodeId: overrideNode.id,
            instanceId: instance.id,
            node: overrideClone,
            parentProjectionId: overrideParentId,
            projectionId: displayId,
            root: false,
            selectionInstanceId,
            selectionSourcePath: overridePath,
            sourceNodeId: overrideNode.id,
            sourcePath: overridePath,
          });
          overrideNode.childIds.forEach((childId) =>
            visitOverrideNode(childId, displayId, [...overridePath, childId]),
          );
        };

        if (override) {
          override.childIds.forEach((childId) =>
            visitOverrideNode(childId, projectionId, [...sourcePath, childId]),
          );
        } else {
          source.childIds.forEach((childId) =>
            visitNode(childId, projectionId, false),
          );
        }
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
          selectionInstanceId,
          [...selectionNamespace, source.id],
          [...selectionNamespace, source.id],
          parentId,
          [...componentStack, resolvedComponentId],
          nodeRoot,
          resolvedComponentId,
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
        sourceChildProjectionId(childId, namespace),
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
        ...(nodeRoot && editableRootNodeId
          ? { editableNodeId: editableRootNodeId }
          : {}),
        instanceId: instance.id,
        node: clone,
        parentProjectionId: clone.parentId,
        projectionId,
        root: root && nodeRoot,
        selectionInstanceId,
        selectionSourcePath:
          nodeRoot && rootSelectionPath !== null
            ? rootSelectionPath
            : selectionSourcePath,
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
    instance.id,
    [],
    null,
    instance.parentId,
    [],
    true,
    undefined,
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
  for (const childId of instance.childIds) {
    const child = document.nodesById[childId];
    if (
      child?.kind === "slot" &&
      child.properties.sourceSlotId !== null &&
      !usedSlotOverrideIds.has(child.id)
    ) {
      issues.push({
        code: "invalid-slot-override",
        instanceId: instance.id,
        message: `Slot override ${child.id} does not match the active component`,
      });
    }
  }
  return issues.length > 0
    ? {
        ok: false,
        componentId: rootResolvedComponentId,
        instanceId: instance.id,
        issues,
      }
    : {
        ok: true,
        componentId: rootResolvedComponentId,
        componentProperties: rootComponentProperties,
        instanceId: instance.id,
        nodes,
        overrideTargets,
        slots,
        sourcePaths,
      };
}
