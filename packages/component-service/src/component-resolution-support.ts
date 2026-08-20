import type {
  ComponentPropertyAssignment,
  ComponentPropertyDefinition,
  ComponentPropertyDefinitions,
  ComponentOverridePatch,
  DesignDocument,
  DesignNode,
  InstanceNode,
} from "@opendesign/design-contracts";
import type {
  ComponentResolutionIssue,
  ResolvedComponentProperty,
  SlotLimitViolation,
} from "./index.js";

export function effectiveComponentProperties(
  document: DesignDocument,
  componentId: string,
  assignments: Readonly<Record<string, ComponentPropertyAssignment>>,
  instanceId: string,
):
  | {
      ok: true;
      componentId: string;
      properties: Readonly<Record<string, ResolvedComponentProperty>>;
    }
  | { ok: false; issues: ComponentResolutionIssue[] } {
  const requestedDefinition = document.componentsById[componentId];
  if (!requestedDefinition) {
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
  let resolvedComponentId = componentId;
  const variantSet = requestedDefinition.variantSetId
    ? document.variantSetsById[requestedDefinition.variantSetId]
    : undefined;
  if (requestedDefinition.variantSetId && !variantSet) {
    issues.push({
      code: "missing-component",
      instanceId,
      message: `Variant set ${requestedDefinition.variantSetId} does not exist`,
    });
  }
  if (variantSet) {
    const requestedVariantProperties: Record<string, string> = {};
    for (const propertyName of variantSet.propertyOrder) {
      const propertyDefinition =
        variantSet.componentPropertyDefinitions[propertyName];
      if (!propertyDefinition) {
        issues.push({
          code: "invalid-component-property",
          instanceId,
          message: `Variant property order references missing property ${propertyName}`,
        });
        continue;
      }
      const value =
        assignments[propertyName] ??
        requestedDefinition.variantProperties[propertyName];
      if (
        typeof value !== "string" ||
        !propertyDefinition.variantOptions.includes(value)
      ) {
        issues.push({
          code: "invalid-component-property",
          instanceId,
          message: `Component property ${propertyName} requires one of ${propertyDefinition.variantOptions.join(", ")}`,
        });
        continue;
      }
      requestedVariantProperties[propertyName] = value;
      properties[propertyName] = { type: "VARIANT", value };
    }
    const selected = Object.values(document.componentsById).find(
      (candidate) =>
        candidate.variantSetId === variantSet.id &&
        Object.entries(requestedVariantProperties).every(
          ([propertyName, value]) =>
            candidate.variantProperties[propertyName] === value,
        ),
    );
    if (!selected) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Variant set ${variantSet.id} has no Component matching ${Object.entries(
          requestedVariantProperties,
        )
          .map(([name, value]) => `${name}=${value}`)
          .join(", ")}`,
      });
    } else {
      resolvedComponentId = selected.id;
    }
  }
  const definition = document.componentsById[resolvedComponentId];
  if (!definition) {
    return { ok: false, issues };
  }
  const knownPropertyNames = new Set([
    ...Object.keys(variantSet?.componentPropertyDefinitions ?? {}),
    ...Object.keys(definition.componentPropertyDefinitions),
  ]);
  for (const propertyName of Object.keys(assignments)) {
    if (!knownPropertyNames.has(propertyName)) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Component property ${propertyName} does not exist on ${componentId}`,
      });
    }
  }
  for (const propertyName of definition.componentPropertyOrder) {
    const propertyDefinition =
      definition.componentPropertyDefinitions[propertyName];
    if (!propertyDefinition) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Component property order references missing property ${propertyName}`,
      });
      continue;
    }
    if (
      propertyDefinition.type === "SLOT" &&
      Object.hasOwn(assignments, propertyName)
    ) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `SLOT property ${propertyName} is edited through its Slot contents, not component property assignments`,
      });
    }
    const value = propertyDefinition.defaultValue;
    const effectiveValue =
      propertyDefinition.type === "SLOT"
        ? value
        : (assignments[propertyName] ?? value);
    if (!componentPropertyValueMatches(propertyDefinition, effectiveValue)) {
      issues.push({
        code: "invalid-component-property",
        instanceId,
        message: `Component property ${propertyName} requires ${propertyDefinition.type}`,
      });
      continue;
    }
    if (
      propertyDefinition.type === "INSTANCE_SWAP" &&
      typeof effectiveValue === "string" &&
      !document.componentsById[effectiveValue]
    ) {
      issues.push({
        code: "missing-component",
        instanceId,
        message: `Component property ${propertyName} references missing component ${effectiveValue}`,
      });
      continue;
    }
    properties[propertyName] = {
      type: propertyDefinition.type,
      value: effectiveValue,
      ...((propertyDefinition.type === "INSTANCE_SWAP" ||
        propertyDefinition.type === "SLOT") &&
      propertyDefinition.preferredValues
        ? {
            preferredValues: structuredClone(
              propertyDefinition.preferredValues,
            ),
          }
        : {}),
    };
  }
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, componentId: resolvedComponentId, properties };
}

export function slotLimitViolations(
  document: DesignDocument,
  childIds: readonly string[],
  definition: Extract<ComponentPropertyDefinition, { type: "SLOT" }>,
): SlotLimitViolation[] {
  const result: SlotLimitViolation[] = [];
  const settings = definition.slotSettings ?? {};
  if (settings.minChildren != null && childIds.length < settings.minChildren)
    result.push("BELOW_MIN");
  if (settings.maxChildren != null && childIds.length > settings.maxChildren)
    result.push("ABOVE_MAX");
  if (settings.allowPreferredValuesOnly) {
    const preferred = definition.preferredValues ?? [];
    const valid = childIds.every((childId) => {
      const child = document.nodesById[childId];
      if (child?.kind !== "instance") return false;
      const component = document.componentsById[child.properties.componentId];
      return preferred.some((candidate) =>
        candidate.type === "COMPONENT"
          ? candidate.key === child.properties.componentId
          : candidate.key === component?.variantSetId,
      );
    });
    if (!valid) result.push("HAS_NON_PREFERRED");
  }
  return result;
}

function componentPropertyValueMatches(
  definition: ComponentPropertyDefinition,
  value: ComponentPropertyAssignment,
): boolean {
  return definition.type === "BOOLEAN"
    ? typeof value === "boolean"
    : typeof value === "string";
}

export function applyComponentPropertyReferences(
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

export function applyInstanceShell(
  node: DesignNode,
  shell: InstanceNode,
): void {
  node.name = shell.name;
  node.transform = [...shell.transform];
  node.visible = shell.visible && node.visible;
  node.locked = shell.locked || node.locked;
  node.opacity *= shell.opacity;
  node.effects = [...(node.effects ?? []), ...(shell.effects ?? [])];
  if (shell.maskMode !== undefined) node.maskMode = shell.maskMode;
  if (shell.blendMode !== undefined) node.blendMode = shell.blendMode;
  node.explicitVariableModes = {
    ...(node.explicitVariableModes ?? {}),
    ...(shell.explicitVariableModes ?? {}),
  };
  if (Object.keys(node.explicitVariableModes).length === 0) {
    delete node.explicitVariableModes;
  }
  node.boundVariables = {
    ...(node.boundVariables ?? {}),
    ...(shell.boundVariables ?? {}),
  };
  if (Object.keys(node.boundVariables).length === 0) delete node.boundVariables;
  node.extensions = { ...node.extensions, ...shell.extensions };
}

export function applyOverride(
  source: DesignNode,
  patch: ComponentOverridePatch | undefined,
): DesignNode {
  const clone = structuredClone(source);
  if (!patch) return clone;
  if (patch.name !== undefined) clone.name = patch.name;
  if (patch.visible !== undefined) clone.visible = patch.visible;
  if (patch.locked !== undefined) clone.locked = patch.locked;
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
