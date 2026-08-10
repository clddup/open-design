import type {
  DesignChangeSet,
  DesignDocument,
  DesignNode,
  Effect,
  Paint,
  Transform,
} from "@opendesign/design-contracts";
import type { LeaferFidelityWarning } from "./types.js";

export type LeaferElementTag =
  "Ellipse" | "Frame" | "Group" | "Image" | "Path" | "Rect" | "Text";

export interface LeaferElementSpec {
  childIds: string[];
  data: Record<string, unknown>;
  id: string;
  kind: DesignNode["kind"];
  parentId: string | null;
  tag: LeaferElementTag;
  transform: Transform;
}

export interface LeaferSceneProjection {
  affectedNodeIds?: ReadonlySet<string>;
  elementsById: ReadonlyMap<string, LeaferElementSpec>;
  pageId: string;
  revision: number;
  rootIds: string[];
  warnings: LeaferFidelityWarning[];
}

export function projectDesignPage(
  document: DesignDocument,
  pageId: string,
): LeaferSceneProjection {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Page ${pageId} does not exist`);

  const elementsById = new Map<string, LeaferElementSpec>();
  const warnings: LeaferFidelityWarning[] = [];
  const visited = new Set<string>();

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    const spec = toElementSpec(document, node, warnings);
    elementsById.set(node.id, spec);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);

  return {
    elementsById,
    pageId,
    revision: document.revision,
    rootIds: [...page.rootNodeIds],
    warnings,
  };
}

export function projectDesignPageIncrementally(
  previous: LeaferSceneProjection,
  document: DesignDocument,
  pageId: string,
  changes: DesignChangeSet,
): LeaferSceneProjection {
  if (
    previous.pageId !== pageId ||
    previous.revision !== changes.fromRevision ||
    document.documentId !== changes.documentId ||
    document.revision !== changes.toRevision
  ) {
    return projectDesignPage(document, pageId);
  }
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Page ${pageId} does not exist`);

  const activeNodeIds = collectPageNodeIds(document, page.rootNodeIds);
  const affectedNodeIds = new Set([
    ...changes.addedNodeIds,
    ...changes.changedNodeIds,
    ...changes.removedNodeIds,
  ]);
  const affectedAssetIds = new Set([
    ...(changes.addedAssetIds ?? []),
    ...(changes.changedAssetIds ?? []),
    ...(changes.removedAssetIds ?? []),
  ]);
  if (affectedAssetIds.size > 0) {
    activeNodeIds.forEach((nodeId) => {
      const node = document.nodesById[nodeId];
      if (node && referencesAnyAsset(node, affectedAssetIds)) {
        affectedNodeIds.add(nodeId);
      }
    });
  }

  for (const nodeId of [...affectedNodeIds]) {
    const node = document.nodesById[nodeId];
    if (!node || !activeNodeIds.has(nodeId)) continue;
    const previousSpec = previous.elementsById.get(nodeId);
    const effectiveLockChanged =
      projectionLockState(previousSpec) !== isEffectivelyLocked(document, node);
    const parentChanged = previousSpec?.parentId !== node.parentId;
    if (
      changes.addedNodeIds.includes(nodeId) ||
      effectiveLockChanged ||
      parentChanged
    ) {
      collectNodeSubtreeIds(document, nodeId).forEach((descendantId) =>
        affectedNodeIds.add(descendantId),
      );
    }
  }

  const elementsById = new Map(previous.elementsById);
  for (const nodeId of elementsById.keys()) {
    if (!activeNodeIds.has(nodeId)) {
      elementsById.delete(nodeId);
      affectedNodeIds.add(nodeId);
    }
  }

  const warnings = previous.warnings.filter(
    (warning) =>
      activeNodeIds.has(warning.nodeId) && !affectedNodeIds.has(warning.nodeId),
  );
  for (const nodeId of affectedNodeIds) {
    if (!activeNodeIds.has(nodeId)) {
      elementsById.delete(nodeId);
      continue;
    }
    const node = document.nodesById[nodeId];
    if (!node) {
      elementsById.delete(nodeId);
      continue;
    }
    elementsById.set(nodeId, toElementSpec(document, node, warnings));
  }

  return {
    affectedNodeIds,
    elementsById,
    pageId,
    revision: document.revision,
    rootIds: [...page.rootNodeIds],
    warnings,
  };
}

