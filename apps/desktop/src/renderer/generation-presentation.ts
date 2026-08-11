import type { AgentEvent } from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  EditorEvent,
  Transform,
} from "@opendesign/design-contracts";
import type {
  LeaferGenerationReveal,
  LeaferGenerationSkeleton,
} from "@opendesign/leafer-engine";
import {
  DESIGN_PLAN_TOOL_NAME,
  isDesignPlanToolInput,
  type DesignPlanToolInput,
} from "../shared/design-agent-tools";

export interface AcceptedGenerationPlan {
  id: string;
  plan: DesignPlanToolInput;
  runId: string;
  toolCallId: string;
}

interface RequestedGenerationPlan {
  plan: DesignPlanToolInput;
  runId: string;
  toolCallId: string;
}

export interface GenerationPlanPresentationState {
  acceptedByRunId: Readonly<Record<string, AcceptedGenerationPlan>>;
  requestedByCallId: Readonly<Record<string, RequestedGenerationPlan>>;
}

export const EMPTY_GENERATION_PLAN_PRESENTATION_STATE: GenerationPlanPresentationState =
  {
    acceptedByRunId: {},
    requestedByCallId: {},
  };

export function projectGenerationPlanPresentationEvent(
  state: GenerationPlanPresentationState,
  event: AgentEvent,
): GenerationPlanPresentationState {
  if (event.type === "agent.error" && event.runId === undefined) {
    return EMPTY_GENERATION_PLAN_PRESENTATION_STATE;
  }
  if (event.type === "run.completed") {
    return clearGenerationPlanPresentationRun(state, event.runId);
  }
  if (event.type === "agent.error" && event.runId !== undefined) {
    return clearGenerationPlanPresentationRun(state, event.runId);
  }
  if (
    event.type === "tool.requested" &&
    event.toolName === DESIGN_PLAN_TOOL_NAME
  ) {
    if (!isDesignPlanToolInput(event.input)) return state;
    const callId = generationPlanCallId(event.runId, event.toolCallId);
    return {
      ...state,
      requestedByCallId: {
        ...state.requestedByCallId,
        [callId]: {
          plan: structuredClone(event.input),
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
    };
  }
  if (event.type !== "tool.completed" && event.type !== "tool.failed") {
    return state;
  }
  const callId = generationPlanCallId(event.runId, event.toolCallId);
  const requested = state.requestedByCallId[callId];
  if (!requested) return state;
  const requestedByCallId = { ...state.requestedByCallId };
  delete requestedByCallId[callId];
  if (
    event.type === "tool.failed" ||
    !isAcceptedGenerationPlanResult(event.result, requested.plan)
  ) {
    return { ...state, requestedByCallId };
  }
  return {
    acceptedByRunId: {
      ...state.acceptedByRunId,
      [event.runId]: {
        id: callId,
        plan: structuredClone(requested.plan),
        runId: event.runId,
        toolCallId: event.toolCallId,
      },
    },
    requestedByCallId,
  };
}

export function clearGenerationPlanPresentationRun(
  state: GenerationPlanPresentationState,
  runId: string,
): GenerationPlanPresentationState {
  const acceptedByRunId = { ...state.acceptedByRunId };
  const hadAccepted = acceptedByRunId[runId] !== undefined;
  delete acceptedByRunId[runId];
  const requestedByCallId = Object.fromEntries(
    Object.entries(state.requestedByCallId).filter(
      ([, requested]) => requested.runId !== runId,
    ),
  );
  if (
    !hadAccepted &&
    Object.keys(requestedByCallId).length ===
      Object.keys(state.requestedByCallId).length
  ) {
    return state;
  }
  return { acceptedByRunId, requestedByCallId };
}

export function generationSkeletonFromAcceptedPlan(
  accepted: AcceptedGenerationPlan | undefined,
  document: DesignDocument,
  pageId: string,
): LeaferGenerationSkeleton | undefined {
  if (!accepted || accepted.plan.pageId !== pageId) return undefined;
  const { artboard } = accepted.plan;
  const actualArtboard = document.nodesById[artboard.frameId];
  const useActualArtboard =
    actualArtboard?.kind === "frame" &&
    document.pagesById[pageId]?.rootNodeIds.includes(actualArtboard.id) ===
      true &&
    sameTransform(actualArtboard.transform, [
      1,
      0,
      0,
      1,
      artboard.x,
      artboard.y,
    ]) &&
    actualArtboard.size.width === artboard.width &&
    actualArtboard.size.height === artboard.height;
  if (
    (actualArtboard !== undefined && !useActualArtboard) ||
    (artboard.mode === "existing" && !useActualArtboard)
  ) {
    return undefined;
  }
  const transform: Transform = useActualArtboard
    ? actualArtboard.transform
    : [1, 0, 0, 1, artboard.x, artboard.y];
  return {
    id: accepted.id,
    artboard: {
      frameId: artboard.frameId,
      height: useActualArtboard ? actualArtboard.size.height : artboard.height,
      pending: !useActualArtboard,
      transform,
      width: useActualArtboard ? actualArtboard.size.width : artboard.width,
    },
    regions: accepted.plan.composition.regions
      .filter(
        (region) =>
          !generationRegionFulfilled(document, artboard.frameId, region.nodeId),
      )
      .map((region) => ({
        height: region.height,
        id: region.nodeId,
        name: region.name,
        role: region.role,
        width: region.width,
        x: region.x,
        y: region.y,
      })),
  };
}

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

function generationPlanCallId(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

function isAcceptedGenerationPlanResult(
  value: unknown,
  plan: DesignPlanToolInput,
): boolean {
  if (!isRecord(value)) return false;
  return (
    value.ok === true &&
    value.status === "accepted" &&
    value.version === plan.version &&
    value.pageId === plan.pageId &&
    value.deliverable === plan.deliverable &&
    value.outputMode === plan.outputMode &&
    sameJson(value.artboard, plan.artboard) &&
    sameJson(value.regions, plan.composition.regions) &&
    sameJson(value.editableLayers, plan.editableLayers) &&
    sameJson(value.rasterAssetRoles, plan.rasterAssetRoles)
  );
}

function generationRegionFulfilled(
  document: DesignDocument,
  artboardId: string,
  nodeId: string,
): boolean {
  const node = document.nodesById[nodeId];
  if (!node || !isDescendantOf(document, nodeId, artboardId)) return false;
  return subtreeContainsMaterialNode(document, nodeId, new Set());
}

function subtreeContainsMaterialNode(
  document: DesignDocument,
  nodeId: string,
  visited: Set<string>,
): boolean {
  if (visited.has(nodeId)) return false;
  visited.add(nodeId);
  const node = document.nodesById[nodeId];
  if (!node) return false;
  if (node.kind !== "group" && node.kind !== "frame") return true;
  return node.childIds.some((childId) =>
    subtreeContainsMaterialNode(document, childId, visited),
  );
}

function isDescendantOf(
  document: DesignDocument,
  nodeId: string,
  ancestorId: string,
): boolean {
  const visited = new Set<string>();
  let current = document.nodesById[nodeId]?.parentId ?? null;
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = document.nodesById[current]?.parentId ?? null;
  }
  return false;
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every((value, index) => value === right[index]);
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
