import {
  componentSourceNodeIds,
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import type {
  ComponentSelectionTarget,
  DesignDocument,
  DesignNode,
} from "@opendesign/design-contracts";
import type { ComponentInspectorContext } from "./features/editor-workbench/components/properties/ComponentSection";

export function createComponentInspectorContext(
  document: DesignDocument,
  selectedNode: DesignNode | undefined,
  componentTarget?: ComponentSelectionTarget,
): ComponentInspectorContext | undefined {
  const selectedVariantSet = selectedNode
    ? Object.values(document.variantSetsById).find(
        (candidate) => candidate.rootNodeId === selectedNode.id,
      )
    : undefined;
  if (selectedVariantSet) {
    return {
      availableComponents: componentOptions(document),
      availableSlotPreferredValues: slotPreferredValueOptions(document),
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
        propertyOrder: [...selectedVariantSet.propertyOrder],
        propertyDefinitions: structuredClone(
          selectedVariantSet.componentPropertyDefinitions,
        ),
        members: selectedVariantSet.propertyOrder.length
          ? Object.values(document.componentsById)
              .filter(
                (candidate) => candidate.variantSetId === selectedVariantSet.id,
              )
              .map((candidate) => ({
                componentId: candidate.id,
                name: candidate.name,
                rootNodeId: candidate.rootNodeId,
                properties: structuredClone(candidate.variantProperties),
              }))
          : [],
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
  const effectivePropertyNames = [
    ...(variantSet?.propertyOrder ?? []),
    ...(effectiveComponent?.componentPropertyOrder ?? []),
  ];
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
  const activeSourcePath =
    selectedNode?.kind === "instance" &&
    componentTarget?.instanceId === selectedNode.id &&
    sourceNodes.some(
      (source) =>
        componentSourcePathKey(source.sourcePath) ===
        componentSourcePathKey(componentTarget.sourcePath),
    )
      ? [...componentTarget.sourcePath]
      : undefined;
  return {
    ...(activeSourcePath ? { activeSourcePath } : {}),
    componentName: variantSet?.name ?? component.name,
    isMain: selectedNode?.kind !== "instance",
    overrideCount:
      selectedNode?.kind === "instance"
        ? selectedNode.properties.overrides.length
        : 0,
    sourceNodes,
    componentPropertyDefinitions: component.componentPropertyOrder.map(
      (propertyName) => ({
        propertyName,
        definition: component.componentPropertyDefinitions[propertyName],
        sourceNodeIds: sourceNodes
          .filter((source) =>
            Object.values(
              source.node.componentPropertyReferences ?? {},
            ).includes(propertyName),
          )
          .map((source) => source.node.id),
      }),
    ),
    componentProperties:
      selectedNode?.kind === "instance" && instanceResolution?.ok
        ? effectivePropertyNames.map((propertyName) => {
            const definition = effectivePropertyDefinitions[propertyName];
            return {
              propertyName,
              definition,
              value:
                instanceResolution.componentProperties[propertyName]?.value ??
                definition.defaultValue,
              assigned: Object.hasOwn(
                selectedNode.properties.componentProperties,
                propertyName,
              ),
              ...(definition.type === "SLOT"
                ? {
                    slot: instanceResolution.slots.find(
                      (slot) => slot.propertyName === propertyName,
                    ),
                    assigned: Boolean(
                      instanceResolution.slots.find(
                        (slot) => slot.propertyName === propertyName,
                      )?.overridden,
                    ),
                  }
                : {}),
            };
          })
        : [],
    availableComponents: componentOptions(document),
    availableSlotPreferredValues: slotPreferredValueOptions(document),
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
            propertyOrder: [...variantSet.propertyOrder],
            propertyDefinitions: structuredClone(
              variantSet.componentPropertyDefinitions,
            ),
            members: [],
          },
        }
      : {}),
  };
}

export function canAddSelectionToVariantSet(
  document: DesignDocument,
  nodeIds: readonly string[],
): boolean {
  if (nodeIds.length !== 2) return false;
  const selected = new Set(nodeIds);
  const setCount = Object.values(document.variantSetsById).filter((set) =>
    selected.has(set.rootNodeId),
  ).length;
  const ordinaryComponentCount = Object.values(document.componentsById).filter(
    (component) =>
      !component.variantSetId && selected.has(component.rootNodeId),
  ).length;
  return setCount === 1 && ordinaryComponentCount === 1;
}

function componentOptions(document: DesignDocument) {
  return Object.values(document.componentsById).map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
  }));
}

function slotPreferredValueOptions(document: DesignDocument) {
  return [
    ...Object.values(document.componentsById).map((candidate) => ({
      key: candidate.id,
      name: candidate.name,
      type: "COMPONENT" as const,
    })),
    ...Object.values(document.variantSetsById).map((candidate) => ({
      key: candidate.id,
      name: candidate.name,
      type: "COMPONENT_SET" as const,
    })),
  ];
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
