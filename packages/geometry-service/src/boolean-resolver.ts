import type {
  BooleanNode,
  DesignDocument,
  DesignNode,
  Rect,
} from "@opendesign/design-contracts";
import {
  resolveRegularPolygonPoints,
  resolveStarPoints,
} from "@opendesign/design-contracts";
import type {
  VectorBooleanOperation,
  VectorFillRule,
  VectorGeometryProvider,
  VectorGeometryResult,
} from "./vector-path.js";
import {
  resolvePathPropertiesData,
  serializeVectorNetwork,
  vectorNetworkHasFillRegion,
} from "./editable-vector.js";
import { outlineVectorNetworkStroke } from "./vector-materialization.js";

export const BOOLEAN_GEOMETRY_RESOLVER_VERSION = 1 as const;

export type BooleanGeometryIssueCode =
  | "budget-exceeded"
  | "cyclic-boolean"
  | "invalid-boolean"
  | "missing-node"
  | "provider-failure"
  | "unsupported-operand"
  | "unsupported-style";

export interface BooleanGeometryIssue {
  code: BooleanGeometryIssueCode;
  message: string;
  nodeId: string;
}

export interface ResolvedBooleanGeometry {
  bounds: Rect | null;
  empty: boolean;
  fillRule: VectorFillRule;
  nodeId: string;
  path: string;
  provider: VectorGeometryProvider["id"];
  providerVersion: VectorGeometryProvider["version"];
}

export interface BooleanGeometryResolution {
  computedNodeIds: readonly string[];
  issues: readonly BooleanGeometryIssue[];
  pageId: string;
  resolverVersion: typeof BOOLEAN_GEOMETRY_RESOLVER_VERSION;
  resultsByNodeId: ReadonlyMap<string, ResolvedBooleanGeometry>;
  reusedNodeIds: readonly string[];
}

export interface BooleanGeometryResolver {
  clear(): void;
  resolve(document: DesignDocument, pageId: string): BooleanGeometryResolution;
}

export interface BooleanGeometryResolverOptions {
  maxBooleanNodes?: number;
  maxCacheCharacters?: number;
  maxCacheEntries?: number;
  maxFingerprintCharacters?: number;
  maxRecursionDepth?: number;
}

interface GeometryValue {
  bounds: Rect | null;
  empty: boolean;
  fillRule: VectorFillRule;
  path: string;
}

type GeometryAttempt =
  | { ok: true; value: GeometryValue }
  | { ok: false; issue: BooleanGeometryIssue };

interface CacheEntry {
  characterCost: number;
  fingerprint: string;
  result: ResolvedBooleanGeometry;
}

interface ResolveState {
  computedNodeIds: string[];
  document: DesignDocument;
  fingerprintByNodeId: Map<string, string>;
  issues: BooleanGeometryIssue[];
  issueKeys: Set<string>;
  resolvedByNodeId: Map<string, ResolvedBooleanGeometry>;
  resolving: Set<string>;
  reusedNodeIds: string[];
}

interface RequiredResolverOptions {
  maxBooleanNodes: number;
  maxCacheCharacters: number;
  maxCacheEntries: number;
  maxFingerprintCharacters: number;
  maxRecursionDepth: number;
}

type ShapeNode = Extract<
  DesignNode,
  {
    kind:
      | "boolean"
      | "ellipse"
      | "path"
      | "polygon"
      | "rectangle"
      | "star"
      | "vector";
  }
>;

const DEFAULT_OPTIONS: RequiredResolverOptions = {
  maxBooleanNodes: 256,
  maxCacheCharacters: 4_000_000,
  maxCacheEntries: 256,
  maxFingerprintCharacters: 2_000_000,
  maxRecursionDepth: 64,
};

const KAPPA = 0.552_284_749_830_793_6;

export function createBooleanGeometryResolver(
  provider: VectorGeometryProvider,
  options: BooleanGeometryResolverOptions = {},
): BooleanGeometryResolver {
  return new CachedBooleanGeometryResolver(provider, options);
}

class CachedBooleanGeometryResolver implements BooleanGeometryResolver {
  readonly #cache = new Map<string, CacheEntry>();
  readonly #options: RequiredResolverOptions;
  #cacheCharacters = 0;

