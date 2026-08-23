import type { DesignDocument } from "@opendesign/design-contracts";
import {
  planAddComponentProperty,
  planAddComponentToVariantSet,
  planAddVariantProperty,
  planClearComponentSlot,
  planCreateComponent,
  planCreateComponentSlotOverride,
  planCreateInstance,
  planCombineComponentsAsVariants,
  planDissolveVariantSet,
  planDuplicateVariant,
  planDetachComponentInstance,
  planRemoveComponent,
  planRemoveComponentProperty,
  planRemoveVariantFromSet,
  planRemoveVariantProperty,
  planRenameComponentProperty,
  planReorderComponentProperties,
  planRenameVariantProperty,
  planRenameVariantValue,
  planReorderVariantProperties,
  planReorderVariantValues,
  planResetComponentOverrides,
  planResetComponentPropertyValue,
  planResetComponentSlot,
  planSetComponentOverride,
  planSetComponentPropertyValue,
  planSetComponentSlotSettings,
  planSetVariantProperties,
  type ComponentOperationPlan,
  type VariantSetOperationPlan,
} from "@opendesign/editor-runtime";
import type { DesignComponentToolInput } from "../../../shared/design-agent-tools";

type WritableComponentToolInput = Exclude<
  DesignComponentToolInput,
  { action: "go-to-main" }
>;

