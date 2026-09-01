import type {
  ComponentSelectionTarget,
  DesignChangeSet,
  DesignDocument,
  DesignNode,
  Effect,
  ImageNode,
  Paint,
  VectorNetwork,
} from "@opendesign/design-contracts";
import { resolveLineEndpointPoint } from "@opendesign/design-contracts";
import {
  COMPONENT_PROJECTION_PREFIX,
  componentProjectionAssets,
  resolveComponentInstance,
} from "@opendesign/component-service";
import {
  normalizeImageFilters,
  resolveImagePlacement,
} from "@opendesign/image-service";
import type { BooleanGeometryResolution } from "@opendesign/geometry-service/boolean-resolver";
import { resolveRegularShapeGeometry } from "@opendesign/geometry-service/regular-shape";
import {
  resolvePathPropertiesData,
  serializeVectorNetwork,
  serializeVectorRegion,
} from "@opendesign/geometry-service/editable-vector";
import {
  projectVectorNetworkStrokePaths,
  vectorNetworkHasVertexStrokeOverrides,
} from "@opendesign/geometry-service/vector-stroke-appearance";
import type {
  BooleanEditProjectionOptions,
  BooleanProjectionOptions,
  LeaferElementSpec,
  LeaferElementTag,
  LeaferSceneProjection,
} from "./projection-types.js";
import type { LeaferBooleanEditScope, LeaferFidelityWarning } from "./types.js";
import {
  designSystemChangesRequireProjection,
  materializeDesignSystems,
  pageUsesDesignSystems,
} from "./design-system-projection.js";
import { toLeaferImageAdjustmentFilter } from "./image-adjustment-filter.js";

export type {
  BooleanEditProjectionOptions,
  BooleanProjectionOptions,
  LeaferElementSpec,
  LeaferElementTag,
  LeaferSceneProjection,
} from "./projection-types.js";

export const BOOLEAN_RESULT_ELEMENT_PREFIX =
  "__opendesign_boolean_result__:" as const;
export const VECTOR_REGION_ELEMENT_PREFIX =
  "__opendesign_vector_region__:" as const;
export const VECTOR_STROKE_ELEMENT_PREFIX =
  "__opendesign_vector_stroke__:" as const;
