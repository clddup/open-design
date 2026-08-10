import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  DesignDocumentSchema,
  type DesignDocument,
  type DesignNode,
  type DesignPage,
  type EllipseNode,
  type FrameNode,
  type ImageNode,
  type RectangleNode,
  type TextNode,
  migrateDesignDocument,
  schemaValidationIssues,
} from "@opendesign/design-contracts";

export interface DocumentInvariantIssue {
  path: string;
  message: string;
}

export class DocumentValidationError extends Error {
  readonly issues: readonly DocumentInvariantIssue[];

  constructor(issues: readonly DocumentInvariantIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "DocumentValidationError";
    this.issues = issues;
  }
}

export function normalizeDesignDocument(value: unknown): DesignDocument {
  const migrated = migrateDesignDocument(value);
  if (!migrated) {
    throw new DocumentValidationError(
      schemaValidationIssues(DesignDocumentSchema, value),
    );
  }

  const document = structuredClone(migrated);
  const issues = validateDocumentInvariants(document);
  if (issues.length > 0) throw new DocumentValidationError(issues);
  return deepFreeze(document);
}

export function validateDocumentInvariants(
  document: DesignDocument,
): DocumentInvariantIssue[] {
  const issues: DocumentInvariantIssue[] = [];
  const pageIds = new Set(document.pageOrder);

  for (const [pageId, page] of Object.entries(document.pagesById)) {
    if (page.id !== pageId) {
      issues.push({
        path: `/pagesById/${pageId}/id`,
        message: "page id must match its map key",
      });
    }
    if (!pageIds.has(pageId)) {
      issues.push({
        path: `/pagesById/${pageId}`,
        message: "page must be present in pageOrder",
      });
    }
  }

  for (const pageId of document.pageOrder) {
    if (!hasOwn(document.pagesById, pageId)) {
      issues.push({
        path: "/pageOrder",
        message: `page ${pageId} does not exist`,
      });
    }
  }

  for (const [assetId, asset] of Object.entries(document.assetsById)) {
    if (asset.id !== assetId) {
      issues.push({
        path: `/assetsById/${assetId}/id`,
        message: "asset id must match its map key",
      });
    }
  }

  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    if (node.id !== nodeId) {
      issues.push({
        path: `/nodesById/${nodeId}/id`,
        message: "node id must match its map key",
      });
    }
    if (!isContainer(node) && node.childIds.length > 0) {
      issues.push({
        path: `/nodesById/${nodeId}/childIds`,
        message: `${node.kind} nodes cannot contain children`,
      });
    }
    if (node.kind === "boolean") {
      if (node.childIds.length < 2) {
        issues.push({
          path: `/nodesById/${nodeId}/childIds`,
          message: "boolean nodes require at least two operands",
        });
      }
      for (const [index, childId] of node.childIds.entries()) {
        const child = ownValue(document.nodesById, childId);
        if (child && !isBooleanOperand(child)) {
          issues.push({
            path: `/nodesById/${nodeId}/childIds/${index}`,
            message: `${child.kind} nodes cannot be boolean operands`,
          });
        }
      }
    }
    if (node.kind === "image") {
      const asset = ownValue(document.assetsById, node.properties.assetId);
      if (!asset || asset.kind !== "image") {
        issues.push({
          path: `/nodesById/${nodeId}/properties/assetId`,
          message: `image asset ${node.properties.assetId} does not exist`,
        });
      }
    }
    if (
      node.kind === "frame" ||
      node.kind === "rectangle" ||
      node.kind === "ellipse" ||
      node.kind === "text" ||
      node.kind === "path" ||
      node.kind === "vector" ||
      node.kind === "boolean"
    ) {
      for (const [paintIndex, paint] of [
        ...node.properties.fills,
        ...node.properties.strokes,
      ].entries()) {
        if (paint.type !== "image") continue;
        const asset = ownValue(document.assetsById, paint.assetId);
        if (!asset || asset.kind !== "image") {
          issues.push({
            path: `/nodesById/${nodeId}/properties/paints/${paintIndex}/assetId`,
            message: `image paint asset ${paint.assetId} does not exist`,
          });
        }
      }
    }
  }

  const occurrences = new Map<string, string[]>();
  const visited = new Set<string>();
  const visiting = new Set<string>();

  const visit = (
    nodeId: string,
    pageId: string,
    expectedParentId: string | null,
    path: string,
  ): void => {
    const node = ownValue(document.nodesById, nodeId);
    if (!node) {
      issues.push({ path, message: `node ${nodeId} does not exist` });
      return;
    }

    const locations = occurrences.get(nodeId) ?? [];
    locations.push(path);
    occurrences.set(nodeId, locations);
    if (visiting.has(nodeId)) {
      issues.push({ path, message: `node ${nodeId} creates a cycle` });
      return;
    }
    if (locations.length > 1) return;

    if (node.parentId !== expectedParentId) {
      issues.push({
        path: `/nodesById/${nodeId}/parentId`,
        message: `expected parent ${expectedParentId ?? "null"}`,
      });
    }
    if (visited.has(nodeId)) return;

    visiting.add(nodeId);
    for (const [index, childId] of node.childIds.entries()) {
      visit(
        childId,
        pageId,
        nodeId,
        `/pagesById/${pageId}/nodes/${nodeId}/childIds/${index}`,
      );
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const pageId of document.pageOrder) {
    const page = ownValue(document.pagesById, pageId);
    if (!page) continue;
    for (const [index, nodeId] of page.rootNodeIds.entries()) {
      visit(nodeId, pageId, null, `/pagesById/${pageId}/rootNodeIds/${index}`);
    }
  }

  for (const nodeId of Object.keys(document.nodesById)) {
    const locations = occurrences.get(nodeId) ?? [];
    if (locations.length === 0) {
      issues.push({
        path: `/nodesById/${nodeId}`,
        message: "node is not reachable from a page",
      });
    } else if (locations.length > 1) {
      issues.push({
        path: `/nodesById/${nodeId}`,
        message: "node appears more than once in the document tree",
      });
    }
  }

  return issues;
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function canonicalJsonStringify(value: unknown): string {
  const ancestors = new Set<object>();

  const stringify = (current: unknown): string => {
    if (current === null) return "null";
    if (typeof current === "string") return JSON.stringify(current);
    if (typeof current === "boolean") return current ? "true" : "false";
    if (typeof current === "number") {
      return Number.isFinite(current) ? String(current) : "null";
    }
    if (typeof current !== "object") {
      throw new TypeError("Value is not JSON serializable");
    }
    if (ancestors.has(current)) {
      throw new TypeError("Value contains a cyclic structure");
    }

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return `[${current.map((item) => stringify(item)).join(",")}]`;
      }
      const record = current as Record<string, unknown>;
      const entries = Object.keys(record)
        .sort()
        .filter((key) => record[key] !== undefined)
        .map((key) => `${JSON.stringify(key)}:${stringify(record[key])}`);
      return `{${entries.join(",")}}`;
    } finally {
      ancestors.delete(current);
    }
  };

  return stringify(value);
}

