import type {
  Point,
  Transform,
  VectorNetwork,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  createVectorSnapPathTarget,
  createVectorSnapTargetIndex,
  resolveVectorPointSnapping,
  type VectorSnapPathTarget,
  type VectorSnapPoint,
  type VectorSnapTargetIndex,
} from "@opendesign/geometry-service/vector-snapping";
import {
  listVectorVertexHandles,
  type VectorHandleReference,
} from "@opendesign/geometry-service/vector-edit";
import {
  directedVectorCurve,
  type DirectedVectorCurve,
} from "@opendesign/geometry-service/vector-segment-geometry";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import { transformPoint } from "./scene-node-transform.js";
import type { LeaferSnapSettings } from "./types.js";

export interface VectorSnapLayer {
  network: VectorNetwork;
  nodeId: string;
  visibleHandleVertexIds: readonly string[];
  worldTransform: Transform;
}

export interface VectorSnapSelection {
  nodeId: string;
  vertexIds: readonly string[];
}

export interface VectorSnapHandleSelection {
  nodeId: string;
  position: Point;
  reference: VectorHandleReference;
}

interface VectorGeometrySnapSession {
  movingPoints: readonly VectorSnapPoint[];
  paths: readonly VectorSnapPathTarget[];
  pixelGrid: boolean;
  targets: VectorSnapTargetIndex;
  threshold: number;
}

export class VectorGeometrySnapController {
  readonly #onLines: (lines: readonly SnapGuideLine[]) => void;
  #session: VectorGeometrySnapSession | null = null;

  constructor(options: { onLines: (lines: readonly SnapGuideLine[]) => void }) {
    this.#onLines = options.onLines;
  }

  begin(input: {
    layers: readonly VectorSnapLayer[];
    moving: readonly VectorSnapSelection[];
    settings: LeaferSnapSettings;
    viewport: ViewportState;
  }): void {
    const movingKeys = selectionKeys(input.moving);
    const excludedPaths = incidentPathTargetIds(input.layers, movingKeys);
    const movingPoints = documentVertexPoints(
      input.layers,
      movingKeys,
      true,
      excludedPaths,
    );
    const targetPoints = input.settings.geometry
      ? documentVertexPoints(input.layers, movingKeys, false)
      : [];
    this.#start({
      movingPoints,
      paths: input.settings.geometry ? documentPathTargets(input.layers) : [],
      pixelGrid: input.settings.pixelGrid,
      targetPoints,
      threshold: snapThreshold(input.viewport),
    });
  }

  beginHandle(input: {
    layers: readonly VectorSnapLayer[];
    moving: VectorSnapHandleSelection;
    settings: LeaferSnapSettings;
    viewport: ViewportState;
  }): void {
    const movingId = handleId(input.moving.nodeId, input.moving.reference);
    const excluded = new Set([movingId]);
    const excludedPaths = segmentPathTargetIds(
      input.layers,
      input.moving.nodeId,
      input.moving.reference.segmentId,
    );
    const targetPoints = input.settings.geometry
      ? [
          ...documentVertexPoints(input.layers, new Set(), false),
          ...documentHandlePoints(input.layers, excluded),
        ]
      : [];
    this.#start({
      movingPoints: [
        {
          excludedPathTargetIds: excludedPaths,
          id: movingId,
          ...input.moving.position,
        },
      ],
      paths: input.settings.geometry ? documentPathTargets(input.layers) : [],
      pixelGrid: input.settings.pixelGrid,
      targetPoints,
      threshold: snapThreshold(input.viewport),
    });
  }

  update(rawDelta: Point, suppressed: boolean): Point {
    const session = this.#session;
    if (!session || session.movingPoints.length === 0 || suppressed) {
      this.#onLines([]);
      return rawDelta;
    }
    const resolution = resolveVectorPointSnapping({
      movingPoints: session.movingPoints,
      paths: session.paths,
      pixelGrid: session.pixelGrid,
      rawDelta,
      targets: session.targets,
      threshold: session.threshold,
    });
    this.#onLines(resolution.lines);
    return resolution.delta;
  }

  syncViewport(viewport: ViewportState): void {
    if (this.#session) this.#session.threshold = snapThreshold(viewport);
  }

  finish(): void {
    this.#session = null;
    this.#onLines([]);
  }

  #start(input: {
    movingPoints: readonly VectorSnapPoint[];
    paths: readonly VectorSnapPathTarget[];
    pixelGrid: boolean;
    targetPoints: readonly VectorSnapPoint[];
    threshold: number;
  }): void {
    this.#session = {
      movingPoints: input.movingPoints,
      paths: input.paths,
      pixelGrid: input.pixelGrid,
      targets: createVectorSnapTargetIndex(input.targetPoints),
      threshold: input.threshold,
    };
    this.#onLines([]);
  }
}

