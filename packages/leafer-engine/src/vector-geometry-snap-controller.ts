import type {
  Point,
  Transform,
  VectorNetwork,
  ViewportState,
} from "@opendesign/design-contracts";
import {
  createVectorSnapTargetIndex,
  resolveVectorPointSnapping,
  type VectorSnapPoint,
  type VectorSnapTargetIndex,
} from "@opendesign/geometry-service/vector-snapping";
import {
  listVectorVertexHandles,
  type VectorHandleReference,
} from "@opendesign/geometry-service/vector-edit";
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
    const movingPoints = documentVertexPoints(input.layers, movingKeys, true);
    const targetPoints = input.settings.geometry
      ? documentVertexPoints(input.layers, movingKeys, false)
      : [];
    this.#start({
      movingPoints,
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
    const targetPoints = input.settings.geometry
      ? [
          ...documentVertexPoints(input.layers, new Set(), false),
          ...documentHandlePoints(input.layers, excluded),
        ]
      : [];
    this.#start({
      movingPoints: [{ id: movingId, ...input.moving.position }],
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
    pixelGrid: boolean;
    targetPoints: readonly VectorSnapPoint[];
    threshold: number;
  }): void {
    this.#session = {
      movingPoints: input.movingPoints,
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
): VectorSnapPoint[] {
  return layers.flatMap((layer) =>
    layer.network.vertices.flatMap((vertex) => {
      const id = pointId(layer.nodeId, vertex.id);
      if (movingKeys.has(id) !== moving) return [];
      return [
        {
          id,
          ...transformPoint(vertex, layer.worldTransform),
        },
      ];
    }),
  );
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

function snapThreshold(viewport: ViewportState): number {
  return 5 / Math.max(Math.abs(viewport.zoom), 0.000_001);
}
