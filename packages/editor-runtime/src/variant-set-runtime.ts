import type {
  DesignDocument,
  DesignOperation,
} from "@opendesign/design-contracts";
import { OperationError } from "./operation-error.js";

export function putVariantSet(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_variant_set" }>,
): void {
  const existing = document.variantSetsById[command.variantSet.id];
  if (existing && existing.rootNodeId !== command.variantSet.rootNodeId) {
    throw new OperationError(
      command.commandId,
      "design.variant_set.duplicate",
      `Component set ${command.variantSet.id} is already bound to ${existing.rootNodeId}`,
      "duplicate",
    );
  }
  document.variantSetsById[command.variantSet.id] = structuredClone(
    command.variantSet,
  );
}

export function deleteVariantSet(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_variant_set" }>,
): void {
  if (!document.variantSetsById[command.variantSetId]) {
    throw new OperationError(
      command.commandId,
      "design.variant_set.not_found",
      `Node ${command.variantSetId} does not exist`,
      "not-found",
    );
  }
  const member = Object.values(document.componentsById).find(
    (component) => component.variantSetId === command.variantSetId,
  );
  if (member) {
    throw new OperationError(
      command.commandId,
      "design.variant_set.in_use",
      `Component set ${command.variantSetId} is still referenced by component ${member.id}`,
    );
  }
  const preferredBy = Object.values(document.componentsById).find((component) =>
    Object.values(component.componentPropertyDefinitions).some(
      (definition) =>
        definition.type === "INSTANCE_SWAP" &&
        definition.preferredValues?.some(
          (preferred) =>
            preferred.type === "COMPONENT_SET" &&
            preferred.key === command.variantSetId,
        ),
    ),
  );
  if (preferredBy) {
    throw new OperationError(
      command.commandId,
      "design.variant_set.preferred_in_use",
      `Component set ${command.variantSetId} is still preferred by component ${preferredBy.id}`,
    );
  }
  delete document.variantSetsById[command.variantSetId];
}
