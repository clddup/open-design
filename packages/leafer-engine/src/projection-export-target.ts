import type { Transform } from "@opendesign/design-contracts";
import {
  matrixRelativeToParent,
  transformToAffine,
  type AffineMatrix,
} from "./affine.js";
import type {
  LeaferElementSpec,
  LeaferElementTag,
  LeaferSceneProjection,
} from "./projection-types.js";
import { textRunFragmentElementIds } from "./text-run-projection.js";

const MATRIX_EPSILON = 0.000_001;
const IDENTITY_TRANSFORM: Transform = [1, 0, 0, 1, 0, 0];

export interface ProjectionExportElement {
  destroy(): void;
  remove(): void;
}

export interface ProjectionExportFactory<
  Element extends ProjectionExportElement,
> {
  addAt(parent: Element, child: Element, index: number): void;
  applyData(element: Element, spec: LeaferElementSpec): void;
  create(tag: LeaferElementTag): Element;
  createWrapper(): Element;
  setTransform(element: Element, transform: Transform): void;
}

export interface ProjectionExportTarget<Element> {
  dispose(): void;
  element: Element;
}

export type ProjectionExportRequest =
  { kind: "page" } | { kind: "node"; nodeId: string };

/**
 * Rebuilds only targets that contain disposable rich-text fragments. The
 * clone reads exact projection specs rather than mutable Leafer elements, so
 * TextEditor, selection chrome, reveal and tween presentation cannot alter
 * capture or delivery pixels.
 */
export function createProjectionExportTarget<
  Element extends ProjectionExportElement,
>(
  projection: LeaferSceneProjection,
  request: ProjectionExportRequest,
  factory: ProjectionExportFactory<Element>,
): ProjectionExportTarget<Element> | null {
  const roots = exportRootIds(projection, request);
  const included = collectSubtreeIds(projection, roots);
  if (!containsTextRunFragment(projection, included)) return null;

  const root =
    request.kind === "node" && roots.length === 1
      ? cloneSubtree(projection, roots[0]!, included, factory, true)
      : cloneWrapper(projection, request, roots, included, factory);
  let disposed = false;
  return {
    element: root,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      root.remove();
      root.destroy();
    },
  };
}

function cloneWrapper<Element extends ProjectionExportElement>(
  projection: LeaferSceneProjection,
  request: ProjectionExportRequest,
  roots: readonly string[],
  included: ReadonlySet<string>,
  factory: ProjectionExportFactory<Element>,
): Element {
  const wrapper = factory.createWrapper();
  const textSource =
    request.kind === "node"
      ? projection.elementsById.get(request.nodeId)
      : undefined;
  roots.forEach((rootId, index) => {
    const root = cloneSubtree(projection, rootId, included, factory, false);
    const spec = projection.elementsById.get(rootId)!;
    const transform = textSource
      ? relativeTextRootTransform(textSource, spec)
      : spec.transform;
    factory.setTransform(root, transform);
    factory.addAt(wrapper, root, index);
  });
  return wrapper;
}

function cloneSubtree<Element extends ProjectionExportElement>(
  projection: LeaferSceneProjection,
  nodeId: string,
  included: ReadonlySet<string>,
  factory: ProjectionExportFactory<Element>,
  normalizeRoot: boolean,
): Element {
  const spec = projection.elementsById.get(nodeId);
  if (!spec)
    throw new Error(`Projection export layer is unavailable: ${nodeId}`);
  const element = factory.create(spec.tag);
  factory.applyData(element, spec);
  factory.setTransform(
    element,
    normalizeRoot ? IDENTITY_TRANSFORM : spec.transform,
  );
  spec.childIds
    .filter((childId) => included.has(childId))
    .forEach((childId, index) => {
      factory.addAt(
        element,
        cloneSubtree(projection, childId, included, factory, false),
        index,
      );
    });
  return element;
}

function exportRootIds(
  projection: LeaferSceneProjection,
  request: ProjectionExportRequest,
): string[] {
  if (request.kind === "page") return [...projection.rootIds];
  const source = projection.elementsById.get(request.nodeId);
  if (!source) {
    throw new Error(
      `Projection export layer is unavailable: ${request.nodeId}`,
    );
  }
  const fragments = textRunFragmentElementIds(projection, request.nodeId);
  return fragments.length > 0
    ? [request.nodeId, ...fragments]
    : [request.nodeId];
}

function collectSubtreeIds(
  projection: LeaferSceneProjection,
  rootIds: readonly string[],
): Set<string> {
  const result = new Set<string>();
  const visit = (nodeId: string) => {
    if (result.has(nodeId)) return;
    const spec = projection.elementsById.get(nodeId);
    if (!spec)
      throw new Error(`Projection export layer is unavailable: ${nodeId}`);
    result.add(nodeId);
    spec.childIds.forEach(visit);
  };
  rootIds.forEach(visit);
  return result;
}

function containsTextRunFragment(
  projection: LeaferSceneProjection,
  nodeIds: ReadonlySet<string>,
): boolean {
  for (const nodeId of nodeIds) {
    const metadata = projection.elementsById.get(nodeId)?.data.data;
    if (
      typeof metadata === "object" &&
      metadata !== null &&
      (metadata as Record<string, unknown>).opendesignSynthetic === true &&
      typeof (metadata as Record<string, unknown>).opendesignTextRun ===
        "object"
    ) {
      return true;
    }
  }
  return false;
}

function relativeTextRootTransform(
  source: LeaferElementSpec,
  target: LeaferElementSpec,
): Transform {
  if (source.id === target.id) return IDENTITY_TRANSFORM;
  const relative = matrixRelativeToParent(
    transformToAffine(source.transform),
    transformToAffine(target.transform),
    MATRIX_EPSILON,
  );
  if (!relative) {
    throw new Error(
      `Text run export source transform is not invertible: ${source.id}`,
    );
  }
  return affineToTransform(relative);
}

function affineToTransform(matrix: AffineMatrix): Transform {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
}