function documentVertexPoints(
  layers: readonly VectorSnapLayer[],
  movingKeys: ReadonlySet<string>,
  moving: boolean,
  excludedPathTargetIds: readonly string[] = [],
): VectorSnapPoint[] {
  return layers.flatMap((layer) =>
    layer.network.vertices.flatMap((vertex) => {
      const id = pointId(layer.nodeId, vertex.id);
      if (movingKeys.has(id) !== moving) return [];
      return [
        {
          ...(moving && excludedPathTargetIds.length > 0
            ? { excludedPathTargetIds }
            : {}),
          id,
          ...transformPoint(vertex, layer.worldTransform),
        },
      ];
    }),
  );
}

function documentPathTargets(
  layers: readonly VectorSnapLayer[],
): VectorSnapPathTarget[] {
  return layers.flatMap((layer) => {
    const vertices = new Map(
      layer.network.vertices.map((vertex) => [vertex.id, vertex]),
    );
    const segments = new Map(
      layer.network.segments.map((segment) => [segment.id, segment]),
    );
    return layer.network.paths.flatMap((path) =>
      path.segments.flatMap((reference, index) => {
        const segment = segments.get(reference.segmentId);
        if (!segment) return [];
        const curve = documentCurve(
          directedVectorCurve(segment, reference, vertices),
          layer.worldTransform,
        );
        return [
          createVectorSnapPathTarget(
            pathTargetId(layer.nodeId, path.id, index, segment.id),
            curve,
          ),
        ];
      }),
    );
  });
}

function documentCurve(
  curve: DirectedVectorCurve,
  worldTransform: Transform,
): DirectedVectorCurve {
  const start = transformPoint(curve.start, worldTransform);
  const end = transformPoint(curve.end, worldTransform);
  return {
    end,
    endVertexId: curve.endVertexId,
    start,
    startVertexId: curve.startVertexId,
    ...(curve.tangentStart
      ? {
          tangentStart: subtract(
            transformPoint(
              add(curve.start, curve.tangentStart),
              worldTransform,
            ),
            start,
          ),
        }
      : {}),
    ...(curve.tangentEnd
      ? {
          tangentEnd: subtract(
            transformPoint(add(curve.end, curve.tangentEnd), worldTransform),
            end,
          ),
        }
      : {}),
  };
}

function incidentPathTargetIds(
  layers: readonly VectorSnapLayer[],
  movingKeys: ReadonlySet<string>,
): string[] {
  return layers.flatMap((layer) => {
    const segments = new Map(
      layer.network.segments.map((segment) => [segment.id, segment]),
    );
    return layer.network.paths.flatMap((path) =>
      path.segments.flatMap((reference, index) => {
        const segment = segments.get(reference.segmentId);
        return segment &&
          [segment.startVertexId, segment.endVertexId].some((vertexId) =>
            movingKeys.has(pointId(layer.nodeId, vertexId)),
          )
          ? [pathTargetId(layer.nodeId, path.id, index, segment.id)]
          : [];
      }),
    );
  });
}

function segmentPathTargetIds(
  layers: readonly VectorSnapLayer[],
  nodeId: string,
  segmentId: string,
): string[] {
  const layer = layers.find((candidate) => candidate.nodeId === nodeId);
  return layer
    ? layer.network.paths.flatMap((path) =>
        path.segments.flatMap((reference, index) =>
          reference.segmentId === segmentId
            ? [pathTargetId(nodeId, path.id, index, segmentId)]
            : [],
        ),
      )
    : [];
}

function documentHandlePoints(
  layers: readonly VectorSnapLayer[],
  excludedKeys: ReadonlySet<string>,
): VectorSnapPoint[] {
  return layers.flatMap((layer) =>
    layer.visibleHandleVertexIds.flatMap((vertexId) =>
      listVectorVertexHandles(layer.network, vertexId).flatMap((handle) => {
        const id = handleId(layer.nodeId, handle);
        return excludedKeys.has(id)
          ? []
          : [
              {
                id,
                ...transformPoint(handle.position, layer.worldTransform),
              },
            ];
      }),
    ),
  );
}

function selectionKeys(
  selections: readonly VectorSnapSelection[],
): ReadonlySet<string> {
  return new Set(
    selections.flatMap(({ nodeId, vertexIds }) =>
      vertexIds.map((vertexId) => pointId(nodeId, vertexId)),
    ),
  );
}

function pointId(nodeId: string, vertexId: string): string {
  return `${nodeId}:${vertexId}`;
}

function handleId(nodeId: string, reference: VectorHandleReference): string {
  return `${nodeId}:handle:${reference.segmentId}:${reference.side}`;
}

function pathTargetId(
  nodeId: string,
  pathId: string,
  index: number,
  segmentId: string,
): string {
  return `${nodeId}:path:${pathId}:${index}:${segmentId}`;
}

function snapThreshold(viewport: ViewportState): number {
  return 5 / Math.max(Math.abs(viewport.zoom), 0.000_001);
}

function add(left: Point, right: Point): Point {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Point, right: Point): Point {
  return { x: left.x - right.x, y: left.y - right.y };
}
