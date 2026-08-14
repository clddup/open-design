import {
  componentSourceNodeIds,
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import type { ComponentInspectorContext } from "./components/properties/ComponentSection";

export function createComponentInspectorContext(
  document: DesignDocument,
  selectedNode: DesignNode | undefined,
): ComponentInspectorContext | undefined {
  const component = selectedNode
    ? selectedNode.kind === "instance"
      ? document.componentsById[selectedNode.properties.componentId]
      : Object.values(document.componentsById).find(
          (candidate) => candidate.rootNodeId === selectedNode.id,
        )
    : undefined;
  if (!component) return undefined;
  const instanceResolution =
    selectedNode?.kind === "instance"
      ? resolveComponentInstance(document, selectedNode.id)
      : null;
  const sourceNodes =
    selectedNode?.kind === "instance"
      ? resolvedInstanceSourceNodes(document, selectedNode.id)
      : [...componentSourceNodeIds(document, component.id)]
          .filter((nodeId) => nodeId !== component.rootNodeId)
          .flatMap((nodeId) => {
            const node = document.nodesById[nodeId];
            return node
              ? [{ node, overridden: false, sourcePath: [nodeId] }]
              : [];
          });
  return {
    componentName: component.name,
    isMain: selectedNode?.kind !== "instance",
    overrideCount:
      selectedNode?.kind === "instance"
        ? selectedNode.properties.overrides.length
        : 0,
    sourceNodes,
    componentPropertyDefinitions: Object.entries(
      component.componentPropertyDefinitions,
    ).map(([propertyName, definition]) => ({
      propertyName,
      definition,
      sourceNodeIds: sourceNodes
        .filter((source) =>
          Object.values(source.node.componentPropertyReferences ?? {}).includes(
            propertyName,
          ),
        )
        .map((source) => source.node.id),
    })),
    componentProperties:
      selectedNode?.kind === "instance" && instanceResolution?.ok
        ? Object.entries(component.componentPropertyDefinitions).map(
            ([propertyName, definition]) => ({
              propertyName,
              definition,
              value:
                instanceResolution.componentProperties[propertyName]?.value ??
                definition.defaultValue,
              assigned: Object.hasOwn(
                selectedNode.properties.componentProperties,
                propertyName,
              ),
            }),
          )
        : [],
    availableComponents: Object.values(document.componentsById).map(
      (candidate) => ({ id: candidate.id, name: candidate.name }),
    ),
  };
}

function resolvedInstanceSourceNodes(
  document: DesignDocument,
  instanceId: string,
) {
  const instance = document.nodesById[instanceId];
  if (!instance || instance.kind !== "instance") return [];
  const resolution = resolveComponentInstance(document, instanceId);
  if (!resolution.ok) return [];
  const overrideKeys = new Set(
    instance.properties.overrides.map((override) =>
      componentSourcePathKey(override.sourcePath),
    ),
  );
  return resolution.overrideTargets.map((resolved) => ({
    node: resolved.node,
    overridden: overrideKeys.has(componentSourcePathKey(resolved.sourcePath)),
    sourcePath: [...resolved.sourcePath],
  }));
}
