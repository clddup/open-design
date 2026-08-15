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
  pageId: string;
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
  if (base.pageId !== resolution.pageId) {
    throw new Error(
      `Text run projection for ${resolution.pageId} cannot project page ${base.pageId}`,
    );
  }
  const elementsById = new Map(base.elementsById);
  const rootIds = [...base.rootIds];
  const affectedNodeIds = new Set(base.affectedNodeIds ?? []);

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
          editable: false,
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
      affectedNodeIds.add(id);
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
      affectedNodeIds.add(parent.id);
    }
    affectedNodeIds.add(nodeId);
  }

  return {
    ...base,
    affectedNodeIds,
    elementsById,
    rootIds,
  };
}

export function textRunFragmentElementId(
  nodeId: string,
  index: number,
): string {
  return `${nodeId}::text-run::${index}`;
}

function validateFragments(
  source: LeaferElementSpec,
  fragments: readonly LeaferTextRunFragment[],
): void {
  if (fragments.length === 0) {
    throw new Error(`Text run projection is empty: ${source.id}`);
  }
  let expectedStart = 0;
  for (const fragment of fragments) {
    if (
      !Number.isSafeInteger(fragment.start) ||
      !Number.isSafeInteger(fragment.end) ||
      fragment.start !== expectedStart ||
      fragment.end <= fragment.start ||
      typeof fragment.text !== "string" ||
      fragment.text.length !== fragment.end - fragment.start ||
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
  const sourceText =
    typeof source.data.text === "string" ? source.data.text : "";
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

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