export const LEAFER_EDITOR_SELECTION_COLOR = "#4f7fff" as const;
export function projectDesignPage(
  document: DesignDocument,
  pageId: string,
): LeaferSceneProjection {
  const page = document.pagesById[pageId];
  if (!page) throw new Error(`Page ${pageId} does not exist`);

  const elementsById = new Map<string, LeaferElementSpec>();
  const warnings: LeaferFidelityWarning[] = [];
  const visited = new Set<string>();
  const projectedNodesById: DesignDocument["nodesById"] = {
    ...document.nodesById,
  };

  for (const instance of Object.values(document.nodesById)) {
    if (instance.kind !== "instance") continue;
    const resolution = resolveComponentInstance(document, instance.id);
    if (!resolution.ok) continue;
    for (const resolved of resolution.nodes) {
      projectedNodesById[resolved.projectionId] = resolved.node;
    }
  }
  const designSystems = materializeDesignSystems(
    { ...document, assetsById: componentProjectionAssets(document) },
    projectedNodesById,
  );
  const projectionDocument = designSystems.document;
  warnings.push(...designSystems.warnings);

  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (node.kind === "instance") {
      const resolution = resolveComponentInstance(document, node.id);
      if (!resolution.ok) {
        warnings.push(
          ...resolution.issues.map((issue) => ({
            code: "component-resolution-failed" as const,
            message: issue.message,
            nodeId: node.id,
          })),
        );
        const fallback = toElementSpec(document, node, warnings);
        elementsById.set(node.id, fallback);
        return;
      }
      for (const resolved of resolution.nodes) {
        const spec = toElementSpec(
          projectionDocument,
          projectionDocument.nodesById[resolved.projectionId] ?? resolved.node,
          warnings,
          {
            ...(!resolved.root && resolved.editableNodeId === undefined
              ? {
                  componentTarget: {
                    instanceId: resolved.selectionInstanceId,
                    sourcePath: [...resolved.selectionSourcePath],
                  },
                }
              : {}),
            nodeId: resolved.editableNodeId ?? resolved.selectionInstanceId,
            kind: resolved.root ? "instance" : resolved.node.kind,
            sourceNodeId: resolved.sourceNodeId,
          },
        );
        elementsById.set(resolved.projectionId, spec);
      }
      return;
    }
    const spec = toElementSpec(
      projectionDocument,
      projectionDocument.nodesById[node.id] ?? node,
      warnings,
    );
    elementsById.set(node.id, spec);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);

  projectEditableVectorNetworkChildren(
    projectionDocument,
    elementsById,
    warnings,
  );

  return {
    documentId: document.documentId,
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

  if (
    [...previous.elementsById.keys()].some(
      (id) =>
        id.startsWith(VECTOR_REGION_ELEMENT_PREFIX) ||
        id.startsWith(VECTOR_STROKE_ELEMENT_PREFIX),
    ) ||
    [...collectPageNodeIds(document, page.rootNodeIds)].some((nodeId) => {
      const node = document.nodesById[nodeId];
      return (
        (node?.kind === "path" || node?.kind === "vector") &&
        "network" in node.properties
      );
    }) ||
    [...previous.elementsById.keys()].some((id) =>
      id.startsWith(COMPONENT_PROJECTION_PREFIX),
    ) ||
    [...collectPageNodeIds(document, page.rootNodeIds)].some(
      (nodeId) => document.nodesById[nodeId]?.kind === "instance",
    ) ||
    pageUsesDesignSystems(document, page.rootNodeIds) ||
    designSystemChangesRequireProjection(changes)
  ) {
    return diffProjectedScene(previous, projectDesignPage(document, pageId));
  }

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
    documentId: document.documentId,
    elementsById,
    pageId,
    revision: document.revision,
    rootIds: [...page.rootNodeIds],
    warnings,
  };
}