function collectPageNodeIds(
  document: DesignDocument,
  rootNodeIds: readonly string[],
): Set<string> {
  const result = new Set<string>();
  const visit = (nodeId: string) => {
    if (result.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  rootNodeIds.forEach(visit);
  return result;
}

function collectNodeSubtreeIds(
  document: DesignDocument,
  rootNodeId: string,
): Set<string> {
  const result = new Set<string>();
  const visit = (nodeId: string) => {
    if (result.has(nodeId)) return;
    const node = document.nodesById[nodeId];
    if (!node) return;
    result.add(nodeId);
    node.childIds.forEach(visit);
  };
  visit(rootNodeId);
  return result;
}

function isEffectivelyLocked(
  document: DesignDocument,
  node: DesignNode,
): boolean {
  const visited = new Set<string>();
  let current: DesignNode | undefined = node;
  while (current && !visited.has(current.id)) {
    if (current.locked) return true;
    visited.add(current.id);
    current = current.parentId
      ? document.nodesById[current.parentId]
      : undefined;
  }
  return false;
}

function referencesAnyAsset(
  value: unknown,
  assetIds: ReadonlySet<string>,
): boolean {
  if (Array.isArray(value)) {
    return value.some((item) => referencesAnyAsset(item, assetIds));
  }
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      (key === "assetId" && typeof item === "string" && assetIds.has(item)) ||
      referencesAnyAsset(item, assetIds),
  );
}

function toElementSpec(
  document: DesignDocument,
  node: DesignNode,
  warnings: LeaferFidelityWarning[],
): LeaferElementSpec {
  const effectivelyLocked = isEffectivelyLocked(document, node);
  const base = {
    id: node.id,
    name: node.name,
    opacity: node.opacity,
    visible: node.visible,
    // Leafer's native `locked` flag also removes the node from click and box
    // selection. OpenDesign lock semantics keep layers selectable and only
    // reject direct manipulation, so interaction locking stays in our adapter.
    locked: false,
    editable: true,
    ...mapNodeAppearance(node, warnings),
    data: {
      opendesignLocked: effectivelyLocked,
      opendesignNodeId: node.id,
      opendesignNodeKind: node.kind,
    },
  };
  let tag: LeaferElementTag;
  let data: Record<string, unknown>;
  switch (node.kind) {
    case "frame":
      tag = "Frame";
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        width: node.size.width,
        height: node.size.height,
        cornerRadius: node.properties.cornerRadius,
        overflow: node.properties.clipsContent ? "hide" : "show",
      };
      break;
    case "group":
      tag = "Group";
      data = { ...base, hitChildren: true };
      break;
    case "rectangle":
      tag = "Rect";
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        width: node.size.width,
        height: node.size.height,
        cornerRadius: node.properties.cornerRadius,
      };
      break;
    case "ellipse":
      tag = "Ellipse";
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        width: node.size.width,
        height: node.size.height,
      };
      break;
    case "text":
      tag = "Text";
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        width: node.size.width,
        height: node.size.height,
        text: node.properties.content,
        fontFamily: node.properties.fontFamily,
        fontSize: node.properties.fontSize,
        fontWeight: node.properties.fontWeight,
        lineHeight: { type: "px", value: node.properties.lineHeight },
        letterSpacing: { type: "px", value: node.properties.letterSpacing },
        textAlign: node.properties.textAlignHorizontal,
        verticalAlign:
          node.properties.textAlignVertical === "center"
            ? "middle"
            : node.properties.textAlignVertical,
        textWrap: "break",
        overflow: "hide",
      };
      break;
    case "image": {
      tag = "Image";
      const url = resolveImageDataUrl(document, node.properties.assetId);
      if (!url) {
        warnings.push({
          code: "missing-image",
          message: `Image asset ${node.properties.assetId} has no renderer-safe data source`,
          nodeId: node.id,
        });
      }
      data = {
        ...base,
        width: node.size.width,
        height: node.size.height,
        cornerRadius: node.properties.cornerRadius,
        url: null,
        fill: url
          ? {
              type: "image",
              url,
              mode:
                node.properties.fit === "contain"
                  ? "fit"
                  : node.properties.fit === "cover"
                    ? "cover"
                    : "stretch",
            }
          : "#d9dce2",
      };
      break;
    }
    case "vector":
    case "path": {
      tag = "Path";
      const path = readPath(node.properties.path);
      if (!path) {
        warnings.push({
          code: "invalid-path",
          message: `Node ${node.id} does not contain a supported path payload`,
          nodeId: node.id,
        });
      }
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        width: node.size.width,
        height: node.size.height,
        editConfig: { editSize: "scale" },
        path: path ?? null,
        windingRule: node.properties.fillRule ?? "nonzero",
      };
      break;
    }
    case "instance":
      tag = "Group";
      data = { ...base, hitChildren: true };
      warnings.push({
        code: "unsupported-node",
        message: `Instance node ${node.id} is projected as a structural group`,
        nodeId: node.id,
      });
      break;
  }

  return {
    childIds: [...node.childIds],
    data,
    id: node.id,
    kind: node.kind,
    parentId: node.parentId,
    tag,
    transform: [...node.transform],
  };
}