  constructor(
    private readonly provider: VectorGeometryProvider,
    options: BooleanGeometryResolverOptions,
  ) {
    this.#options = { ...DEFAULT_OPTIONS, ...options };
    if (
      !Object.values(this.#options).every(
        (value) => Number.isInteger(value) && value > 0,
      )
    ) {
      throw new RangeError("Boolean geometry resolver limits are invalid");
    }
  }

  clear(): void {
    this.#cache.clear();
    this.#cacheCharacters = 0;
  }

  resolve(document: DesignDocument, pageId: string): BooleanGeometryResolution {
    const state: ResolveState = {
      computedNodeIds: [],
      document,
      fingerprintByNodeId: new Map(),
      issues: [],
      issueKeys: new Set(),
      resolvedByNodeId: new Map(),
      resolving: new Set(),
      reusedNodeIds: [],
    };
    const booleanNodeIds = collectPageBooleanNodeIds(document, pageId);
    if (booleanNodeIds.length > this.#options.maxBooleanNodes) {
      this.#addIssue(state, {
        code: "budget-exceeded",
        message: `Page ${pageId} contains more than ${this.#options.maxBooleanNodes} Boolean nodes`,
        nodeId: pageId,
      });
    } else {
      booleanNodeIds.forEach((nodeId) => {
        this.#resolveBoolean(state, nodeId, 0);
      });
    }
    return {
      computedNodeIds: state.computedNodeIds,
      issues: state.issues,
      pageId,
      resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
      resultsByNodeId: state.resolvedByNodeId,
      reusedNodeIds: state.reusedNodeIds,
    };
  }

  #resolveBoolean(
    state: ResolveState,
    nodeId: string,
    depth: number,
  ): GeometryAttempt {
    const existing = state.resolvedByNodeId.get(nodeId);
    if (existing) return { ok: true, value: existing };
    if (depth > this.#options.maxRecursionDepth) {
      return this.#fail(state, {
        code: "budget-exceeded",
        message: `Boolean ${nodeId} exceeds the ${this.#options.maxRecursionDepth}-level recursion limit`,
        nodeId,
      });
    }
    if (state.resolving.has(nodeId)) {
      return this.#fail(state, {
        code: "cyclic-boolean",
        message: `Boolean ${nodeId} contains a cyclic operand reference`,
        nodeId,
      });
    }
    const node = state.document.nodesById[nodeId];
    if (!node || node.kind !== "boolean") {
      return this.#fail(state, {
        code: "missing-node",
        message: `Boolean ${nodeId} is missing from the document`,
        nodeId,
      });
    }
    if (node.childIds.length < 2) {
      return this.#fail(state, {
        code: "invalid-boolean",
        message: `Boolean ${nodeId} requires at least two ordered operands`,
        nodeId,
      });
    }

    const fingerprint = this.#fingerprintBoolean(state, node, depth);
    if (!fingerprint.ok) return fingerprint;
    const cached = this.#cache.get(nodeId);
    if (cached?.fingerprint === fingerprint.value.path) {
      this.#cache.delete(nodeId);
      this.#cache.set(nodeId, cached);
      state.resolvedByNodeId.set(nodeId, cached.result);
      state.reusedNodeIds.push(nodeId);
      return { ok: true, value: cached.result };
    }

    state.resolving.add(nodeId);
    try {
      const operands: GeometryValue[] = [];
      for (const childId of node.childIds) {
        const operand = this.#resolveOperand(state, childId, depth + 1);
        if (!operand.ok) {
          return this.#fail(state, {
            code: operand.issue.code,
            message: `Boolean ${nodeId} could not resolve operand ${childId}: ${operand.issue.message}`,
            nodeId,
          });
        }
        operands.push(operand.value);
      }
      const combined = this.#combine(
        node.properties.operation,
        operands,
        node.id,
      );
      if (!combined.ok) return this.#fail(state, combined.issue);
      const result: ResolvedBooleanGeometry = {
        ...combined.value,
        nodeId,
        provider: this.provider.id,
        providerVersion: this.provider.version,
      };
      state.resolvedByNodeId.set(nodeId, result);
      state.computedNodeIds.push(nodeId);
      this.#storeCache(nodeId, fingerprint.value.path, result);
      return { ok: true, value: result };
    } finally {
      state.resolving.delete(nodeId);
    }
  }

  #resolveOperand(
    state: ResolveState,
    nodeId: string,
    depth: number,
  ): GeometryAttempt {
    const node = state.document.nodesById[nodeId];
    if (!node) {
      return this.#fail(state, {
        code: "missing-node",
        message: `Boolean operand ${nodeId} is missing`,
        nodeId,
      });
    }
    if (!isShapeNode(node)) {
      return this.#fail(state, {
        code: "unsupported-operand",
        message: `${node.kind} node ${node.id} cannot be converted to deterministic Boolean geometry`,
        nodeId: node.id,
      });
    }
    if (node.maskMode !== undefined && node.maskMode !== "none") {
      return this.#fail(state, {
        code: "unsupported-style",
        message: `Masked operand ${node.id} cannot yet preserve Boolean geometry`,
        nodeId: node.id,
      });
    }
    if (!node.visible) return { ok: true, value: emptyGeometry() };

    const core =
      node.kind === "boolean"
        ? this.#resolveBoolean(state, node.id, depth)
        : this.#baseShape(node);
    if (!core.ok) return this.#fail(state, core.issue);
    const styled = this.#applyOperandAppearance(node, core.value);
    if (!styled.ok) return this.#fail(state, styled.issue);
    if (styled.value.empty) return styled;
    return this.#providerAttempt(
      node.id,
      `transform operand ${node.id}`,
      this.provider.transform(styled.value, node.transform),
    );
  }

  #baseShape(node: Exclude<ShapeNode, BooleanNode>): GeometryAttempt {
    let path: string;
    if (node.kind === "rectangle") {
      path = rectanglePath(
        node.size.width,
        node.size.height,
        node.properties.cornerRadius,
      );
    } else if (node.kind === "ellipse") {
      path = ellipsePath(node.size.width, node.size.height);
    } else if (node.kind === "polygon") {
      if (node.properties.cornerRadius > 0) {
        return {
          ok: false,
          issue: {
            code: "unsupported-style",
            message: `Rounded polygon operand ${node.id} requires an exact outline before Boolean resolution`,
            nodeId: node.id,
          },
        };
      }
      path = closedPointPath(
        resolveRegularPolygonPoints(node.size, node.properties.pointCount),
      );
    } else if (node.kind === "star") {
      if (node.properties.cornerRadius > 0) {
        return {
          ok: false,
          issue: {
            code: "unsupported-style",
            message: `Rounded star operand ${node.id} requires an exact outline before Boolean resolution`,
            nodeId: node.id,
          },
        };
      }
      path = closedPointPath(
        resolveStarPoints(
          node.size,
          node.properties.pointCount,
          node.properties.innerRadius,
        ),
      );
    } else {
      const resolvedPath = resolvePathPropertiesData(node.properties);
      if (resolvedPath === null) {
        return {
          ok: false,
          issue: {
            code: "unsupported-operand",
            message: `Vector network operand ${node.id} is invalid`,
            nodeId: node.id,
          },
        };
      }
      path = resolvedPath;
    }
    return this.#providerAttempt(
      node.id,
      `normalize ${node.kind} operand ${node.id}`,
      this.provider.normalize({
        path,
        ...(node.kind === "path" || node.kind === "vector"
          ? { fillRule: node.properties.fillRule ?? "nonzero" }
          : {}),
      }),
    );
  }

  #applyOperandAppearance(
    node: ShapeNode,
    core: GeometryValue,
  ): GeometryAttempt {
    if (core.empty) return { ok: true, value: core };
    const booleanFillRule =
      node.kind === "boolean" ? node.properties.fillRule : undefined;
    const properties = node.properties;
    const appearanceCore: GeometryValue =
      booleanFillRule !== undefined
        ? { ...core, fillRule: booleanFillRule }
        : core;
    const hasFill =
      (!(node.kind === "path" || node.kind === "vector") ||
        !("network" in node.properties) ||
        vectorNetworkHasFillRegion(node.properties.network)) &&
      properties.fills.some((paint) => paint.visible !== false);
    const hasStroke =
      properties.strokeWidth > 0 &&
      properties.strokes.some((paint) => paint.visible !== false);
    if (!hasFill && !hasStroke) {
      return { ok: true, value: emptyGeometry() };
    }

    let strokeGeometry: GeometryValue | undefined;
    if (hasStroke) {
      const editableStroke = this.#editableVectorStroke(node, appearanceCore);
      if (editableStroke) {
        if (!editableStroke.ok) return editableStroke;
        strokeGeometry = editableStroke.value;
      } else {
        const align = properties.strokeAlign ?? "center";
        const resolvedPath =
          node.kind === "path" || node.kind === "vector"
            ? resolvePathPropertiesData(node.properties)
            : null;
        if (
          align !== "center" &&
          (node.kind === "path" || node.kind === "vector") &&
          (resolvedPath === null || !hasOnlyClosedSubpaths(resolvedPath))
        ) {
          return {
            ok: false,
            issue: {
              code: "unsupported-style",
              message: `Open-path operand ${node.id} cannot preserve ${align}-aligned stroke geometry`,
              nodeId: node.id,
            },
          };
        }
        let strokeSource = appearanceCore;
        const dashPattern = properties.dashPattern ?? [];
        if (dashPattern.length > 0) {
          if (
            dashPattern.length > 2 ||
            dashPattern.some((value) => !Number.isFinite(value) || value <= 0)
          ) {
            return {
              ok: false,
              issue: {
                code: "unsupported-style",
                message: `Operand ${node.id} uses a dash pattern PathKit cannot preserve exactly`,
                nodeId: node.id,
              },
            };
          }
          const on = dashPattern[0]!;
          const off = dashPattern[1] ?? on;
          const dashed = this.#providerAttempt(
            node.id,
            `dash stroke for operand ${node.id}`,
            this.provider.dash(strokeSource, { on, off, phase: 0 }),
          );
          if (!dashed.ok) return dashed;
          strokeSource = dashed.value;
        }
        const outlined = this.#providerAttempt(
          node.id,
          `outline stroke for operand ${node.id}`,
          this.provider.outlineStroke(strokeSource, {
            cap:
              properties.strokeCap === "round"
                ? "round"
                : properties.strokeCap === "square"
                  ? "square"
                  : "butt",
            join: properties.strokeJoin ?? "miter",
            miterLimit: 4,
            width: properties.strokeWidth * (align === "center" ? 1 : 2),
          }),
        );
        if (!outlined.ok) return outlined;
        strokeGeometry = outlined.value;
        if (!outlined.value.empty && align !== "center") {
          const clipped = this.#combine(
            align === "inside" ? "intersect" : "subtract",
            align === "inside"
              ? [appearanceCore, outlined.value]
              : [outlined.value, appearanceCore],
            node.id,
          );
          if (!clipped.ok) return clipped;
          strokeGeometry = clipped.value;
        }
      }
    }

    if (hasFill && strokeGeometry) {
      return this.#combine("union", [appearanceCore, strokeGeometry], node.id);
    }
    return {
      ok: true,
      value: hasFill ? appearanceCore : (strokeGeometry ?? emptyGeometry()),
    };
  }

  #editableVectorStroke(
    node: ShapeNode,
    core: GeometryValue,
  ): GeometryAttempt | null {
    if (
      (node.kind !== "path" && node.kind !== "vector") ||
      !("network" in node.properties)
    ) {
      return null;
    }
    const properties = node.properties;
    const outlined = outlineVectorNetworkStroke(
      properties.network,
      { path: core.path, fillRule: core.fillRule },
      {
        align: properties.strokeAlign ?? "center",
        cap: toVectorStrokeCap(properties.strokeCap),
        cornerRadius: properties.cornerRadius ?? 0,
        cornerSmoothing: properties.cornerSmoothing ?? 0,
        dashPattern: properties.dashPattern ?? [],
        join: properties.strokeJoin ?? "miter",
        miterLimit: 4,
        width: properties.strokeWidth,
      },
      this.provider,
      "boolean_stroke",
    );
    if (!outlined.ok) return this.#unsupportedStroke(node.id, outlined.message);
    const serialized = serializeVectorNetwork(outlined.network);
    if (!serialized.ok) {
      return this.#unsupportedStroke(
        node.id,
        serialized.issues.map((issue) => issue.message).join("; "),
      );
    }
    return this.#providerAttempt(
      node.id,
      `normalize outlined Vector stroke ${node.id}`,
      this.provider.normalize({ path: serialized.path }),
    );
  }

  #unsupportedStroke(nodeId: string, message: string): GeometryAttempt {
    return {
      ok: false,
      issue: {
        code: "unsupported-style",
        message: `Operand ${nodeId} stroke cannot be preserved: ${message}`,
        nodeId,
      },
    };
  }

  #combine(
    operation: VectorBooleanOperation,
    operands: readonly GeometryValue[],
    nodeId: string,
  ): GeometryAttempt {
    if (operands.length === 0) return { ok: true, value: emptyGeometry() };
    let candidates: GeometryValue[];
    if (operation === "intersect") {
      if (operands.some((operand) => operand.empty)) {
        return { ok: true, value: emptyGeometry() };
      }
      candidates = [...operands];
    } else if (operation === "subtract") {
      const first = operands[0];
      if (!first || first.empty) return { ok: true, value: emptyGeometry() };
      candidates = [first, ...operands.slice(1).filter((item) => !item.empty)];
    } else {
      candidates = operands.filter((operand) => !operand.empty);
    }
    if (candidates.length === 0) return { ok: true, value: emptyGeometry() };
    if (candidates.length === 1) return { ok: true, value: candidates[0]! };
    return this.#providerAttempt(
      nodeId,
      `${operation} Boolean ${nodeId}`,
      this.provider.combine(candidates, operation),
    );
  }

  #fingerprintBoolean(
    state: ResolveState,
    node: BooleanNode,
    depth: number,
  ): GeometryAttempt {
    const existing = state.fingerprintByNodeId.get(node.id);
    if (existing !== undefined) {
      return { ok: true, value: fingerprintValue(existing) };
    }
    if (depth > this.#options.maxRecursionDepth) {
      return this.#fail(state, {
        code: "budget-exceeded",
        message: `Boolean ${node.id} exceeds the fingerprint recursion limit`,
        nodeId: node.id,
      });
    }
    const stack = new Set<string>();
    const serialized = this.#serializeBoolean(state, node, depth, stack);
    if (!serialized.ok) return serialized;
    if (serialized.value.path.length > this.#options.maxFingerprintCharacters) {
      return this.#fail(state, {
        code: "budget-exceeded",
        message: `Boolean ${node.id} exceeds the ${this.#options.maxFingerprintCharacters}-character geometry fingerprint limit`,
        nodeId: node.id,
      });
    }
    state.fingerprintByNodeId.set(node.id, serialized.value.path);
    return serialized;
  }

  #serializeBoolean(
    state: ResolveState,
    node: BooleanNode,
    depth: number,
    stack: Set<string>,
  ): GeometryAttempt {
    if (stack.has(node.id)) {
      return this.#fail(state, {
        code: "cyclic-boolean",
        message: `Boolean ${node.id} contains a cyclic operand reference`,
        nodeId: node.id,
      });
    }
    stack.add(node.id);
    try {
      const children: unknown[] = [];
      for (const childId of node.childIds) {
        const child = state.document.nodesById[childId];
        if (!child) {
          return this.#fail(state, {
            code: "missing-node",
            message: `Boolean operand ${childId} is missing`,
            nodeId: childId,
          });
        }
        if (!isShapeNode(child)) {
          return this.#fail(state, {
            code: "unsupported-operand",
            message: `${child.kind} node ${child.id} cannot be converted to Boolean geometry`,
            nodeId: child.id,
          });
        }
        let shape: unknown;
        if (child.kind === "boolean") {
          if (depth + 1 > this.#options.maxRecursionDepth) {
            return this.#fail(state, {
              code: "budget-exceeded",
              message: `Boolean ${child.id} exceeds the fingerprint recursion limit`,
              nodeId: child.id,
            });
          }
          const nested = this.#serializeBoolean(state, child, depth + 1, stack);
          if (!nested.ok) return nested;
          shape = nested.value.path;
        } else if (child.kind === "rectangle") {
          shape = [
            child.size.width,
            child.size.height,
            child.properties.cornerRadius,
          ];
        } else if (child.kind === "ellipse") {
          shape = [child.size.width, child.size.height];
        } else if (child.kind === "polygon") {
          shape = [
            child.size.width,
            child.size.height,
            child.properties.pointCount,
            child.properties.cornerRadius,
          ];
        } else if (child.kind === "star") {
          shape = [
            child.size.width,
            child.size.height,
            child.properties.pointCount,
            child.properties.innerRadius,
            child.properties.cornerRadius,
          ];
        } else {
          const resolvedPath = resolvePathPropertiesData(child.properties);
          if (resolvedPath === null) {
            return this.#fail(state, {
              code: "unsupported-operand",
              message: `Vector network operand ${child.id} is invalid`,
              nodeId: child.id,
            });
          }
          shape = [resolvedPath, child.properties.fillRule ?? "nonzero"];
        }
        children.push([
          child.id,
          child.kind,
          child.visible,
          child.maskMode ?? "none",
          child.transform,
          appearanceGeometrySignature(child),
          shape,
        ]);
      }
      return {
        ok: true,
        value: fingerprintValue(
          JSON.stringify([
            BOOLEAN_GEOMETRY_RESOLVER_VERSION,
            node.properties.operation,
            children,
          ]),
        ),
      };
    } finally {
      stack.delete(node.id);
    }
  }

  #providerAttempt(
    nodeId: string,
    action: string,
    result: VectorGeometryResult,
  ): GeometryAttempt {
    if (!result.ok) {
      return {
        ok: false,
        issue: {
          code: "provider-failure",
          message: `PathKit failed to ${action}: ${result.message}`,
          nodeId,
        },
      };
    }
    return {
      ok: true,
      value: {
        bounds: result.bounds,
        empty: result.empty,
        fillRule: result.fillRule,
        path: result.path,
      },
    };
  }

  #fail(state: ResolveState, issue: BooleanGeometryIssue): GeometryAttempt {
    this.#addIssue(state, issue);
    return { ok: false, issue };
  }

  #addIssue(state: ResolveState, issue: BooleanGeometryIssue): void {
    const key = `${issue.code}\u0000${issue.nodeId}\u0000${issue.message}`;
    if (state.issueKeys.has(key)) return;
    state.issueKeys.add(key);
    state.issues.push(issue);
  }

  #storeCache(
    nodeId: string,
    fingerprint: string,
    result: ResolvedBooleanGeometry,
  ): void {
    const existing = this.#cache.get(nodeId);
    if (existing) {
      this.#cacheCharacters -= existing.characterCost;
      this.#cache.delete(nodeId);
    }
    const characterCost = fingerprint.length + result.path.length;
    if (characterCost > this.#options.maxCacheCharacters) return;
    while (
      this.#cache.size >= this.#options.maxCacheEntries ||
      this.#cacheCharacters + characterCost > this.#options.maxCacheCharacters
    ) {
      const oldestId = this.#cache.keys().next().value;
      if (oldestId === undefined) break;
      const oldest = this.#cache.get(oldestId);
      if (oldest) this.#cacheCharacters -= oldest.characterCost;
      this.#cache.delete(oldestId);
    }
    this.#cache.set(nodeId, { characterCost, fingerprint, result });
    this.#cacheCharacters += characterCost;
  }
}

