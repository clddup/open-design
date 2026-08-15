import type { Transform } from "@opendesign/design-contracts";
import type {
  LeaferElementSpec,
  LeaferSceneProjection,
} from "./projection-types.js";

export interface LeaferTextRunFragment {
  data: Record<string, unknown>;
  end: number;
  height: number;
  start: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface LeaferTextRunProjectionResult {
  fragments: readonly LeaferTextRunFragment[];
  nodeId: string;
}

export interface LeaferTextRunProjectionResolution {
  documentId: string;
  pageId: string;
  revision: number;
  resultsByNodeId: ReadonlyMap<string, LeaferTextRunProjectionResult>;
}

/**
 * Projects provider-derived rich-text fragments as native Leafer Text
 * siblings while retaining the original Text element as the authoritative
 * selection/edit proxy. Fragments are disposable projection state and map
 * every hit back to the original OpenDesign node id.
 */
export function projectResolvedTextRuns(
  base: LeaferSceneProjection,
  resolution: LeaferTextRunProjectionResolution,
): LeaferSceneProjection {
  if (base.documentId !== resolution.documentId) {
    throw new Error(
      `Text run projection for ${resolution.documentId} cannot project document ${base.documentId}`,
    );
  }
  if (base.pageId !== resolution.pageId) {
    throw new Error(
      `Text run projection for ${resolution.pageId} cannot project page ${base.pageId}`,
    );
  }
  if (base.revision !== resolution.revision) {
    throw new Error(
      `Text run projection revision ${resolution.revision} cannot project revision ${base.revision}`,
    );
  }
  const elementsById = new Map(base.elementsById);
  const rootIds = [...base.rootIds];
  const affectedNodeIds = base.affectedNodeIds
    ? new Set(base.affectedNodeIds)
    : undefined;

  for (const [nodeId, result] of resolution.resultsByNodeId) {
    if (result.nodeId !== nodeId) {
      throw new Error(
        `Text run projection result identity mismatch: ${nodeId}`,
      );
    }
    const source = elementsById.get(nodeId);
    if (!source || source.kind !== "text" || source.tag !== "Text") {
      throw new Error(`Text run projection source is unavailable: ${nodeId}`);
    }
    validateFragments(source, result.fragments);

    elementsById.set(nodeId, {
      ...source,
      data: {
        ...source.data,
        fill: "rgba(0, 0, 0, 0)",
        hitFill: "all",
        stroke: undefined,
        strokeWidth: 0,
        data: {
          ...metadata(source.data.data),
          opendesignTextEditProxy: true,
        },
      },
    });

    const fragmentIds = result.fragments.map((fragment, index) => {
      const id = textRunFragmentElementId(nodeId, index);
      const sourceName =
        typeof source.data.name === "string" ? source.data.name : nodeId;
      const spec: LeaferElementSpec = {
        childIds: [],
        data: {
          ...fragment.data,
          id,
          name: `${sourceName} segment ${index + 1}`,
          // Leafer 2.2.9's EditSelectHelper.findOne() skips falsy editable
          // leaves. "single" keeps the fragment in the pointer hit path but
          // out of box/multi selection; Adapter selection is then immediately
          // canonicalized to the authoritative proxy.
          editable: "single",
          hittable: true,
          opacity: source.data.opacity,
          text: fragment.text,
          visible: source.data.visible,
          width: fragment.width,
          height: fragment.height,
          data: {
            opendesignNodeId: nodeId,
            opendesignNodeKind: "text",
            opendesignProjectionId: id,
            opendesignSynthetic: true,
            opendesignTextRun: {
              start: fragment.start,
              end: fragment.end,
            },
          },
        },
        id,
        kind: "text",
        parentId: source.parentId,
        tag: "Text",
        transform: translateTransform(source.transform, fragment.x, fragment.y),
      };
      elementsById.set(id, spec);
      affectedNodeIds?.add(id);
      return id;
    });

    if (source.parentId === null) {
      insertAfter(rootIds, nodeId, fragmentIds);
    } else {
      const parent = elementsById.get(source.parentId);
      if (!parent) {
        throw new Error(
          `Text run projection parent is unavailable: ${source.parentId}`,
        );
      }
      elementsById.set(parent.id, {
        ...parent,
        childIds: insertAfterCopy(parent.childIds, nodeId, fragmentIds),
      });
      affectedNodeIds?.add(parent.id);
    }
    affectedNodeIds?.add(nodeId);
  }

  return {
    ...base,
    ...(affectedNodeIds === undefined ? {} : { affectedNodeIds }),
    elementsById,
    rootIds,
  };
}

/**
 * Reconciles an optional exact-revision Text run resolution against the
 * previous disposable scene so incremental sync also removes stale fragments
 * and restores the original Text/parent specs.
 */
export function projectTextRunProjection(
  base: LeaferSceneProjection,
  resolution: LeaferTextRunProjectionResolution | undefined,
  previous: LeaferSceneProjection | null,
): LeaferSceneProjection {
  const projection = resolution
    ? projectResolvedTextRuns(base, resolution)
    : base;
  if (!previous || projection.affectedNodeIds === undefined) {
    return projection;
  }
  const affectedNodeIds = new Set(projection.affectedNodeIds);
  const currentIds = new Set(projection.elementsById.keys());
  for (const previousSpec of previous.elementsById.values()) {
    const proxyId = textRunEditProxyElementId(previous, previousSpec.id);
    if (
      currentIds.has(previousSpec.id) ||
      proxyId === undefined ||
      previousSpec.id === proxyId
    ) {
      continue;
    }
    const nodeId = projectionNodeId(previous, previousSpec.id);
    affectedNodeIds.add(previousSpec.id);
    if (nodeId) affectedNodeIds.add(nodeId);
    if (previousSpec.parentId) affectedNodeIds.add(previousSpec.parentId);
  }
  return { ...projection, affectedNodeIds };
}

export function projectionNodeId(
  projection: LeaferSceneProjection,
  projectionId: string,
): string | undefined {
  const spec = projection.elementsById.get(projectionId);
  if (!spec) return undefined;
  const nodeId = metadata(spec.data.data).opendesignNodeId;
  return typeof nodeId === "string" ? nodeId : projectionId;
}

export function textRunProjectionNodeIds(
  resolution: LeaferTextRunProjectionResolution | undefined,
): string[] {
  return resolution ? [...resolution.resultsByNodeId.keys()] : [];
}

export function textRunFragmentElementId(
  nodeId: string,
  index: number,
): string {
  return `${nodeId}::text-run::${index}`;
}

/**
 * Resolves either an authoritative rich-text proxy or one of its disposable
 * fragments to the single Leafer element that may own selection and direct
 * editing. Ordinary Text projections intentionally return undefined.
 */
export function textRunEditProxyElementId(
  projection: LeaferSceneProjection,
  projectionId: string,
): string | undefined {
  const selected = projection.elementsById.get(projectionId);
  if (!selected || selected.kind !== "text") return undefined;
  const selectedMetadata = metadata(selected.data.data);
  const sourceId =
    typeof selectedMetadata.opendesignNodeId === "string"
      ? selectedMetadata.opendesignNodeId
      : selected.id;
  const source = projection.elementsById.get(sourceId);
  if (!source || source.kind !== "text") return undefined;
  return metadata(source.data.data).opendesignTextEditProxy === true
    ? source.id
    : undefined;
}

export function textRunFragmentElementIds(
  projection: LeaferSceneProjection,
  nodeId: string,
): string[] {
  return [...projection.elementsById.values()].flatMap((spec) => {
    const value = metadata(spec.data.data);
    return value.opendesignSynthetic === true &&
      value.opendesignNodeId === nodeId &&
      isTextRunRange(value.opendesignTextRun)
      ? [spec.id]
      : [];
  });
}

function validateFragments(
  source: LeaferElementSpec,
  fragments: readonly LeaferTextRunFragment[],
): void {
  if (fragments.length === 0) {
    throw new Error(`Text run projection is empty: ${source.id}`);
  }
  const sourceText =
    typeof source.data.text === "string" ? source.data.text : "";
  let expectedStart = 0;
  for (const fragment of fragments) {
    if (
      !Number.isSafeInteger(fragment.start) ||
      !Number.isSafeInteger(fragment.end) ||
      fragment.start !== expectedStart ||
      fragment.end <= fragment.start ||
      typeof fragment.text !== "string" ||
      fragment.text.length !== fragment.end - fragment.start ||
      fragment.text !== sourceText.slice(fragment.start, fragment.end) ||
      !finite(fragment.x) ||
      !finite(fragment.y) ||
      !finiteNonNegative(fragment.width) ||
      !finiteNonNegative(fragment.height)
    ) {
      throw new Error(
        `Text run projection fragments are invalid: ${source.id}`,
      );
    }
    expectedStart = fragment.end;
  }
  if (expectedStart !== sourceText.length) {
    throw new Error(
      `Text run projection does not cover source text: ${source.id}`,
    );
  }
}

function translateTransform(
  transform: Transform,
  x: number,
  y: number,
): Transform {
  const [a, b, c, d, e, f] = transform;
  return [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
}

function insertAfterCopy(
  values: readonly string[],
  target: string,
  inserted: readonly string[],
): string[] {
  const copy = [...values];
  insertAfter(copy, target, inserted);
  return copy;
}

function insertAfter(
  values: string[],
  target: string,
  inserted: readonly string[],
): void {
  const index = values.indexOf(target);
  if (index < 0)
    throw new Error(`Text run projection target is detached: ${target}`);
  values.splice(index + 1, 0, ...inserted);
}

function metadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isTextRunRange(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const range = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(range.start) &&
    Number.isSafeInteger(range.end) &&
    Number(range.end) > Number(range.start)
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