function projectionLockState(spec: LeaferElementSpec | undefined): boolean {
  const metadata = spec?.data.data;
  return (
    typeof metadata === "object" &&
    metadata !== null &&
    (metadata as Record<string, unknown>).opendesignLocked === true
  );
}

function mapPaints(
  document: DesignDocument,
  nodeId: string,
  paints: readonly Paint[],
  warnings: LeaferFidelityWarning[],
): unknown {
  if (paints.length === 0) return null;
  const mapped: unknown[] = [];
  for (const paint of paints) {
    const common = {
      opacity: paint.opacity,
      visible: paint.visible ?? true,
      ...(paint.blendMode === undefined ? {} : { blendMode: paint.blendMode }),
    };
    if (paint.type === "solid") {
      mapped.push({ type: "solid", color: paint.color, ...common });
      continue;
    }
    if (paint.type === "image") {
      const url = resolveImageDataUrl(document, paint.assetId);
      if (!url) {
        warnings.push({
          code: "missing-image",
          message: `Image paint asset ${paint.assetId} has no renderer-safe data source`,
          nodeId,
        });
        continue;
      }
      mapped.push({
        type: "image",
        url,
        mode:
          paint.fit === "contain"
            ? "fit"
            : paint.fit === "cover"
              ? "cover"
              : paint.fit === "tile"
                ? "repeat"
                : "stretch",
        ...common,
        ...(paint.rotation === undefined ? {} : { rotation: paint.rotation }),
        ...(paint.scale === undefined ? {} : { scale: paint.scale }),
        ...(paint.offset === undefined ? {} : { offset: paint.offset }),
      });
      continue;
    }
    mapped.push({
      type:
        paint.type === "linear-gradient"
          ? "linear"
          : paint.type === "radial-gradient"
            ? "radial"
            : "angular",
      ...common,
      stops: paint.stops.map((stop) => ({
        offset: stop.offset,
        color: colorWithOpacity(stop.color, stop.opacity),
      })),
      ...(paint.from === undefined
        ? {}
        : { from: { ...paint.from, type: "percent" } }),
      ...(paint.to === undefined
        ? {}
        : { to: { ...paint.to, type: "percent" } }),
      ...(paint.rotation === undefined ? {} : { rotation: paint.rotation }),
      ...(paint.stretch === undefined ? {} : { stretch: paint.stretch }),
    });
  }
  return mapped;
}