function appearanceGeometrySignature(node: ShapeNode): unknown {
  const booleanFillRule =
    node.kind === "boolean"
      ? (node.properties.fillRule ?? "derived")
      : undefined;
  const properties = node.properties;
  return [
    (!(node.kind === "path" || node.kind === "vector") ||
      !("network" in node.properties) ||
      vectorNetworkHasFillRegion(node.properties.network)) &&
      properties.fills.some((paint) => paint.visible !== false),
    properties.strokes.some((paint) => paint.visible !== false),
    properties.strokeWidth,
    properties.strokeAlign ?? "center",
    properties.strokeCap ?? "none",
    properties.strokeJoin ?? "miter",
    properties.dashPattern ?? [],
    (node.kind === "path" || node.kind === "vector") &&
    "network" in node.properties
      ? node.properties.network.vertices.map((vertex) => [
          vertex.id,
          vertex.strokeCap,
          vertex.strokeJoin,
        ])
      : [],
    booleanFillRule,
  ];
}

function toVectorStrokeCap(
  cap: "none" | "round" | "square" | undefined,
): "butt" | "round" | "square" {
  return cap === "round" || cap === "square" ? cap : "butt";
}

function fingerprintValue(path: string): GeometryValue {
  return {
    bounds: null,
    empty: path.length === 0,
    fillRule: "nonzero",
    path,
  };
}

