import type { DesignDocument } from "@opendesign/design-contracts";
import type { DocumentInvariantIssue } from "./layout-document-invariants.js";

export function validateVariantSetInvariants(
  document: DesignDocument,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const componentsByVariantSet = new Map<string, string[]>();
  for (const [componentId, component] of Object.entries(
    document.componentsById,
  )) {
    if (!component.variantSetId) {
      if (Object.keys(component.variantProperties).length > 0) {
        issues.push({
          path: `/componentsById/${componentId}/variantProperties`,
          message: "variant properties require membership in a component set",
        });
      }
      continue;
    }
    if (!ownValue(document.variantSetsById, component.variantSetId)) {
      issues.push({
        path: `/componentsById/${componentId}/variantSetId`,
        message: `variant set ${component.variantSetId} does not exist`,
      });
    }
    const members = componentsByVariantSet.get(component.variantSetId) ?? [];
    members.push(componentId);
    componentsByVariantSet.set(component.variantSetId, members);
  }

  for (const [variantSetId, variantSet] of Object.entries(
    document.variantSetsById,
  )) {
    const setPath = `/variantSetsById/${variantSetId}`;
    if (variantSet.id !== variantSetId) {
      issues.push({
        path: `${setPath}/id`,
        message: "variant set id must match its map key",
      });
    }
    const root = ownValue(document.nodesById, variantSet.rootNodeId);
    if (!root) {
      issues.push({
        path: `${setPath}/rootNodeId`,
        message: `component set root ${variantSet.rootNodeId} does not exist`,
      });
    } else if (root.kind !== "frame") {
      issues.push({
        path: `${setPath}/rootNodeId`,
        message: "component set roots must be Frames",
      });
    }
    const memberIds = (componentsByVariantSet.get(variantSetId) ?? []).sort();
    if (memberIds.length === 0) {
      issues.push({
        path: setPath,
        message: "component sets must contain at least one variant",
      });
      continue;
    }
    if (!memberIds.includes(variantSet.defaultComponentId)) {
      issues.push({
        path: `${setPath}/defaultComponentId`,
        message: "default variant must belong to the component set",
      });
    }
    const memberRootIds = memberIds.flatMap((componentId) => {
      const component = ownValue(document.componentsById, componentId);
      return component ? [component.rootNodeId] : [];
    });
    if (
      root?.kind === "frame" &&
      (root.childIds.length !== memberRootIds.length ||
        root.childIds.some((nodeId) => !memberRootIds.includes(nodeId)))
    ) {
      issues.push({
        path: `/nodesById/${root.id}/childIds`,
        message:
          "component set Frames may contain only their Component variants",
      });
    }
    const propertyNames = Object.keys(
      variantSet.componentPropertyDefinitions,
    ).sort();
    const orderedPropertyNames = [...variantSet.propertyOrder].sort();
    if (
      orderedPropertyNames.length !== propertyNames.length ||
      orderedPropertyNames.some(
        (propertyName, index) => propertyName !== propertyNames[index],
      )
    ) {
      issues.push({
        path: `${setPath}/propertyOrder`,
        message:
          "property order must contain every Variant property exactly once",
      });
    }
    for (const [propertyName, definition] of Object.entries(
      variantSet.componentPropertyDefinitions,
    )) {
      if (propertyName.includes("#")) {
        issues.push({
          path: `${setPath}/componentPropertyDefinitions/${propertyName}`,
          message: "VARIANT property names do not use a # suffix",
        });
      }
      if (!definition.variantOptions.includes(definition.defaultValue)) {
        issues.push({
          path: `${setPath}/componentPropertyDefinitions/${propertyName}/defaultValue`,
          message: "variant default must be one of its options",
        });
      }
    }
    const combinations = new Set<string>();
    for (const componentId of memberIds) {
      const component = document.componentsById[componentId];
      if (!component) continue;
      const memberPropertyNames = Object.keys(
        component.variantProperties,
      ).sort();
      if (
        memberPropertyNames.length !== propertyNames.length ||
        memberPropertyNames.some(
          (propertyName, index) => propertyName !== propertyNames[index],
        )
      ) {
        issues.push({
          path: `/componentsById/${componentId}/variantProperties`,
          message:
            "every variant must define the component set's complete property collection",
        });
        continue;
      }
      for (const propertyName of propertyNames) {
        const value = component.variantProperties[propertyName];
        const definition =
          variantSet.componentPropertyDefinitions[propertyName];
        if (
          value !== undefined &&
          definition !== undefined &&
          !definition.variantOptions.includes(value)
        ) {
          issues.push({
            path: `/componentsById/${componentId}/variantProperties/${propertyName}`,
            message: `variant value ${value} is not declared by ${propertyName}`,
          });
        }
      }
      const combination = propertyNames
        .map((propertyName) => component.variantProperties[propertyName])
        .join("\u0000");
      if (combinations.has(combination)) {
        issues.push({
          path: `/componentsById/${componentId}/variantProperties`,
          message: "variant property combinations must be unique",
        });
      }
      combinations.add(combination);
    }
    const defaultComponent = ownValue(
      document.componentsById,
      variantSet.defaultComponentId,
    );
    if (defaultComponent) {
      for (const [propertyName, definition] of Object.entries(
        variantSet.componentPropertyDefinitions,
      )) {
        if (
          defaultComponent.variantProperties[propertyName] !==
          definition.defaultValue
        ) {
          issues.push({
            path: `${setPath}/componentPropertyDefinitions/${propertyName}/defaultValue`,
            message: "variant defaults must match the default Component",
          });
        }
      }
    }
    if (root?.kind === "frame") {
      const topLeft = memberIds
        .map((componentId) => document.componentsById[componentId])
        .filter((component) => component !== undefined)
        .sort((left, right) => {
          const leftRoot = document.nodesById[left.rootNodeId];
          const rightRoot = document.nodesById[right.rootNodeId];
          return (
            (leftRoot?.transform[5] ?? 0) - (rightRoot?.transform[5] ?? 0) ||
            (leftRoot?.transform[4] ?? 0) - (rightRoot?.transform[4] ?? 0) ||
            left.id.localeCompare(right.id)
          );
        })[0];
      if (topLeft && topLeft.id !== variantSet.defaultComponentId) {
        issues.push({
          path: `${setPath}/defaultComponentId`,
          message: "the top-left Component must be the default variant",
        });
      }
    }
  }
  return issues;
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}
