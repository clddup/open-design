import { componentIdForSourceNode } from "@opendesign/component-service";
import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";

export function synchronizeComponentPropertyDefaults(
  document: DesignDocument,
  node: DesignNode,
  command: Extract<DesignOperation, { type: "update_properties" }>,
): void {
  const references = node.componentPropertyReferences;
  if (!references) return;
  const componentId = componentIdForSourceNode(document, node.id);
  const component = componentId
    ? document.componentsById[componentId]
    : undefined;
  if (!component) return;
  if (command.visible !== undefined && references.visible) {
    const definition =
      component.componentPropertyDefinitions[references.visible];
    if (definition?.type === "BOOLEAN") definition.defaultValue = node.visible;
  }
  if (
    node.kind === "text" &&
    command.properties?.content !== undefined &&
    references.characters
  ) {
    const definition =
      component.componentPropertyDefinitions[references.characters];
    if (definition?.type === "TEXT") {
      definition.defaultValue = node.properties.content;
    }
  }
  if (
    node.kind === "instance" &&
    command.properties?.componentId !== undefined &&
    references.mainComponent
  ) {
    const definition =
      component.componentPropertyDefinitions[references.mainComponent];
    if (definition?.type === "INSTANCE_SWAP") {
      definition.defaultValue = node.properties.componentId;
    }
  }
}