function collectPageBooleanNodeIds(
  document: DesignDocument,
  pageId: string,
): string[] {
  const page = document.pagesById[pageId];
  if (!page) return [];
  const result: string[] = [];
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) return;
    if (node.kind === "boolean") result.push(node.id);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  return result;
}

function isShapeNode(node: DesignNode): node is ShapeNode {
  return (
    node.kind === "boolean" ||
    node.kind === "ellipse" ||
    node.kind === "path" ||
    node.kind === "polygon" ||
    node.kind === "rectangle" ||
    node.kind === "star" ||
    node.kind === "vector"
  );
}

function emptyGeometry(): GeometryValue {
  return { bounds: null, empty: true, fillRule: "nonzero", path: "" };
}

function closedPointPath(points: readonly { x: number; y: number }[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${formatPathNumber(point.x)} ${formatPathNumber(point.y)}`,
    )
    .concat("Z")
    .join(" ");
}

function formatPathNumber(value: number): string {
  const normalized = Math.abs(value) < 1e-12 ? 0 : value;
  return Number(normalized.toFixed(12)).toString();
}

function rectanglePath(width: number, height: number, radius: number): string {
  const safeWidth = finiteNonNegative(width);
  const safeHeight = finiteNonNegative(height);
  const safeRadius = Math.min(
    finiteNonNegative(radius),
    safeWidth / 2,
    safeHeight / 2,
  );
  if (safeRadius === 0) {
    return `M0 0H${safeWidth}V${safeHeight}H0Z`;
  }
  const right = safeWidth - safeRadius;
  const bottom = safeHeight - safeRadius;
  return [
    `M${safeRadius} 0`,
    `H${right}`,
    `A${safeRadius} ${safeRadius} 0 0 1 ${safeWidth} ${safeRadius}`,
    `V${bottom}`,
    `A${safeRadius} ${safeRadius} 0 0 1 ${right} ${safeHeight}`,
    `H${safeRadius}`,
    `A${safeRadius} ${safeRadius} 0 0 1 0 ${bottom}`,
    `V${safeRadius}`,
    `A${safeRadius} ${safeRadius} 0 0 1 ${safeRadius} 0Z`,
  ].join("");
}

function ellipsePath(width: number, height: number): string {
  const safeWidth = finiteNonNegative(width);
  const safeHeight = finiteNonNegative(height);
  const radiusX = safeWidth / 2;
  const radiusY = safeHeight / 2;
  const controlX = radiusX * KAPPA;
  const controlY = radiusY * KAPPA;
  return [
    `M${safeWidth} ${radiusY}`,
    `C${safeWidth} ${radiusY - controlY} ${radiusX + controlX} 0 ${radiusX} 0`,
    `C${radiusX - controlX} 0 0 ${radiusY - controlY} 0 ${radiusY}`,
    `C0 ${radiusY + controlY} ${radiusX - controlX} ${safeHeight} ${radiusX} ${safeHeight}`,
    `C${radiusX + controlX} ${safeHeight} ${safeWidth} ${radiusY + controlY} ${safeWidth} ${radiusY}Z`,
  ].join("");
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function hasOnlyClosedSubpaths(path: string): boolean {
  const commands = path.match(/[AaCcHhLlMmQqSsTtVvZz]/g) ?? [];
  let open = false;
  let sawSubpath = false;
  for (const command of commands) {
    if (command === "M" || command === "m") {
      if (open) return false;
      open = true;
      sawSubpath = true;
    } else if (command === "Z" || command === "z") {
      if (!open) return false;
      open = false;
    } else if (sawSubpath && !open) {
      open = true;
    }
  }
  return sawSubpath && !open;
}
