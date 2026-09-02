import {
  normalizeLineEndpoints,
  type DesignDocument,
  type DesignOperation,
  type Transform,
} from "@opendesign/design-contracts";
import type * as LeaferEditorModule from "leafer-editor";
import type { LeaferElementSpec, LeaferSceneProjection } from "./mapping.js";

type LeaferModule = typeof LeaferEditorModule;
type LeaferElement = InstanceType<LeaferModule["UI"]>;

const MATRIX_EPSILON = 0.000_001;

export interface DirectTransformElementState {
  linePoints?: readonly [number, number, number, number];
  size: { height: number; width: number };
  transform: Transform;
}

export function readDirectTransformElementState(
  element: LeaferElement,
): DirectTransformElementState {
  const matrix = element.localTransform;
  const tag = readTag(element);
  const textBounds =
    tag === "Text" ? element.getBounds("box", "inner") : undefined;
  const linePoints =
    tag === "Arrow" || tag === "Line" ? readLinePoints(element) : undefined;
  return {
    transform: normalizeTransform([
      matrix.a,
      matrix.b,
      matrix.c,
      matrix.d,
      matrix.e,
      matrix.f,
    ]),
    size: {
      width: normalizeNumber(
        element.width === undefined
          ? (textBounds?.width ?? 0)
          : Number(element.width) || 0,
      ),
      height: normalizeNumber(
        element.height === undefined
          ? (textBounds?.height ?? 0)
          : Number(element.height) || 0,
      ),
    },
    ...(linePoints ? { linePoints } : undefined),
  };
}

export function directTransformElementBounds(
  state: DirectTransformElementState,
): { x: number; y: number; width: number; height: number } {
  const localPoints = state.linePoints
    ? [
        { x: state.linePoints[0], y: state.linePoints[1] },
        { x: state.linePoints[2], y: state.linePoints[3] },
      ]
    : [
        { x: 0, y: 0 },
        { x: state.size.width, y: 0 },
        { x: state.size.width, y: state.size.height },
        { x: 0, y: state.size.height },
      ];
  const [a, b, c, d, e, f] = state.transform;
  const points = localPoints.map(({ x, y }) => ({
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  }));
  const left = Math.min(...points.map(({ x }) => x));
  const top = Math.min(...points.map(({ y }) => y));
  const right = Math.max(...points.map(({ x }) => x));
  const bottom = Math.max(...points.map(({ y }) => y));
  return {
    x: normalizeNumber(left),
    y: normalizeNumber(top),
    width: normalizeNumber(right - left),
    height: normalizeNumber(bottom - top),
  };
}

export function directTransformElementCenter(element: LeaferElement): {
  x: number;
  y: number;
} {
  const bounds = directTransformElementBounds(
    readDirectTransformElementState(element),
  );
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

export function createDirectTransformOperations(input: {
  before: ReadonlyMap<string, DirectTransformElementState>;
  document: DesignDocument;
  element: (nodeId: string) => LeaferElement | undefined;
  projection: LeaferSceneProjection | null;
}): DesignOperation[] {
  const operations: DesignOperation[] = [];
  for (const [nodeId, previous] of input.before) {
    const node = input.document.nodesById[nodeId];
    const element = input.element(nodeId);
    const spec = input.projection?.elementsById.get(nodeId);
    if (!node || !element || isLockedSpec(spec)) continue;
    const next = readDirectTransformElementState(element);
    const linePointsChanged =
      node.kind === "line" &&
      previous.linePoints !== undefined &&
      next.linePoints !== undefined &&
      !sameNumberList(previous.linePoints, next.linePoints);
    let nextTransform = next.transform;
    let nextSize = node.kind === "line" ? node.size : next.size;
    let lineProperties:
      | { end: { x: number; y: number }; start: { x: number; y: number } }
      | undefined;
    if (linePointsChanged && next.linePoints) {
      const geometry = normalizeLineEndpoints(
        { x: next.linePoints[0], y: next.linePoints[1] },
        { x: next.linePoints[2], y: next.linePoints[3] },
      );
      nextTransform = translateLocalTransform(
        next.transform,
        geometry.bounds.x,
        geometry.bounds.y,
      );
      nextSize = {
        width: geometry.bounds.width,
        height: geometry.bounds.height,
      };
      lineProperties = { start: geometry.start, end: geometry.end };
    }
    const transformChanged = !sameTransform(node.transform, nextTransform);
    const sizeChanged =
      node.kind !== "group" &&
      node.kind !== "boolean" &&
      node.kind !== "instance" &&
      (!nearlyEqual(node.size.width, nextSize.width) ||
        !nearlyEqual(node.size.height, nextSize.height));
    if (!transformChanged && !sizeChanged && !lineProperties) continue;
    operations.push({
      commandId: `leafer_transform_${nodeId}`,
      type: "update_properties",
      nodeId,
      ...(transformChanged ? { transform: nextTransform } : undefined),
      ...(sizeChanged ? { size: nextSize } : undefined),
      ...(lineProperties ? { properties: lineProperties } : undefined),
    });
  }
  return operations;
}

function isLockedSpec(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function readLinePoints(
  element: LeaferElement,
): readonly [number, number, number, number] | undefined {
  const points = (element as LeaferElement & { points?: unknown }).points;
  if (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.slice(0, 4).every((value) => typeof value === "number")
  ) {
    return points.slice(0, 4).map(normalizeNumber) as [
      number,
      number,
      number,
      number,
    ];
  }
  if (
    Array.isArray(points) &&
    points.length >= 2 &&
    points[0] &&
    points[1] &&
    typeof points[0] === "object" &&
    typeof points[1] === "object"
  ) {
    const start = points[0] as { x?: unknown; y?: unknown };
    const end = points[1] as { x?: unknown; y?: unknown };
    if (
      typeof start.x === "number" &&
      typeof start.y === "number" &&
      typeof end.x === "number" &&
      typeof end.y === "number"
    ) {
      return [start.x, start.y, end.x, end.y].map(normalizeNumber) as [
        number,
        number,
        number,
        number,
      ];
    }
  }
  return undefined;
}

function readTag(element: LeaferElement): string {
  return (element as LeaferElement & { tag?: string }).tag ?? "";
}

function normalizeNumber(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeTransform(transform: Transform): Transform {
  return transform.map(normalizeNumber) as Transform;
}

function nearlyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= MATRIX_EPSILON;
}

function sameNumberList(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => nearlyEqual(value, right[index] ?? 0))
  );
}

function sameTransform(left: Transform, right: Transform): boolean {
  return left.every((value, index) => nearlyEqual(value, right[index] ?? 0));
}

function translateLocalTransform(
  transform: Transform,
  localX: number,
  localY: number,
): Transform {
  return normalizeTransform([
    transform[0],
    transform[1],
    transform[2],
    transform[3],
    transform[4] + transform[0] * localX + transform[2] * localY,
    transform[5] + transform[1] * localX + transform[3] * localY,
  ]);
}
