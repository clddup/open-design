import type { DesignDocument } from "@opendesign/design-contracts";
import {
  planAddComponentProperty,
  planCreateComponent,
  planCreateInstance,
  planCombineComponentsAsVariants,
  planDetachComponentInstance,
  planRemoveComponent,
  planRemoveComponentProperty,
  planRenameComponentProperty,
  planResetComponentOverrides,
  planResetComponentPropertyValue,
  planSetComponentOverride,
  planSetComponentPropertyValue,
  type ComponentOperationPlan,
} from "@opendesign/editor-runtime";
import type { DesignComponentToolInput } from "../shared/design-agent-tools";

type WritableComponentToolInput = Exclude<
  DesignComponentToolInput,
  { action: "go-to-main" }
>;

export function planDesignComponentTool(
  document: DesignDocument,
  input: WritableComponentToolInput,
  commandPrefix: string,
): ComponentOperationPlan {
  switch (input.action) {
    case "create-component":
      return planCreateComponent(document, {
        componentId: input.componentId,
        nodeId: input.nodeId,
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