function mapShapeProperties(
  document: DesignDocument,
  nodeId: string,
  properties: {
    fills: readonly Paint[];
    strokes: readonly Paint[];
    strokeWidth: number;
    strokeAlign?: "inside" | "center" | "outside";
    strokeCap?: "none" | "round" | "square";
    strokeJoin?: "miter" | "round" | "bevel";
    dashPattern?: readonly number[];
  },
  warnings: LeaferFidelityWarning[],
) {
  return {
    fill: mapPaints(document, nodeId, properties.fills, warnings),
    stroke: mapPaints(document, nodeId, properties.strokes, warnings),
    strokeWidth: properties.strokeWidth,
    strokeAlign: properties.strokeAlign ?? "center",
    strokeCap: properties.strokeCap ?? "none",
    strokeJoin: properties.strokeJoin ?? "miter",
    dashPattern: properties.dashPattern ?? [],
  };
}

function mapNodeAppearance(
  node: DesignNode,
  warnings: LeaferFidelityWarning[],
): Record<string, unknown> {
  const effects = node.effects ?? [];
  const shadow: unknown[] = [];
  const innerShadow: unknown[] = [];
  let blur = 0;
  let backgroundBlur = 0;
  let grayscale = 0;
  for (const effect of effects) {
    if (effect.visible === false) continue;
    if (effect.type === "layer-blur") {
      blur = Math.max(blur, effect.radius);
      continue;
    }
    if (effect.type === "background-blur") {
      backgroundBlur = Math.max(backgroundBlur, effect.radius);
      continue;
    }
    if (effect.type === "grayscale") {
      grayscale = Math.max(grayscale, effect.amount);
      continue;
    }
    const mapped = mapShadowEffect(effect, node.id, warnings);
    if (effect.type === "inner-shadow" || effect.type === "inner-glow") {
      innerShadow.push(mapped);
    } else {
      shadow.push(mapped);
    }
  }
  return {
    blendMode: node.blendMode ?? "pass-through",
    shadow: shadow.length === 0 ? null : shadow,
    innerShadow: innerShadow.length === 0 ? null : innerShadow,
    blur,
    backgroundBlur,
    grayscale,
    mask:
      node.maskMode === "alpha"
        ? "pixel"
        : node.maskMode === "luminance"
          ? "grayscale"
          : node.maskMode === "clipping"
            ? "clipping"
            : node.maskMode === "outline"
              ? "path"
              : false,
  };
}

function mapShadowEffect(
  effect: Exclude<
    Effect,
    { type: "layer-blur" } | { type: "background-blur" } | { type: "grayscale" }
  >,
  nodeId: string,
  warnings: LeaferFidelityWarning[],
) {
  const glow = effect.type === "outer-glow" || effect.type === "inner-glow";
  const color = colorWithOpacity(effect.color, effect.opacity);
  if (typeof color === "string" && effect.opacity < 1) {
    warnings.push({
      code: "unsupported-color-alpha",
      message: `Effect color ${effect.color} cannot preserve a separate alpha channel`,
      nodeId,
    });
  }
  return {
    x: glow ? 0 : effect.offset.x,
    y: glow ? 0 : effect.offset.y,
    blur: glow ? effect.radius : effect.blur,
    spread: effect.spread,
    color,
    ...(effect.blendMode === undefined ? {} : { blendMode: effect.blendMode }),
  };
}

function colorWithOpacity(
  color: string,
  opacity: number,
): string | { r: number; g: number; b: number; a: number } {
  if (opacity >= 1) return color;
  const value = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  const match = long ?? short;
  if (!match) return color;
  const component = (part: string | undefined) =>
    Number.parseInt(short ? `${part}${part}` : (part ?? "00"), 16);
  return {
    r: component(match[1]),
    g: component(match[2]),
    b: component(match[3]),
    a: opacity,
  };
}

function resolveImageDataUrl(
  document: DesignDocument,
  assetId: string,
): string | undefined {
  const asset = document.assetsById[assetId];
  if (!asset || asset.kind !== "image" || asset.source.type !== "data") {
    return undefined;
  }
  if (asset.source.value.startsWith("data:image/")) return asset.source.value;
  return `data:${asset.mimeType};base64,${asset.source.value}`;
}

function readPath(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  return undefined;
}