export function documentContentFingerprint(document: DesignDocument): string {
  const clone = structuredClone(document);
  clone.revision = 0;
  return canonicalJsonStringify(clone);
}

export function createEmptyDesignDocument(
  documentId = "document_welcome",
  pageId = "page_main",
): DesignDocument {
  return normalizeDesignDocument({
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId,
    revision: 0,
    pageOrder: [pageId],
    pagesById: {
      [pageId]: {
        id: pageId,
        name: "Page 1",
        rootNodeIds: [],
        extensions: {},
      },
    },
    nodesById: {},
    componentsById: {},
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
    extensions: {},
  });
}

export function createWelcomeDocument(): DesignDocument {
  const page: DesignPage = {
    id: "page_welcome",
    name: "Welcome",
    rootNodeIds: ["frame_welcome"],
    extensions: {},
  };
  const frame = frameNode({
    id: "frame_welcome",
    name: "Welcome canvas",
    parentId: null,
    childIds: [
      "shape_accent",
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
    ],
    transform: [1, 0, 0, 1, 80, 64],
    size: { width: 1120, height: 720 },
    fill: "#f7f7f5",
    cornerRadius: 24,
  });
  const accent = rectangleNode({
    id: "shape_accent",
    name: "Accent",
    parentId: frame.id,
    transform: [1, 0, 0, 1, 64, 64],
    size: { width: 56, height: 8 },
    fill: "#2563eb",
    cornerRadius: 4,
  });
  const title = textNode({
    id: "title_welcome",
    name: "Title",
    parentId: frame.id,
    transform: [1, 0, 0, 1, 64, 108],
    size: { width: 720, height: 72 },
    content: "Design without losing the thread.",
    fontSize: 48,
    lineHeight: 58,
    fill: "#151515",
  });
  const subtitle = textNode({
    id: "subtitle_welcome",
    name: "Subtitle",
    parentId: frame.id,
    transform: [1, 0, 0, 1, 68, 200],
    size: { width: 650, height: 62 },
    content:
      "A local, inspectable canvas where people and agents share the same design history.",
    fontSize: 20,
    lineHeight: 30,
    fill: "#55534f",
  });
  const featureGroup: DesignNode = {
    id: "feature_group",
    kind: "group",
    name: "Capabilities",
    parentId: frame.id,
    childIds: ["feature_one", "feature_two", "feature_three"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 64, 340],
    size: { width: 992, height: 252 },
    opacity: 1,
    properties: {},
    extensions: {},
  };
  const features = [
    rectangleNode({
      id: "feature_one",
      name: "Structured editing",
      parentId: featureGroup.id,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 304, height: 220 },
      fill: "#ffffff",
      cornerRadius: 16,
    }),
    rectangleNode({
      id: "feature_two",
      name: "Atomic changes",
      parentId: featureGroup.id,
      transform: [1, 0, 0, 1, 336, 0],
      size: { width: 304, height: 220 },
      fill: "#e8efff",
      cornerRadius: 16,
    }),
    ellipseNode({
      id: "feature_three",
      name: "Shared history",
      parentId: featureGroup.id,
      transform: [1, 0, 0, 1, 720, 24],
      size: { width: 172, height: 172 },
      fill: "#f5b942",
    }),
  ];

  return normalizeDesignDocument({
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "document_welcome",
    revision: 0,
    pageOrder: [page.id],
    pagesById: { [page.id]: page },
    nodesById: Object.fromEntries(
      [frame, accent, title, subtitle, featureGroup, ...features].map(
        (node) => [node.id, node],
      ),
    ),
    componentsById: {},
    variantSetsById: {},
    tokenCollectionsById: {},
    tokensById: {},
    interactionsById: {},
    assetsById: {},
    extensions: { template: "welcome" },
  });
}

