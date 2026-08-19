import type { AgentEvent } from "@opendesign/agent-contracts";
import type {
  DesignDocument,
  EditorEvent,
  Point,
  Transform,
} from "@opendesign/design-contracts";
import { isFrameLikeNode } from "@opendesign/design-contracts";
import { getNodeBounds } from "@opendesign/editor-runtime";
import type {
  LeaferGenerationActivity,
  LeaferGenerationActivityPhase,
  LeaferGenerationReveal,
  LeaferGenerationSkeleton,
} from "@opendesign/leafer-engine";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  designPlanTargets,
  compileDesignFirstSliceToolInput,
  isDesignCheckpointToolInput,
  isDesignFirstSliceToolInput,
  isDesignPlanToolInput,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  type DesignPlanToolInput,
  UPDATE_IMAGE_TOOL_NAME,
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

interface RequestedGenerationTool {
  checkpointAction?: "apply-and-capture" | "review-refine-and-capture";
  runId: string;
  toolName: string;
}

export interface GenerationActivityState {
  id: string;
  phase: LeaferGenerationActivityPhase;
  progress?: number;
  runId: string;
  toolCallId?: string;
}

export interface GenerationPlanPresentationState {
  acceptedByRunId: Readonly<Record<string, AcceptedGenerationPlan>>;
  activityByRunId: Readonly<Record<string, GenerationActivityState>>;
  requestedByCallId: Readonly<Record<string, RequestedGenerationPlan>>;
  requestedToolByCallId: Readonly<Record<string, RequestedGenerationTool>>;
  reviewedByRunId: Readonly<Record<string, true>>;
}

