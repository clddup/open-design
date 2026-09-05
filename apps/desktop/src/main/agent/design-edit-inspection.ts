import type { DesignChangeSet } from "@opendesign/design-contracts";
import type { InspectedHierarchy } from "./design-plan-registration.js";
import { projectInspectedNode } from "./design-inspection-parser.js";

/** Advance only an exact base hierarchy; ChangeSet validation belongs to Main. */
export function advanceDesignEditInspection(
  inspection: InspectedHierarchy | undefined,
  changes: DesignChangeSet,
): InspectedHierarchy | undefined {
  if (
    !inspection ||
    inspection.documentId !== changes.documentId ||
    inspection.revision !== changes.fromRevision
  )
    return undefined;

  // This is a disposable inspection projection, not a second DesignDocument.
  const next = structuredClone(inspection);
  for (const change of changes.changes) {
    if (change.after)
      next.nodesById.set(
        change.nodeId,
        projectInspectedNode(change.nodeId, change.after),
      );
    else next.nodesById.delete(change.nodeId);
  }
  for (const change of changes.pageChanges ?? []) {
    if (change.after) {
      next.pageRootsById.set(change.pageId, new Set(change.after.rootNodeIds));
    } else next.pageRootsById.delete(change.pageId);
  }
  for (const change of changes.componentChanges ?? []) {
    if (change.after) {
      next.componentsById.set(change.componentId, {
        id: change.componentId,
        rootNodeId: change.after.rootNodeId,
      });
    } else {
      next.componentsById.delete(change.componentId);
      next.catalogComponentsById.delete(change.componentId);
    }
  }
  next.revision = changes.toRevision;
  return next;
}
