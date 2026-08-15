import type { Transform } from "@opendesign/design-contracts";
import type {
  LeaferElementSpec,
  LeaferSceneProjection,
} from "./projection-types.js";

export interface LeaferTextRunFragment {
  baseline?: number;
  data: Record<string, unknown>;
  end: number;
  glyphs?: readonly LeaferTextRunGlyph[];
  height: number;
  start: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface LeaferTextRunGlyph {
  clusterEnd: number;
  clusterStart: number;
  glyphId: number;
  path: string;
  x: number;
  xAdvance: number;
  y: number;
  yAdvance: number;
}

export interface LeaferTextRunMarker {
  baseline: number;
  data: Record<string, unknown>;
  direction: "ltr" | "rtl";
  glyphs?: readonly LeaferTextRunGlyph[];
  height: number;
  paragraphStart: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface LeaferTextRunProjectionResult {
  fragments: readonly LeaferTextRunFragment[];
  markers?: readonly LeaferTextRunMarker[];
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
    validateMarkers(source, result.markers ?? []);

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

    const fragmentIds: string[] = [];
    let projectionIndex = 0;
    result.fragments.forEach((fragment, fragmentIndex) => {
      const sourceName =
        typeof source.data.name === "string" ? source.data.name : nodeId;
      if (fragment.glyphs !== undefined) {
        fragment.glyphs.forEach((glyph, glyphIndex) => {
          const id = textRunFragmentElementId(nodeId, projectionIndex++);
          const spec: LeaferElementSpec = {
            childIds: [],
            data: {
              fill: fragment.data.fill,
              id,
              name: `${sourceName} glyph ${glyphIndex + 1}`,
              editable: "single",
              hittable: glyph.path.length > 0,
              opacity: source.data.opacity,
              path: glyph.path || null,
              visible: source.data.visible,
              data: {
                opendesignGlyphId: glyph.glyphId,
                opendesignNodeId: nodeId,
                opendesignNodeKind: "text",
                opendesignProjectionId: id,
                opendesignSynthetic: true,
                opendesignTextRun: {
                  start: glyph.clusterStart,
                  end: glyph.clusterEnd,
                },
              },
            },
            id,
            kind: "path",
            parentId: source.parentId,
            tag: "Path",
            transform: composeTransform(source.transform, [
              1,
              0,
              0,
              -1,
              fragment.x + glyph.x,
              fragment.y + (fragment.baseline ?? 0) - glyph.y,
            ]),
          };
          elementsById.set(id, spec);
          affectedNodeIds?.add(id);
          fragmentIds.push(id);
        });
        return;
      }
      const id = textRunFragmentElementId(nodeId, projectionIndex++);
      const spec: LeaferElementSpec = {
        childIds: [],
        data: {
          ...fragment.data,
          id,
          name: `${sourceName} segment ${fragmentIndex + 1}`,
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
      fragmentIds.push(id);
    });
    (result.markers ?? []).forEach((marker, markerIndex) => {
      const sourceName =
        typeof source.data.name === "string" ? source.data.name : nodeId;
      if (marker.glyphs !== undefined) {
        marker.glyphs.forEach((glyph, glyphIndex) => {
          const id = textRunFragmentElementId(nodeId, projectionIndex++);
          const spec: LeaferElementSpec = {
            childIds: [],
            data: {
              fill: marker.data.fill,
              id,
              name: `${sourceName} marker ${markerIndex + 1} glyph ${glyphIndex + 1}`,
              editable: "single",
              hittable: glyph.path.length > 0,
              opacity: source.data.opacity,
              path: glyph.path || null,
              visible: source.data.visible,
              data: {
                opendesignGlyphId: glyph.glyphId,
                opendesignNodeId: nodeId,
                opendesignNodeKind: "text",
                opendesignProjectionId: id,
                opendesignSynthetic: true,
                opendesignTextMarker: {
                  paragraphStart: marker.paragraphStart,
                  text: marker.text,
                },
              },
            },
            id,
            kind: "path",
            parentId: source.parentId,
            tag: "Path",
            transform: composeTransform(source.transform, [
              1,
              0,
              0,
              -1,
              marker.x + glyph.x,
              marker.y + marker.baseline - glyph.y,
            ]),
          };
          elementsById.set(id, spec);
          affectedNodeIds?.add(id);
          fragmentIds.push(id);
        });
        return;
      }
      const id = textRunFragmentElementId(nodeId, projectionIndex++);
      const spec: LeaferElementSpec = {
        childIds: [],
        data: {
          ...marker.data,
          id,
          name: `${sourceName} marker ${markerIndex + 1}`,
          editable: "single",
          hittable: true,
          opacity: source.data.opacity,
          text: marker.text,
          visible: source.data.visible,
          width: marker.width,
          height: marker.height,
          data: {
            opendesignNodeId: nodeId,
            opendesignNodeKind: "text",
            opendesignProjectionId: id,
            opendesignSynthetic: true,
            opendesignTextMarker: {
              paragraphStart: marker.paragraphStart,
              text: marker.text,
            },
          },
        },
        id,
        kind: "text",
        parentId: source.parentId,
        tag: "Text",
        transform: translateTransform(source.transform, marker.x, marker.y),
      };
      elementsById.set(id, spec);
      affectedNodeIds?.add(id);
      fragmentIds.push(id);
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
  if (!selected) return undefined;
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
      (isTextRunRange(value.opendesignTextRun) ||
        isTextMarker(value.opendesignTextMarker))
      ? [spec.id]
      : [];
  });
}

function validateMarkers(
  source: LeaferElementSpec,
  markers: readonly LeaferTextRunMarker[],
): void {
  const sourceText =
    typeof source.data.text === "string" ? source.data.text : "";
  let previousStart = -1;
  for (const marker of markers) {
    if (
      !Number.isSafeInteger(marker.paragraphStart) ||
      marker.paragraphStart <= previousStart ||
      marker.paragraphStart < 0 ||
      marker.paragraphStart >= sourceText.length ||
      typeof marker.text !== "string" ||
      marker.text.length === 0 ||
      (marker.direction !== "ltr" && marker.direction !== "rtl") ||
      !finite(marker.x) ||
      !finite(marker.y) ||
      !finiteNonNegative(marker.width) ||
      !finiteNonNegative(marker.height) ||
      !finiteNonNegative(marker.baseline) ||
      marker.baseline > marker.height
    ) {
      throw new Error(`Text run projection markers are invalid: ${source.id}`);
    }
    if (marker.glyphs !== undefined) {
      validateMarkerGlyphs(source.id, marker);
    }
    previousStart = marker.paragraphStart;
  }
}

function validateMarkerGlyphs(
  sourceId: string,
  marker: LeaferTextRunMarker,
): void {
  if (!Array.isArray(marker.glyphs)) {
    throw new Error(
      `Text run projection marker glyphs are invalid: ${sourceId}`,
    );
  }
  const ranges = new Map<number, number>();
  for (const glyph of marker.glyphs) {
    if (
      !Number.isSafeInteger(glyph.glyphId) ||
      glyph.glyphId < 0 ||
      !Number.isSafeInteger(glyph.clusterStart) ||
      !Number.isSafeInteger(glyph.clusterEnd) ||
      glyph.clusterStart < 0 ||
      glyph.clusterEnd > marker.text.length ||
      glyph.clusterEnd <= glyph.clusterStart ||
      typeof glyph.path !== "string" ||
      !finite(glyph.x) ||
      !finite(glyph.y) ||
      !finite(glyph.xAdvance) ||
      !finite(glyph.yAdvance)
    ) {
      throw new Error(
        `Text run projection marker glyphs are invalid: ${sourceId}`,
      );
    }
    const end = ranges.get(glyph.clusterStart);
    if (end !== undefined && end !== glyph.clusterEnd) {
      throw new Error(
        `Text run projection marker glyphs are ambiguous: ${sourceId}`,
      );
    }
    ranges.set(glyph.clusterStart, glyph.clusterEnd);
  }
  let expectedStart = 0;
  for (const [start, end] of [...ranges].sort(
    (left, right) => left[0] - right[0],
  )) {
    if (start !== expectedStart) {
      throw new Error(
        `Text run projection marker glyphs do not cover text: ${sourceId}`,
      );
    }
    expectedStart = end;
  }
  if (expectedStart !== marker.text.length) {
    throw new Error(
      `Text run projection marker glyphs do not cover text: ${sourceId}`,
    );
  }
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
    if (fragment.glyphs !== undefined) {
      if (!Array.isArray(fragment.glyphs)) {
        throw new Error(`Text run projection glyphs are invalid: ${source.id}`);
      }
      if (!finite(fragment.baseline)) {
        throw new Error(
          `Text run projection glyph baseline is invalid: ${source.id}`,
        );
      }
      const glyphs: readonly LeaferTextRunGlyph[] = fragment.glyphs;
      const ranges = new Map<number, number>();
      for (const glyph of glyphs) {
        if (
          !Number.isSafeInteger(glyph.glyphId) ||
          glyph.glyphId < 0 ||
          !Number.isSafeInteger(glyph.clusterStart) ||
          !Number.isSafeInteger(glyph.clusterEnd) ||
          glyph.clusterStart < fragment.start ||
          glyph.clusterEnd > fragment.end ||
          glyph.clusterEnd <= glyph.clusterStart ||
          typeof glyph.path !== "string" ||
          !finite(glyph.x) ||
          !finite(glyph.y) ||
          !finite(glyph.xAdvance) ||
          !finite(glyph.yAdvance)
        ) {
          throw new Error(
            `Text run projection glyphs are invalid: ${source.id}`,
          );
        }
        const end = ranges.get(glyph.clusterStart);
        if (end !== undefined && end !== glyph.clusterEnd) {
          throw new Error(
            `Text run projection glyph clusters are ambiguous: ${source.id}`,
          );
        }
        ranges.set(glyph.clusterStart, glyph.clusterEnd);
      }
      let clusterStart = fragment.start;
      for (const [start, end] of [...ranges].sort(
        (left, right) => left[0] - right[0],
      )) {
        if (start !== clusterStart) {
          throw new Error(
            `Text run projection glyphs do not cover fragment: ${source.id}`,
          );
        }
        clusterStart = end;
      }
      if (clusterStart !== fragment.end) {
        throw new Error(
          `Text run projection glyphs do not cover fragment: ${source.id}`,
        );
      }
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

function composeTransform(left: Transform, right: Transform): Transform {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
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

function isTextMarker(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const marker = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(marker.paragraphStart) &&
    typeof marker.text === "string" &&
    marker.text.length > 0
  );
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