function diffProjectedScene(
  previous: LeaferSceneProjection,
  next: LeaferSceneProjection,
): LeaferSceneProjection {
  const affectedNodeIds = new Set<string>();
  const ids = new Set([
    ...previous.elementsById.keys(),
    ...next.elementsById.keys(),
  ]);
  for (const id of ids) {
    const before = previous.elementsById.get(id);
    const after = next.elementsById.get(id);
    if (JSON.stringify(before) !== JSON.stringify(after))
      affectedNodeIds.add(id);
  }
  return { ...next, affectedNodeIds };
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
  identity?: {
    componentTarget?: ComponentSelectionTarget;
    kind: DesignNode["kind"];
    nodeId: string;
    sourceNodeId: string;
  },
): LeaferElementSpec {
  const effectivelyLocked = isEffectivelyLocked(document, node);
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  const hiddenBooleanOperand = parent?.kind === "boolean";
  const base = {
    id: node.id,
    name: node.name,
    opacity: node.opacity,
    visible: node.visible && !hiddenBooleanOperand,
    // Leafer's native `locked` flag also removes the node from click and box
    // selection. OpenDesign lock semantics keep layers selectable and only
    // reject direct manipulation, so interaction locking stays in our adapter.
    locked: false,
    editable: true,
    ...(identity?.kind === "instance"
      ? {
          editConfig: {
            preventEditInner: false,
            resizeable: false,
          },
        }
      : {}),
    ...mapNodeAppearance(node, warnings),
    data: {
      ...(identity?.componentTarget
        ? {
            opendesignComponentTarget: structuredClone(
              identity.componentTarget,
            ),
          }
        : {}),
      opendesignLocked: effectivelyLocked,
      opendesignNodeId: identity?.nodeId ?? node.id,
      opendesignNodeKind: identity?.kind ?? node.kind,
      ...(identity ? { opendesignSourceNodeId: identity.sourceNodeId } : {}),
    },
  };
  let tag: LeaferElementTag;
  let data: Record<string, unknown>;
  switch (node.kind) {
    case "frame":
    case "slot": {
      const shape = mapShapeProperties(
        document,
        node.id,
        node.properties,
        warnings,
      );
      tag = "Frame";
      data = {
        ...base,
        ...shape,
        // Leafer Frame declares a #FFFFFF default fill and treats null as
        // "use the default". OpenDesign empty fills mean a truly transparent
        // structural container, so project that state explicitly.
        fill: shape.fill ?? "rgba(0, 0, 0, 0)",
        width: node.size.width,
        height: node.size.height,
        cornerRadius: node.properties.cornerRadius,
        overflow: node.properties.clipsContent ? "hide" : "show",
      };
      break;
    }
    case "group":
      tag = "Group";
      data = { ...base, hitChildren: true };
      break;
    case "boolean":
      tag = "Group";
      data = {
        ...base,
        // The structural group owns transforms and selection only. Its
        // synthetic Path child owns the Boolean appearance so opacity and
        // effects are never applied twice.
        backgroundBlur: 0,
        blendMode: "pass-through",
        blur: 0,
        grayscale: 0,
        hitChildren: true,
        innerShadow: null,
        mask: false,
        opacity: 1,
        shadow: null,
      };
      warnings.push({
        code: "boolean-geometry-pending",
        message: `Boolean node ${node.id} is waiting for its derived PathKit projection`,
        nodeId: node.id,
      });
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
    case "line": {
      tag = "Arrow";
      const start = resolveLineEndpointPoint(node.size, node.properties.start);
      const end = resolveLineEndpointPoint(node.size, node.properties.end);
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        fill: null,
        points: [start.x, start.y, end.x, end.y],
        startArrow: mapLineEndpoint(node.properties.startEndpoint),
        endArrow: mapLineEndpoint(node.properties.endEndpoint),
      };
      break;
    }
    case "polygon": {
      const shape = mapShapeProperties(
        document,
        node.id,
        node.properties,
        warnings,
      );
      if (node.properties.cornerRadius === 0) {
        tag = "Polygon";
        data = {
          ...base,
          ...shape,
          width: node.size.width,
          height: node.size.height,
          sides: node.properties.pointCount,
        };
      } else {
        tag = "Path";
        data = {
          ...base,
          ...shape,
          editConfig: { editSize: "scale" },
          path: regularShapeLeaferPath(node, warnings),
          windingRule: "nonzero",
        };
      }
      break;
    }
    case "star": {
      const shape = mapShapeProperties(
        document,
        node.id,
        node.properties,
        warnings,
      );
      if (node.properties.cornerRadius === 0) {
        tag = "Star";
        data = {
          ...base,
          ...shape,
          width: node.size.width,
          height: node.size.height,
          corners: node.properties.pointCount,
          innerRadius: node.properties.innerRadius,
        };
      } else {
        tag = "Path";
        data = {
          ...base,
          ...shape,
          editConfig: { editSize: "scale" },
          path: regularShapeLeaferPath(node, warnings),
          windingRule: "nonzero",
        };
      }
      break;
    }
    case "text":
      tag = "Text";
      data = {
        ...base,
        ...mapShapeProperties(document, node.id, node.properties, warnings),
        ...(node.properties.textResize === "fixed"
          ? { width: node.size.width, height: node.size.height }
          : node.properties.textResize === "auto-height"
            ? { width: node.size.width }
            : {}),
        text: node.properties.content,
        fontFamily: node.properties.fontFamily,
        fontSize: node.properties.fontSize,
        fontWeight: node.properties.fontWeight,
        italic: node.properties.fontSlant === "italic",
        lineHeight: { type: "px", value: node.properties.lineHeight },
        letterSpacing: { type: "px", value: node.properties.letterSpacing },
        paraIndent: node.properties.paragraphIndent,
        paraSpacing: node.properties.paragraphSpacing,
        textCase:
          node.properties.textCase === "original"
            ? "none"
            : node.properties.textCase === "uppercase"
              ? "upper"
              : node.properties.textCase === "lowercase"
                ? "lower"
                : node.properties.textCase === "title-case"
                  ? "title"
                  : "small-caps",
        textDecoration:
          node.properties.textDecoration === "underline"
            ? "under"
            : node.properties.textDecoration === "strikethrough"
              ? "delete"
              : "none",
        textAlign: node.properties.textAlignHorizontal,
        verticalAlign:
          node.properties.textAlignVertical === "center"
            ? "middle"
            : node.properties.textAlignVertical,
        textWrap:
          node.properties.textWrap === "word"
            ? "normal"
            : node.properties.textWrap === "character"
              ? "break"
              : "none",
        textOverflow:
          node.properties.textTruncation === "ending"
            ? "ellipsis"
            : node.properties.textOverflow === "visible"
              ? "show"
              : "hide",
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
      const placement = mapImageNodePlacement(document, node);
      const imageFilter = toLeaferImageAdjustmentFilter(
        node.properties.filters,
      );
      data = {
        ...base,
        width: node.size.width,
        height: node.size.height,
        cornerRadius: node.properties.cornerRadius,
        url: null,
        ...(imageFilter ? { filter: imageFilter } : {}),
        fill: url
          ? {
              type: "image",
              url,
              mode: placement.mode,
              ...(placement.mode === "clip"
                ? {
                    offset: placement.offset,
                    scale: placement.scale,
                    rotation: placement.rotation,
                  }
                : {}),
            }
          : "#d9dce2",
      };
      break;
    }
    case "vector":
    case "path": {
      const editableNetwork = "network" in node.properties;
      tag = editableNetwork ? "Group" : "Path";
      const pathData = resolvePathPropertiesData(node.properties);
      const path = pathData === null ? null : readPath(pathData);
      if (!path) {
        warnings.push({
          code: "invalid-path",
          message: `Node ${node.id} does not contain a supported path payload`,
          nodeId: node.id,
        });
      }
      const shape = mapShapeProperties(
        document,
        node.id,
        node.properties,
        warnings,
      );
      data = editableNetwork
        ? {
            ...base,
            fill: null,
            hitChildren: true,
            stroke: null,
          }
        : {
            ...base,
            ...shape,
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
    case "slice":
      tag = "Rect";
      data = {
        ...base,
        fill: "rgba(0, 0, 0, 0)",
        height: node.size.height,
        hitFill: "all",
        stroke: null,
        width: node.size.width,
      };
      break;
  }

  return {
    childIds: [...node.childIds],
    data,
    id: node.id,
    kind: identity?.kind ?? node.kind,
    parentId: node.parentId,
    tag,
    ...(node.kind === "text" &&
    node.properties.textTruncation === "ending" &&
    node.properties.maxLines !== null
      ? { textMaxLines: node.properties.maxLines }
      : {}),
    transform: [...node.transform],
  };
}

function projectEditableVectorNetworkChildren(
  document: DesignDocument,
  elementsById: Map<string, LeaferElementSpec>,
  warnings: LeaferFidelityWarning[],
): void {
  for (const spec of [...elementsById.values()]) {
    const node = document.nodesById[spec.id];
    if (
      !node ||
      (node.kind !== "path" && node.kind !== "vector") ||
      !("network" in node.properties)
    ) {
      continue;
    }
    const serialized = serializeVectorNetwork(
      node.properties.network,
      node.properties.cornerRadius ?? 0,
      node.properties.cornerSmoothing ?? 0,
    );
    if (!serialized.ok) continue;
    const metadata = projectionMetadata(spec.data.data);
    const shape = mapShapeProperties(
      document,
      node.id,
      node.properties,
      warnings,
    );
    const childIds: string[] = [];
    for (const region of node.properties.network.regions) {
      const result = serializeVectorRegion(
        node.properties.network,
        region.id,
        node.properties.cornerRadius ?? 0,
        node.properties.cornerSmoothing ?? 0,
      );
      if (!result.ok) continue;
      const id = vectorRegionElementId(node.id, region.id);
      childIds.push(id);
      elementsById.set(id, {
        childIds: [],
        data: {
          data: {
            ...metadata,
            opendesignProjectionId: id,
            opendesignSynthetic: true,
            opendesignVectorRegionId: region.id,
          },
          editable: false,
          id,
          fill: mapPaints(
            document,
            node.id,
            region.fills ?? node.properties.fills,
            warnings,
          ),
          hitFill: "all",
          hittable: true,
          name: `${node.name} · ${region.id}`,
          path: result.path,
          stroke: null,
          windingRule: region.windingRule,
        },
        id,
        kind: "path",
        parentId: node.id,
        tag: "Path",
        transform: [1, 0, 0, 1, 0, 0],
      });
    }
    const strokePaths = projectedVectorStrokePaths(
      node.properties.network,
      serialized.path,
      shape,
      node.properties.cornerRadius ?? 0,
      node.properties.cornerSmoothing ?? 0,
    );
    if (!strokePaths.ok) {
      warnings.push({
        code: "vector-stroke-appearance-unsupported",
        message: strokePaths.message,
        nodeId: node.id,
      });
    }
    (strokePaths.ok ? strokePaths.paths : strokePaths.fallback).forEach(
      (strokePath, index) => {
        const strokeId = vectorStrokeElementId(node.id, index);
        childIds.push(strokeId);
        elementsById.set(strokeId, {
          childIds: [],
          data: {
            data: {
              ...metadata,
              opendesignProjectionId: strokeId,
              opendesignSynthetic: true,
            },
            dashPattern: strokePath.dashPattern,
            editable: false,
            fill: null,
            hitStroke: "all",
            hittable: true,
            id: strokeId,
            name: `${node.name} · stroke`,
            path: strokePath.path,
            stroke: shape.stroke,
            strokeAlign: shape.strokeAlign,
            strokeCap: strokePath.strokeCap,
            strokeJoin: strokePath.strokeJoin,
            strokeWidth: shape.strokeWidth,
          },
          id: strokeId,
          kind: "path",
          parentId: node.id,
          tag: "Path",
          transform: [1, 0, 0, 1, 0, 0],
        });
      },
    );
    elementsById.set(node.id, { ...spec, childIds });
  }
}

export function vectorRegionElementId(
  nodeId: string,
  regionId: string,
): string {
  return `${VECTOR_REGION_ELEMENT_PREFIX}${nodeId}:${regionId}`;
}

export function vectorStrokeElementId(nodeId: string, index = 0): string {
  return `${VECTOR_STROKE_ELEMENT_PREFIX}${nodeId}${index === 0 ? "" : `:${index}`}`;
}

function projectedVectorStrokePaths(
  network: VectorNetwork,
  fallbackPath: string,
  shape: {
    dashPattern: readonly number[];
    strokeCap: "none" | "round" | "square";
    strokeJoin: "miter" | "round" | "bevel";
    strokeWidth: number;
  },
  cornerRadius: number,
  cornerSmoothing: number,
):
  | {
      ok: true;
      paths: Array<{
        dashPattern: readonly number[];
        path: string;
        strokeCap: "none" | "round" | "square";
        strokeJoin: "miter" | "round" | "bevel";
      }>;
    }
  | {
      ok: false;
      fallback: Array<{
        dashPattern: readonly number[];
        path: string;
        strokeCap: "none" | "round" | "square";
        strokeJoin: "miter" | "round" | "bevel";
      }>;
      message: string;
    } {
  const fallback = [
    {
      dashPattern: shape.dashPattern,
      path: fallbackPath,
      strokeCap: shape.strokeCap,
      strokeJoin: shape.strokeJoin,
    },
  ];
  if (!vectorNetworkHasVertexStrokeOverrides(network)) {
    return { ok: true, paths: fallback };
  }
  const projected = projectVectorNetworkStrokePaths(
    network,
    { strokeCap: shape.strokeCap, strokeJoin: shape.strokeJoin },
    shape.strokeWidth,
    cornerRadius,
    cornerSmoothing,
    shape.dashPattern,
  );
  return projected.ok
    ? {
        ok: true,
        paths: projected.paths.map((path) => ({
          dashPattern: [],
          path: path.path,
          strokeCap: path.cap === "butt" ? "none" : path.cap,
          strokeJoin: path.join,
        })),
      }
    : { ok: false, fallback, message: projected.message };
}

function projectionMetadata(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function mapLineEndpoint(
  endpoint:
    | "none"
    | "line-arrow"
    | "triangle-arrow"
    | "reversed-triangle-arrow"
    | "circle"
    | "diamond",
): "none" | "angle" | "triangle" | "triangle-flip" | "circle" | "diamond" {
  switch (endpoint) {
    case "none":
      return "none";
    case "line-arrow":
      return "angle";
    case "triangle-arrow":
      return "triangle";
    case "reversed-triangle-arrow":
      return "triangle-flip";
    case "circle":
      return "circle";
    case "diamond":
      return "diamond";
  }
}

export function projectResolvedBooleanGeometry(
  base: LeaferSceneProjection,
  document: DesignDocument,
  resolution: BooleanGeometryResolution,
  options: BooleanProjectionOptions = {},
): LeaferSceneProjection {
  if (base.pageId !== resolution.pageId) {
    throw new Error(
      `Boolean geometry for ${resolution.pageId} cannot project page ${base.pageId}`,
    );
  }
  const elementsById = new Map(base.elementsById);
  const warnings = base.warnings.filter(
    (warning) => warning.code !== "boolean-geometry-pending",
  );
  const affectedNodeIds =
    base.affectedNodeIds ||
    options.affectedBooleanNodeIds ||
    options.removedBooleanNodeIds
      ? new Set(base.affectedNodeIds ?? [])
      : undefined;
  const affectedBooleans = new Set(options.affectedBooleanNodeIds ?? []);
  base.affectedNodeIds?.forEach((nodeId) => {
    if (document.nodesById[nodeId]?.kind === "boolean") {
      affectedBooleans.add(nodeId);
    }
  });

  for (const spec of base.elementsById.values()) {
    if (spec.kind !== "boolean") continue;
    const node = document.nodesById[spec.id];
    if (!node || node.kind !== "boolean") continue;
    const result = resolution.resultsByNodeId.get(node.id);
    if (!result) {
      const issue = resolution.issues.find(
        (candidate) =>
          candidate.nodeId === node.id ||
          candidate.message.includes(`Boolean ${node.id}`),
      );
      warnings.push({
        code:
          issue?.code === "provider-failure"
            ? "boolean-geometry-provider-failed"
            : issue?.code === "unsupported-operand" ||
                issue?.code === "unsupported-style"
              ? "boolean-geometry-unsupported"
              : "boolean-geometry-failed",
        message:
          issue?.message ??
          `Boolean node ${node.id} has no derived geometry result`,
        nodeId: node.id,
      });
      continue;
    }
    const resultId = booleanResultElementId(node.id);
    const resultWarnings: LeaferFidelityWarning[] = [];
    const resultSpec: LeaferElementSpec = {
      childIds: [],
      data: {
        id: resultId,
        name: `${node.name} result`,
        opacity: node.opacity,
        visible: node.visible && !result.empty,
        locked: false,
        editable: false,
        hittable: !result.empty,
        ...mapNodeAppearance(node, resultWarnings),
        ...mapShapeProperties(
          document,
          node.id,
          node.properties,
          resultWarnings,
        ),
        editConfig: { editSize: "scale" },
        path: result.empty ? null : result.path,
        windingRule: node.properties.fillRule ?? result.fillRule,
        data: {
          opendesignLocked: isEffectivelyLocked(document, node),
          opendesignNodeId: node.id,
          opendesignNodeKind: node.kind,
          opendesignProjectionId: resultId,
          opendesignSynthetic: true,
        },
      },
      id: resultId,
      kind: "path",
      parentId: node.id,
      tag: "Path",
      transform: [1, 0, 0, 1, 0, 0],
    };
    elementsById.set(node.id, {
      ...spec,
      childIds: [resultId, ...node.childIds],
    });
    elementsById.set(resultId, resultSpec);
    warnings.push(...resultWarnings);
    if (affectedBooleans.has(node.id)) {
      affectedNodeIds?.add(node.id);
      affectedNodeIds?.add(resultId);
    }
  }

  options.removedBooleanNodeIds?.forEach((nodeId) => {
    affectedNodeIds?.add(nodeId);
    affectedNodeIds?.add(booleanResultElementId(nodeId));
  });
  return {
    ...(affectedNodeIds === undefined ? {} : { affectedNodeIds }),
    documentId: base.documentId,
    elementsById,
    pageId: base.pageId,
    revision: base.revision,
    rootIds: base.rootIds,
    warnings,
  };
}

/**
 * Adds disposable operand outlines for a selection-derived Boolean edit scope.
 * The resolved result remains visible and authoritative; no provider path or
 * interaction state is written back to DesignDocument.
 */
export function projectBooleanEditScope(
  base: LeaferSceneProjection,
  document: DesignDocument,
  scope: LeaferBooleanEditScope | undefined,
  options: BooleanEditProjectionOptions = {},
): LeaferSceneProjection {
  const elementsById = new Map(base.elementsById);
  const affectedNodeIds =
    base.affectedNodeIds ||
    (options.forceAffected && options.affectedBooleanNodeIds)
      ? new Set(base.affectedNodeIds ?? [])
      : undefined;

  options.affectedBooleanNodeIds?.forEach((booleanId) => {
    const node = document.nodesById[booleanId];
    if (!node || node.kind !== "boolean") return;
    node.childIds.forEach((childId) => {
      affectedNodeIds?.add(childId);
      const child = document.nodesById[childId];
      if (child?.kind === "boolean") {
        affectedNodeIds?.add(booleanResultElementId(child.id));
      }
    });
  });

  if (!scope) {
    return {
      ...base,
      ...(affectedNodeIds === undefined ? {} : { affectedNodeIds }),
      elementsById,
    };
  }
  const boolean = document.nodesById[scope.booleanId];
  if (!boolean || boolean.kind !== "boolean") return base;
  const selected = new Set(scope.selectedOperandIds);
  for (const operandId of boolean.childIds) {
    const operand = document.nodesById[operandId];
    const spec = elementsById.get(operandId);
    if (!operand || !spec) continue;
    const visible = operand.visible || selected.has(operand.id);
    affectedNodeIds?.add(operand.id);
    elementsById.set(operand.id, {
      ...spec,
      data:
        operand.kind === "boolean"
          ? {
              ...spec.data,
              hittable: visible,
              visible,
              data: booleanEditMetadata(spec.data.data, scope, operand.id),
            }
          : booleanOperandOutlineData(spec.data, scope, operand.id, visible),
    });
    if (operand.kind !== "boolean") continue;
    const resultId = booleanResultElementId(operand.id);
    const resultSpec = elementsById.get(resultId);
    if (!resultSpec) continue;
    affectedNodeIds?.add(resultId);
    elementsById.set(resultId, {
      ...resultSpec,
      data: booleanOperandOutlineData(
        resultSpec.data,
        scope,
        operand.id,
        visible,
      ),
    });
  }
  return {
    ...base,
    ...(affectedNodeIds === undefined ? {} : { affectedNodeIds }),
    elementsById,
  };
}

export function booleanResultElementId(booleanNodeId: string): string {
  return `${BOOLEAN_RESULT_ELEMENT_PREFIX}${booleanNodeId}`;
}

function booleanOperandOutlineData(
  data: Record<string, unknown>,
  scope: LeaferBooleanEditScope,
  operandId: string,
  visible: boolean,
): Record<string, unknown> {
  return {
    ...data,
    backgroundBlur: 0,
    blendMode: "normal",
    blur: 0,
    dashPattern: [],
    fill: null,
    grayscale: 0,
    hittable: visible,
    innerShadow: null,
    mask: false,
    opacity: 1,
    shadow: null,
    stroke: LEAFER_EDITOR_SELECTION_COLOR,
    strokeAlign: "center",
    strokeCap: "none",
    strokeJoin: "miter",
    strokeWidth: 1,
    visible,
    data: booleanEditMetadata(data.data, scope, operandId),
  };
}

function booleanEditMetadata(
  metadata: unknown,
  scope: LeaferBooleanEditScope,
  operandId: string,
): Record<string, unknown> {
  return {
    ...(typeof metadata === "object" && metadata !== null ? metadata : {}),
    opendesignBooleanEditScopeId: scope.booleanId,
    opendesignBooleanOperandId: operandId,
    opendesignBooleanReadOnly: scope.readOnly,
  };
}

function mapImageNodePlacement(document: DesignDocument, node: ImageNode) {
  const asset = document.assetsById[node.properties.assetId];
  const sourceSize = asset?.kind === "image" ? asset.size : undefined;
  if (
    !sourceSize ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0 ||
    node.size.width <= 0 ||
    node.size.height <= 0
  ) {
    return node.properties.placement.mode === "fit"
      ? ({ mode: "fit" } as const)
      : ({ mode: "stretch" } as const);
  }
  return resolveImagePlacement({
    placement: node.properties.placement,
    sourceSize,
    targetSize: node.size,
  });
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
      const filters = normalizeImageFilters(paint.filters);
      mapped.push({
        type: "image",
        url,
        mode:
          paint.fit === "contain"
            ? "fit"
            : paint.fit === "cover"
              ? "cover"
              : paint.fit === "crop"
                ? "clip"
                : paint.fit === "tile"
                  ? "repeat"
                  : "stretch",
        ...common,
        ...(paint.rotation === undefined ? {} : { rotation: paint.rotation }),
        ...(paint.scale === undefined ? {} : { scale: paint.scale }),
        ...(paint.offset === undefined ? {} : { offset: paint.offset }),
        ...(filters === undefined
          ? {}
          : {
              filter: Object.entries(filters).map(([type, value]) => ({
                type,
                value,
              })),
            }),
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

export function mapTextRunPaints(
  document: DesignDocument,
  nodeId: string,
  paints: readonly Paint[],
  warnings: LeaferFidelityWarning[],
): unknown {
  return mapPaints(document, nodeId, paints, warnings);
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

function regularShapeLeaferPath(
  node: Extract<DesignNode, { kind: "polygon" | "star" }>,
  warnings: LeaferFidelityWarning[],
): string | null {
  const geometry = resolveRegularShapeGeometry(node);
  if (!geometry.ok) {
    warnings.push({
      code: "invalid-path",
      message: geometry.message,
      nodeId: node.id,
    });
    return null;
  }
  return `M0 0M${node.size.width} ${node.size.height}${geometry.path}`;
}