interface BaseNodeOptions {
  id: string;
  name: string;
  parentId: string | null;
  transform: [number, number, number, number, number, number];
  size: { width: number; height: number };
}

function frameNode(
  options: BaseNodeOptions & {
    childIds: string[];
    fill: string;
    cornerRadius: number;
  },
): FrameNode {
  return {
    ...nodeBase(options),
    kind: "frame",
    childIds: options.childIds,
    properties: {
      fills: [solid(options.fill)],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: options.cornerRadius,
      clipsContent: true,
    },
  };
}

function rectangleNode(
  options: BaseNodeOptions & { fill: string; cornerRadius: number },
): RectangleNode {
  return {
    ...nodeBase(options),
    kind: "rectangle",
    childIds: [],
    properties: {
      fills: [solid(options.fill)],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: options.cornerRadius,
    },
  };
}

function ellipseNode(options: BaseNodeOptions & { fill: string }): EllipseNode {
  return {
    ...nodeBase(options),
    kind: "ellipse",
    childIds: [],
    properties: {
      fills: [solid(options.fill)],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function textNode(
  options: BaseNodeOptions & {
    content: string;
    fontSize: number;
    lineHeight: number;
    fill: string;
  },
): TextNode {
  return {
    ...nodeBase(options),
    kind: "text",
    childIds: [],
    properties: {
      content: options.content,
      fontFamily: "Inter",
      fontSize: options.fontSize,
      fontWeight: 600,
      lineHeight: options.lineHeight,
      letterSpacing: -0.5,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      fills: [solid(options.fill)],
      strokes: [],
      strokeWidth: 0,
    },
  };
}

function nodeBase(options: BaseNodeOptions) {
  return {
    id: options.id,
    name: options.name,
    parentId: options.parentId,
    visible: true,
    locked: false,
    transform: options.transform,
    size: options.size,
    opacity: 1,
    extensions: {},
  };
}

function solid(color: string) {
  return { type: "solid" as const, color, opacity: 1 };
}

function hasOwn(record: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function ownValue<T>(record: Record<string, T>, key: string): T | undefined {
  return hasOwn(record, key) ? record[key] : undefined;
}

function isContainer(node: DesignNode): boolean {
  return (
    node.kind === "frame" || node.kind === "group" || node.kind === "boolean"
  );
}

function isBooleanOperand(node: DesignNode): boolean {
  return (
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  );
}

export type { ImageNode };
