import type { DesignComponentToolInput } from "../../shared/design-agent-tools";

export function materialTargetRefsForComponentTool(
  input: DesignComponentToolInput,
): {
  nodeIds: string[];
  parentId?: string | null;
  createdNodeIds: string[];
} {
  switch (input.action) {
    case "create-component":
      return { nodeIds: [input.nodeId], createdNodeIds: [] };
    case "remove-component":
      return { nodeIds: [], createdNodeIds: [] };
    case "combine-as-variants":
      return {
        nodeIds: [...input.componentRootNodeIds],
        createdNodeIds: [input.rootNodeId],
      };
    case "add-component-to-variant-set":
      return {
        nodeIds: [input.rootNodeId, input.componentRootNodeId],
        createdNodeIds: [],
      };
    case "duplicate-variant":
      return {
        nodeIds: [input.rootNodeId, input.sourceRootNodeId],
        createdNodeIds: [input.componentRootNodeId],
      };
    case "remove-variant":
      return {
        nodeIds: [input.rootNodeId, input.componentRootNodeId],
        createdNodeIds: [],
      };
    case "dissolve-variant-set":
      return { nodeIds: [input.rootNodeId], createdNodeIds: [] };
    case "add-property":
      return { nodeIds: [input.sourceNodeId], createdNodeIds: [] };
    case "rename-property":
    case "remove-property":
      return { nodeIds: [], createdNodeIds: [] };
    case "create-instance":
      return {
        nodeIds: [],
        parentId: input.parentId,
        createdNodeIds: [input.instanceId],
      };
    case "set-override":
    case "reset-overrides":
    case "set-property":
    case "reset-property":
    case "detach-instance":
    case "go-to-main":
      return { nodeIds: [input.instanceId], createdNodeIds: [] };
  }
}

export function componentToolIsMaterialWrite(
  input: DesignComponentToolInput,
): boolean {
  if (
    input.action === "combine-as-variants" ||
    input.action === "add-component-to-variant-set" ||
    input.action === "duplicate-variant" ||
    input.action === "remove-variant" ||
    input.action === "dissolve-variant-set" ||
    input.action === "create-instance" ||
    input.action === "reset-overrides" ||
    input.action === "set-property" ||
    input.action === "reset-property" ||
    input.action === "remove-property"
  ) {
    return true;
  }
  if (input.action !== "set-override") return false;
  return Object.keys(input.patch).some((key) => key !== "name");
}