export function planDesignComponentTool(
  document: DesignDocument,
  input: WritableComponentToolInput,
  commandPrefix: string,
): ComponentOperationPlan | VariantSetOperationPlan {
  switch (input.action) {
    case "create-component":
      return planCreateComponent(document, {
        componentId: input.componentId,
        nodeId: input.rootNodeId,
        name: input.name,
        commandPrefix,
      });
    case "create-instance":
      return planCreateInstance(document, {
        componentId: input.componentId,
        instanceId: input.instanceId,
        pageId: input.pageId,
        parentId: input.parentId,
        index: input.index,
        transform: [1, 0, 0, 1, input.x, input.y],
        ...(input.name === undefined ? {} : { name: input.name }),
        commandPrefix,
      });
    case "remove-component":
      return planRemoveComponent(document, {
        componentId: input.componentId,
        commandPrefix,
      });
    case "combine-as-variants": {
      const staleRoot = input.componentIds.find(
        (componentId, index) =>
          document.componentsById[componentId]?.rootNodeId !==
          input.componentRootNodeIds[index],
      );
      if (staleRoot) {
        return {
          ok: false,
          code: "invalid",
          message: `Component ${staleRoot} no longer matches its inspected root`,
        };
      }
      const plan = planCombineComponentsAsVariants(document, {
        pageId: input.pageId,
        componentIds: input.componentIds,
        variantSetId: input.variantSetId,
        rootNodeId: input.rootNodeId,
        name: input.name,
        variantPropertiesByComponentId: input.variantPropertiesByComponentId,
        commandPrefix,
      });
      return plan.ok
        ? plan
        : { ok: false, code: "invalid", message: plan.message };
    }
    case "add-component-to-variant-set":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
          input.rootNodeId ||
        document.componentsById[input.componentId]?.rootNodeId !==
          input.componentRootNodeId
      )
        return {
          ok: false,
          code: "invalid",
          message:
            "Component Set or Component no longer matches its inspected root",
        };
      return planAddComponentToVariantSet(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        componentId: input.componentId,
        variantProperties: input.variantProperties,
        commandPrefix,
      });
    case "duplicate-variant":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
          input.rootNodeId ||
        document.componentsById[input.sourceComponentId]?.rootNodeId !==
          input.sourceRootNodeId
      )
        return {
          ok: false,
          code: "invalid",
          message:
            "Component Set or source Variant no longer matches its inspected root",
        };
      return planDuplicateVariant(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        sourceComponentId: input.sourceComponentId,
        componentId: input.componentId,
        rootNodeId: input.componentRootNodeId,
        ...(input.name === undefined ? {} : { name: input.name }),
        variantProperties: input.variantProperties,
        commandPrefix,
      });
    case "remove-variant":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
          input.rootNodeId ||
        document.componentsById[input.componentId]?.rootNodeId !==
          input.componentRootNodeId
      )
        return {
          ok: false,
          code: "invalid",
          message:
            "Component Set or Variant no longer matches its inspected root",
        };
      return planRemoveVariantFromSet(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        componentId: input.componentId,
        commandPrefix,
      });
    case "dissolve-variant-set":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return {
          ok: false,
          code: "invalid",
          message: "Component Set no longer matches its inspected root",
        };
      return planDissolveVariantSet(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        commandPrefix,
      });
    case "add-variant-property":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planAddVariantProperty(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyName: input.propertyName,
        valuesByComponentId: input.valuesByComponentId,
        ...(input.index === undefined ? {} : { index: input.index }),
        commandPrefix,
      });
    case "rename-variant-property":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planRenameVariantProperty(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyName: input.propertyName,
        name: input.name,
        commandPrefix,
      });
    case "reorder-variant-properties":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planReorderVariantProperties(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyOrder: input.propertyOrder,
        commandPrefix,
      });
    case "remove-variant-property":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planRemoveVariantProperty(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "rename-variant-value":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planRenameVariantValue(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyName: input.propertyName,
        value: input.value,
        name: input.name,
        commandPrefix,
      });
    case "reorder-variant-values":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
        input.rootNodeId
      )
        return staleSet();
      return planReorderVariantValues(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        propertyName: input.propertyName,
        values: input.values,
        commandPrefix,
      });
    case "set-variant-properties":
      if (
        document.variantSetsById[input.variantSetId]?.rootNodeId !==
          input.rootNodeId ||
        document.componentsById[input.componentId]?.rootNodeId !==
          input.componentRootNodeId
      )
        return staleSet();
      return planSetVariantProperties(document, {
        pageId: input.pageId,
        variantSetId: input.variantSetId,
        componentId: input.componentId,
        variantProperties: input.variantProperties,
        commandPrefix,
      });
    case "add-property":
      return planAddComponentProperty(document, {
        componentId: input.componentId,
        propertyId: input.propertyId,
        name: input.name,
        type: input.type,
        sourceNodeId: input.sourceNodeId,
        ...(input.preferredValues === undefined
          ? {}
          : { preferredValues: input.preferredValues }),
        commandPrefix,
      });
    case "rename-property":
      return planRenameComponentProperty(document, {
        componentId: input.componentId,
        propertyName: input.propertyName,
        name: input.name,
        commandPrefix,
      });
    case "reorder-properties":
      if (
        document.componentsById[input.componentId]?.rootNodeId !==
        input.componentRootNodeId
      ) {
        return {
          ok: false,
          code: "invalid",
          message: "Component no longer matches its inspected root",
        };
      }
      return planReorderComponentProperties(document, {
        componentId: input.componentId,
        componentPropertyOrder: input.componentPropertyOrder,
        commandPrefix,
      });
    case "remove-property":
      return planRemoveComponentProperty(document, {
        componentId: input.componentId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "set-property":
      return planSetComponentPropertyValue(document, {
        instanceId: input.instanceId,
        propertyName: input.propertyName,
        value: input.value,
        commandPrefix,
      });
    case "reset-property":
      return planResetComponentPropertyValue(document, {
        instanceId: input.instanceId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "create-slot-override":
      return planCreateComponentSlotOverride(document, {
        instanceId: input.instanceId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "clear-slot":
      return planClearComponentSlot(document, {
        instanceId: input.instanceId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "reset-slot":
      return planResetComponentSlot(document, {
        instanceId: input.instanceId,
        propertyName: input.propertyName,
        commandPrefix,
      });
    case "set-slot-settings":
      return planSetComponentSlotSettings(document, {
        componentId: input.componentId,
        propertyName: input.propertyName,
        settings: input.settings,
        ...(input.preferredValues === undefined
          ? {}
          : { preferredValues: input.preferredValues }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        commandPrefix,
      });
    case "set-override":
      return planSetComponentOverride(document, {
        instanceId: input.instanceId,
        sourcePath: input.sourcePath,
        patch: input.patch,
        commandPrefix,
      });
    case "reset-overrides":
      return planResetComponentOverrides(document, {
        instanceId: input.instanceId,
        ...(input.sourcePath === undefined
          ? {}
          : { sourcePath: input.sourcePath }),
        commandPrefix,
      });
    case "detach-instance":
      return planDetachComponentInstance(document, {
        instanceId: input.instanceId,
        commandPrefix,
      });
  }
}

function staleSet(): ComponentOperationPlan {
  return {
    ok: false,
    code: "invalid",
    message: "Component Set no longer matches its inspected root",
  };
}
