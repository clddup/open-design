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
  const selectedVariantSet = selectedNode
    ? Object.values(document.variantSetsById).find(
        (candidate) => candidate.rootNodeId === selectedNode.id,
      )
    : undefined;
  if (selectedVariantSet) {
    return {
      availableComponents: componentOptions(document),
      componentName: selectedVariantSet.name,
      componentProperties: [],
      componentPropertyDefinitions: [],
      isMain: false,
      overrideCount: 0,
      sourceNodes: [],
      variantSet: {
        id: selectedVariantSet.id,
        isDefault: false,
        isRoot: true,
        name: selectedVariantSet.name,
        properties: {},
        variantCount: Object.values(document.componentsById).filter(
          (candidate) => candidate.variantSetId === selectedVariantSet.id,
        ).length,
      },
    };
  }
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
  const effectiveComponent =
    instanceResolution?.ok === true
      ? document.componentsById[instanceResolution.componentId]
      : component;
  const variantSet = effectiveComponent?.variantSetId
    ? document.variantSetsById[effectiveComponent.variantSetId]
    : undefined;
  const effectivePropertyDefinitions = {
    ...(variantSet?.componentPropertyDefinitions ?? {}),
    ...(effectiveComponent?.componentPropertyDefinitions ?? {}),
  };
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
    componentName: variantSet?.name ?? component.name,
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
        ? Object.entries(effectivePropertyDefinitions).map(
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
    availableComponents: componentOptions(document),
    ...(variantSet && effectiveComponent
      ? {
          variantSet: {
            id: variantSet.id,
            isDefault: variantSet.defaultComponentId === effectiveComponent.id,
            isRoot: false,
            name: variantSet.name,
            properties: structuredClone(effectiveComponent.variantProperties),
            variantCount: Object.values(document.componentsById).filter(
              (candidate) => candidate.variantSetId === variantSet.id,
            ).length,
          },
        }
      : {}),
  };
}

function componentOptions(document: DesignDocument) {
  return Object.values(document.componentsById).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
  }));
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
