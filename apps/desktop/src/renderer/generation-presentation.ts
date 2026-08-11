import type { DesignDocument, EditorEvent } from "@opendesign/design-contracts";
import type { LeaferGenerationReveal } from "@opendesign/leafer-engine";

/**
 * Derives disposable canvas presentation from an already-committed Agent
 * change. It never creates or mutates design data: the authoritative document
 * remains the EditorRuntime snapshot carried by the event.
 */
export function generationRevealFromEditorEvent(
  event: EditorEvent,
  document: DesignDocument,
  pageId: string,
  startedAt: number,
): LeaferGenerationReveal | undefined {
  if (
    event.type !== "document.changed" ||
    event.result.revision.actor?.type !== "agent" ||
    event.result.changes.addedNodeIds.length === 0
  ) {
    return undefined;
  }
  const page = document.pagesById[pageId];
  if (!page) return undefined;
  const added = new Set(event.result.changes.addedNodeIds);
  const ordered: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (added.has(nodeId)) ordered.push(nodeId);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  if (ordered.length === 0) return undefined;
  return {
    id: event.eventId,
    nodeIds: ordered,
    startedAt: Number.isFinite(startedAt) ? Math.max(0, startedAt) : 0,
  };
}
