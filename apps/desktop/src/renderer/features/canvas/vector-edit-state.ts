import type { Paint } from "@opendesign/design-contracts";
import type { LeaferVectorEditTool } from "@opendesign/leafer-engine";

export interface CanvasVectorEditState {
  activeNodeId: string;
  nodeIds: readonly string[];
  selectedSegmentIdsByNode: Readonly<Record<string, readonly string[]>>;
  selectedVertexIdsByNode: Readonly<Record<string, readonly string[]>>;
  tool: LeaferVectorEditTool;
  fillStyleId: string | null;
  paint: readonly Paint[];
}

export function resetVectorPointSelection(
  state: CanvasVectorEditState,
  nodeIds: readonly string[],
  activeNodeId: string,
): CanvasVectorEditState {
  const emptyByNode = () =>
    Object.fromEntries(nodeIds.map((nodeId) => [nodeId, []]));
  return {
    ...state,
    activeNodeId,
    nodeIds,
    selectedSegmentIdsByNode: emptyByNode(),
    selectedVertexIdsByNode: emptyByNode(),
  };
}