export const EMPTY_GENERATION_PLAN_PRESENTATION_STATE: GenerationPlanPresentationState =
  {
    acceptedByRunId: {},
    activityByRunId: {},
    requestedByCallId: {},
    requestedToolByCallId: {},
    reviewedByRunId: {},
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
  if (event.type === "tool.progress") {
    const callId = generationPlanCallId(event.runId, event.toolCallId);
    const requested = state.requestedToolByCallId[callId];
    const activity = state.activityByRunId[event.runId];
    if (!requested || activity?.toolCallId !== event.toolCallId) return state;
    return {
      ...state,
      activityByRunId: {
        ...state.activityByRunId,
        [event.runId]: {
          ...activity,
          id: `${callId}:progress:${Math.round(event.progress * 1_000)}`,
          progress: event.progress,
        },
      },
    };
  }
  if (
    event.type === "tool.requested" &&
    (event.toolName === DESIGN_PLAN_TOOL_NAME ||
      event.toolName === DESIGN_FIRST_SLICE_TOOL_NAME)
  ) {
    const plan =
      event.toolName === DESIGN_FIRST_SLICE_TOOL_NAME
        ? isDesignFirstSliceToolInput(event.input)
          ? compileDesignFirstSliceToolInput(event.input).plan
          : undefined
        : isDesignPlanToolInput(event.input)
          ? event.input
          : undefined;
    if (!plan) return state;
    const callId = generationPlanCallId(event.runId, event.toolCallId);
    return {
      ...state,
      ...(event.toolName === DESIGN_FIRST_SLICE_TOOL_NAME
        ? {
            activityByRunId: {
              ...state.activityByRunId,
              [event.runId]: {
                id: `${callId}:requested`,
                phase: "building" as const,
                runId: event.runId,
                toolCallId: event.toolCallId,
              },
            },
            requestedToolByCallId: {
              ...state.requestedToolByCallId,
              [callId]: {
                runId: event.runId,
                toolName: event.toolName,
              },
            },
          }
        : {}),
      requestedByCallId: {
        ...state.requestedByCallId,
        [callId]: {
          plan: structuredClone(plan),
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
    };
  }
  if (event.type === "tool.requested") {
    if (!state.acceptedByRunId[event.runId]) return state;
    const phase = generationPhaseForTool(
      event.toolName,
      state.reviewedByRunId[event.runId] === true,
    );
    if (!phase) return state;
    const callId = generationPlanCallId(event.runId, event.toolCallId);
    return {
      ...state,
      activityByRunId: {
        ...state.activityByRunId,
        [event.runId]: {
          id: `${callId}:requested`,
          phase,
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
      requestedToolByCallId: {
        ...state.requestedToolByCallId,
        [callId]: {
          runId: event.runId,
          toolName: event.toolName,
          ...(event.toolName === DESIGN_CHECKPOINT_TOOL_NAME &&
          isDesignCheckpointToolInput(event.input)
            ? { checkpointAction: event.input.action }
            : {}),
        },
      },
    };
  }
  if (event.type !== "tool.completed" && event.type !== "tool.failed") {
    return state;
  }
  const callId = generationPlanCallId(event.runId, event.toolCallId);
  const requestedPlan = state.requestedByCallId[callId];
  if (requestedPlan) {
    const requestedByCallId = { ...state.requestedByCallId };
    const requestedToolByCallId = { ...state.requestedToolByCallId };
    delete requestedByCallId[callId];
    delete requestedToolByCallId[callId];
    if (
      event.type === "tool.failed" ||
      !acceptedGenerationPlan(event.result, requestedPlan.plan)
    ) {
      return { ...state, requestedByCallId, requestedToolByCallId };
    }
    const reviewedByRunId = { ...state.reviewedByRunId };
    delete reviewedByRunId[event.runId];
    return {
      ...state,
      acceptedByRunId: {
        ...state.acceptedByRunId,
        [event.runId]: {
          id: callId,
          plan: structuredClone(
            acceptedGenerationPlan(event.result, requestedPlan.plan) ??
              requestedPlan.plan,
          ),
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
      activityByRunId: {
        ...state.activityByRunId,
        [event.runId]: {
          id: `${callId}:accepted`,
          phase: "structuring",
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
      requestedByCallId,
      requestedToolByCallId,
      reviewedByRunId,
    };
  }

  const requestedTool = state.requestedToolByCallId[callId];
  if (!requestedTool) return state;
  const requestedToolByCallId = { ...state.requestedToolByCallId };
  delete requestedToolByCallId[callId];
  if (event.type === "tool.failed") {
    return {
      ...state,
      activityByRunId: {
        ...state.activityByRunId,
        [event.runId]: {
          id: `${callId}:failed`,
          phase: "recovering",
          runId: event.runId,
          toolCallId: event.toolCallId,
        },
      },
      requestedToolByCallId,
    };
  }

  const reviewedByRunId = { ...state.reviewedByRunId };
  const reviewCompleted =
    requestedTool.toolName === DESIGN_REVIEW_TOOL_NAME ||
    requestedTool.checkpointAction === "review-refine-and-capture";
  if (reviewCompleted) reviewedByRunId[event.runId] = true;
  const phase = reviewCompleted
    ? "refining"
    : generationPhaseForTool(
        requestedTool.toolName,
        reviewedByRunId[event.runId] === true,
      );
  if (!phase) return { ...state, requestedToolByCallId, reviewedByRunId };
  return {
    ...state,
    activityByRunId: {
      ...state.activityByRunId,
      [event.runId]: {
        id: `${callId}:completed`,
        phase,
        runId: event.runId,
        toolCallId: event.toolCallId,
      },
    },
    requestedToolByCallId,
    reviewedByRunId,
  };
}

export function clearGenerationPlanPresentationRun(
  state: GenerationPlanPresentationState,
  runId: string,
): GenerationPlanPresentationState {
  const acceptedByRunId = { ...state.acceptedByRunId };
  const activityByRunId = { ...state.activityByRunId };
  const reviewedByRunId = { ...state.reviewedByRunId };
  const hadRunState =
    acceptedByRunId[runId] !== undefined ||
    activityByRunId[runId] !== undefined ||
    reviewedByRunId[runId] !== undefined;
  delete acceptedByRunId[runId];
  delete activityByRunId[runId];
  delete reviewedByRunId[runId];
  const requestedByCallId = Object.fromEntries(
    Object.entries(state.requestedByCallId).filter(
      ([, requested]) => requested.runId !== runId,
    ),
  );
  const requestedToolByCallId = Object.fromEntries(
    Object.entries(state.requestedToolByCallId).filter(
      ([, requested]) => requested.runId !== runId,
    ),
  );
  if (
    !hadRunState &&
    Object.keys(requestedByCallId).length ===
      Object.keys(state.requestedByCallId).length &&
    Object.keys(requestedToolByCallId).length ===
      Object.keys(state.requestedToolByCallId).length
  ) {
    return state;
  }
  return {
    acceptedByRunId,
    activityByRunId,
    requestedByCallId,
    requestedToolByCallId,
    reviewedByRunId,
  };
}

export function generationSkeletonFromAcceptedPlan(
  accepted: AcceptedGenerationPlan | undefined,
  document: DesignDocument,
  pageId: string,
): LeaferGenerationSkeleton | undefined {
  if (!accepted) return undefined;
  const pageTargets = designPlanTargets(accepted.plan).filter(
    (target) => target.pageId === pageId,
  );
  const target =
    pageTargets.find((candidate) => {
      const artboard = document.nodesById[candidate.artboard.frameId];
      return (
        artboard === undefined ||
        candidate.composition.regions.some(
          (region) =>
            !generationRegionFulfilled(
              document,
              candidate.artboard.frameId,
              region.nodeId,
            ),
        )
      );
    }) ?? pageTargets[0];
  if (!target) return undefined;
  const { artboard } = target;
  const actualArtboard = document.nodesById[artboard.frameId];
  const useActualArtboard =
    actualArtboard?.kind === "frame" &&
    document.pagesById[pageId]?.rootNodeIds.includes(actualArtboard.id) ===
      true &&
    isTranslationOnly(actualArtboard.transform) &&
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
    id:
      accepted.plan.version === 2
        ? accepted.id
        : `${accepted.id}:${target.targetId}`,
    artboard: {
      frameId: artboard.frameId,
      height: useActualArtboard ? actualArtboard.size.height : artboard.height,
      pending: !useActualArtboard,
      transform,
      width: useActualArtboard ? actualArtboard.size.width : artboard.width,
    },
    regions:
      artboard.mode === "existing"
        ? []
        : target.composition.regions
            .filter(
              (region) =>
                !generationRegionFulfilled(
                  document,
                  artboard.frameId,
                  region.nodeId,
                ),
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

export function generationActivityFromAcceptedPlan(
  accepted: AcceptedGenerationPlan | undefined,
  activity: GenerationActivityState | undefined,
  document: DesignDocument,
  pageId: string,
): Omit<LeaferGenerationActivity, "label"> | undefined {
  if (!accepted || !activity || accepted.runId !== activity.runId) {
    return undefined;
  }
  const target = designPlanTargets(accepted.plan).find(
    (candidate) => candidate.pageId === pageId,
  );
  if (!target) return undefined;
  const artboard = document.nodesById[target.artboard.frameId];
  if (
    artboard?.kind !== "frame" ||
    artboard.parentId !== null ||
    document.pagesById[pageId]?.rootNodeIds.includes(artboard.id) !== true ||
    !isTranslationOnly(artboard.transform) ||
    artboard.size.width !== target.artboard.width ||
    artboard.size.height !== target.artboard.height
  ) {
    return undefined;
  }
  const localTarget = {
    x: Math.max(0, artboard.size.width - 24),
    y: Math.min(24, artboard.size.height / 2),
  };
  return {
    id: activity.id,
    phase: activity.phase,
    ...(activity.progress === undefined ? {} : { progress: activity.progress }),
    target: transformPoint(localTarget, artboard.transform),
  };
}

export function generationActivityMessageKey(
  phase: LeaferGenerationActivityPhase,
):
  | "agent.canvasPhaseStructuring"
  | "agent.canvasPhaseBuilding"
  | "agent.canvasPhaseAssets"
  | "agent.canvasPhaseReviewing"
  | "agent.canvasPhaseRefining"
  | "agent.canvasPhaseRecovering" {
  if (phase === "structuring") return "agent.canvasPhaseStructuring";
  if (phase === "building") return "agent.canvasPhaseBuilding";
  if (phase === "assets") return "agent.canvasPhaseAssets";
  if (phase === "reviewing") return "agent.canvasPhaseReviewing";
  if (phase === "refining") return "agent.canvasPhaseRefining";
  return "agent.canvasPhaseRecovering";
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
    event.result.revision.actor?.type !== "agent"
  ) {
    return undefined;
  }
  const page = document.pagesById[pageId];
  if (!page) return undefined;
  const added = new Set(event.result.changes.addedNodeIds);
  const tweenable = new Set(
    event.result.changes.changes.flatMap((change) => {
      if (
        change.type === "added" ||
        change.type === "removed" ||
        !change.before ||
        !change.after ||
        change.before.parentId !== change.after.parentId ||
        !change.changedFields.some((field) =>
          GENERATION_TWEEN_NODE_FIELDS.has(field),
        )
      ) {
        return [];
      }
      return [change.nodeId];
    }),
  );
  const orderedAdded: string[] = [];
  const orderedTween: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string): void => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (added.has(nodeId)) orderedAdded.push(nodeId);
    else if (tweenable.has(nodeId)) orderedTween.push(nodeId);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  if (orderedAdded.length === 0 && orderedTween.length === 0) return undefined;
  const ordered = [...orderedAdded, ...orderedTween];
  const focusPoints = Object.fromEntries(
    ordered.flatMap((nodeId) => {
      const bounds = getNodeBounds(document, nodeId);
      return bounds
        ? [
            [
              nodeId,
              {
                x: bounds.x + bounds.width / 2,
                y: bounds.y + bounds.height / 2,
              },
            ] as const,
          ]
        : [];
    }),
  );
  return {
    ...(Object.keys(focusPoints).length === 0 ? {} : { focusPoints }),
    id: event.eventId,
    nodeIds: orderedAdded,
    startedAt: Number.isFinite(startedAt) ? Math.max(0, startedAt) : 0,
    ...(orderedTween.length === 0 ? {} : { tweenNodeIds: orderedTween }),
  };
}

const GENERATION_TWEEN_NODE_FIELDS = new Set([
  "blendMode",
  "effects",
  "maskMode",
  "opacity",
  "properties",
  "size",
  "transform",
  "visible",
]);

function generationPhaseForTool(
  toolName: string,
  reviewed: boolean,
): LeaferGenerationActivityPhase | null {
  if (
    toolName === GENERATE_IMAGE_TOOL_NAME ||
    toolName === READ_IMAGE_TOOL_NAME
  ) {
    return "assets";
  }
  if (
    toolName === DESIGN_CAPTURE_TOOL_NAME ||
    toolName === DESIGN_REVIEW_TOOL_NAME ||
    toolName === DESIGN_CHECKPOINT_TOOL_NAME
  ) {
    return "reviewing";
  }
  if (
    toolName === DESIGN_APPLY_TOOL_NAME ||
    toolName === DESIGN_FIRST_SLICE_TOOL_NAME ||
    toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME ||
    toolName === DESIGN_HIERARCHY_TOOL_NAME ||
    toolName === DESIGN_ARRANGE_TOOL_NAME ||
    toolName === DESIGN_VECTOR_TOOL_NAME ||
    toolName === PLACE_IMAGE_TOOL_NAME ||
    toolName === UPDATE_IMAGE_TOOL_NAME ||
    toolName === INTERNAL_UPDATE_IMAGE_TOOL_NAME ||
    toolName === IMPORT_SVG_TOOL_NAME ||
    toolName === INTERNAL_IMPORT_SVG_TOOL_NAME
  ) {
    return reviewed ? "refining" : "building";
  }
  return null;
}

function transformPoint(point: Point, transform: Transform): Point {
  return {
    x: transform[0] * point.x + transform[2] * point.y + transform[4],
    y: transform[1] * point.x + transform[3] * point.y + transform[5],
  };
}

function generationPlanCallId(runId: string, toolCallId: string): string {
  return `${runId}:${toolCallId}`;
}

function acceptedGenerationPlan(
  value: unknown,
  plan: DesignPlanToolInput,
): DesignPlanToolInput | undefined {
  if (!isRecord(value)) return undefined;
  const authoritative = isDesignPlanToolInput(value.plan) ? value.plan : plan;
  const common =
    value.ok === true &&
    (value.status === "accepted" ||
      value.status === "unchanged" ||
      value.status === "amended") &&
    value.version === authoritative.version &&
    value.deliverable === authoritative.deliverable &&
    value.outputMode === authoritative.outputMode &&
    sameJson(value.rasterAssetRoles, authoritative.rasterAssetRoles);
  if (!common) return undefined;
  if (sameJson(value.targets, designPlanTargets(authoritative))) {
    return structuredClone(authoritative);
  }
  return plan.version === 2 &&
    authoritative.version === 2 &&
    value.pageId === authoritative.pageId &&
    sameJson(value.artboard, authoritative.artboard) &&
    sameJson(value.regions, authoritative.composition.regions) &&
    sameJson(value.editableLayers, authoritative.editableLayers)
    ? structuredClone(authoritative)
    : undefined;
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
  if (node.kind !== "group" && !isFrameLikeNode(node)) return true;
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

function isTranslationOnly(transform: Transform): boolean {
  return (
    transform[0] === 1 &&
    transform[1] === 0 &&
    transform[2] === 0 &&
    transform[3] === 1 &&
    Number.isFinite(transform[4]) &&
    Number.isFinite(transform[5])
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
