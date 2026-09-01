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
  | { kind: "page" }
  | { kind: "node"; nodeId: string }
  | {
      kind: "selection";
      nodeIds: readonly string[];
      neutralizeRootNodeId?: string;
    };

/**
 * Builds an isolated export tree when a selection must be detached or when a
 * target contains disposable rich-text fragments. The clone reads exact
 * projection specs rather than mutable Leafer elements, so TextEditor,
 * selection chrome, reveal and tween presentation cannot alter export pixels.
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
  if (
    request.kind !== "selection" &&
    !containsTextRunFragment(projection, included)
  ) {
    return null;
  }

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
    const root =
      request.kind === "selection"
        ? cloneSelectionRoot(projection, rootId, included, factory, request)
        : cloneSubtree(projection, rootId, included, factory, false);
    const spec = projection.elementsById.get(rootId)!;
    const transform = textSource
      ? relativeTextRootTransform(textSource, spec)
      : spec.transform;
    factory.setTransform(root, transform);
    factory.addAt(wrapper, root, index);
  });
  return wrapper;
}

function cloneSelectionRoot<Element extends ProjectionExportElement>(
  projection: LeaferSceneProjection,
  rootId: string,
  included: ReadonlySet<string>,
  factory: ProjectionExportFactory<Element>,
  request: Extract<ProjectionExportRequest, { kind: "selection" }>,
): Element {
  const fragments = textRunFragmentElementIds(projection, rootId);
  if (fragments.length === 0) {
    return cloneSubtree(
      projection,
      rootId,
      included,
      factory,
      false,
      request.neutralizeRootNodeId,
    );
  }
  const source = projection.elementsById.get(rootId);
  if (!source) {
    throw new Error(`Projection export layer is unavailable: ${rootId}`);
  }
  const wrapper = factory.createWrapper();
  factory.applyData(
    wrapper,
    richTextCompoundSpec(source, request.neutralizeRootNodeId === rootId),
  );
  [rootId, ...fragments].forEach((nodeId, index) => {
    const spec = projection.elementsById.get(nodeId);
    if (!spec) {
      throw new Error(`Projection export layer is unavailable: ${nodeId}`);
    }
    const child = cloneSubtree(
      projection,
      nodeId,
      new Set([nodeId]),
      factory,
      false,
      rootId,
    );
    factory.setTransform(child, relativeTextRootTransform(source, spec));
    factory.addAt(wrapper, child, index);
  });
  return wrapper;
}

function cloneSubtree<Element extends ProjectionExportElement>(
  projection: LeaferSceneProjection,
  nodeId: string,
  included: ReadonlySet<string>,
  factory: ProjectionExportFactory<Element>,
  normalizeRoot: boolean,
  neutralizeRootNodeId?: string,
): Element {
  const spec = projection.elementsById.get(nodeId);
  if (!spec)
    throw new Error(`Projection export layer is unavailable: ${nodeId}`);
  const element = factory.create(spec.tag);
  factory.applyData(
    element,
    shouldNeutralizeAppearance(spec, neutralizeRootNodeId)
      ? neutralizedAppearanceSpec(spec)
      : spec,
  );
  factory.setTransform(
    element,
    normalizeRoot ? IDENTITY_TRANSFORM : spec.transform,
  );
  spec.childIds
    .filter((childId) => included.has(childId))
    .forEach((childId, index) => {
      factory.addAt(
        element,
        cloneSubtree(
          projection,
          childId,
          included,
          factory,
          false,
          neutralizeRootNodeId,
        ),
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
  if (request.kind === "selection") {
    if (request.nodeIds.length === 0) {
      throw new Error("Projection export selection cannot be empty");
    }
    for (const nodeId of request.nodeIds) {
      if (!projection.elementsById.has(nodeId)) {
        throw new Error(`Projection export layer is unavailable: ${nodeId}`);
      }
    }
    return [...request.nodeIds];
  }
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

function shouldNeutralizeAppearance(
  spec: LeaferElementSpec,
  rootNodeId: string | undefined,
): boolean {
  if (!rootNodeId) return false;
  if (spec.id === rootNodeId) return true;
  const metadata = spec.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignSynthetic === true &&
    (metadata as Record<string, unknown>).opendesignNodeId === rootNodeId
  );
}

function richTextCompoundSpec(
  source: LeaferElementSpec,
  neutralize: boolean,
): LeaferElementSpec {
  const id = `__opendesign_export_text_compound__:${source.id}`;
  const sourceName =
    typeof source.data.name === "string" ? source.data.name : source.id;
  const spec: LeaferElementSpec = {
    childIds: [],
    data: {
      backgroundBlur: source.data.backgroundBlur,
      blendMode: source.data.blendMode,
      blur: source.data.blur,
      data: {
        opendesignNodeId: source.id,
        opendesignProjectionId: id,
        opendesignSynthetic: true,
      },
      editable: false,
      grayscale: source.data.grayscale,
      hittable: false,
      id,
      innerShadow: source.data.innerShadow,
      mask: source.data.mask,
      name: `${sourceName} export compound`,
      opacity: source.data.opacity,
      shadow: source.data.shadow,
      visible: source.data.visible,
    },
    id,
    kind: "group",
    parentId: source.parentId,
    tag: "Group",
    transform: IDENTITY_TRANSFORM,
  };
  return neutralize ? neutralizedAppearanceSpec(spec) : spec;
}

function neutralizedAppearanceSpec(spec: LeaferElementSpec): LeaferElementSpec {
  return {
    ...spec,
    data: {
      ...spec.data,
      backgroundBlur: 0,
      blendMode: "pass-through",
      blur: 0,
      grayscale: 0,
      innerShadow: null,
      mask: false,
      opacity: 1,
      shadow: null,
    },
  };
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
