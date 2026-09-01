import {
  DESIGN_FORMAT,
  DESIGN_SCHEMA_VERSION,
  DesignDocumentContract,
  DesignDocumentSchema,
  type DesignDocument,
  type DesignNode,
  type DesignPage,
  type EllipseNode,
  type FrameNode,
  type ImageNode,
  type RectangleNode,
  type TextNode,
  defaultAdvancedTextDecoration,
  migrateDesignDocument,
  schemaValidationIssues,
} from "@opendesign/design-contracts";
import { canonicalJsonStringify } from "./document-fingerprint.js";
import { defaultPageName } from "./page-naming.js";
import { validateDocumentInvariants } from "./document-invariants.js";
import type { DocumentInvariantIssue } from "./layout-document-invariants.js";

export { canonicalJsonStringify } from "./document-fingerprint.js";
export { validateDocumentInvariants } from "./document-invariants.js";

export type { DocumentInvariantIssue } from "./layout-document-invariants.js";

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
    const contractIssues = DesignDocumentContract.issues(value).map(
      ({ code, path, message, expected, actual, recovery }) => ({
        code,
        path,
        message,
        ...(expected === undefined ? {} : { expected }),
        ...(actual === undefined ? {} : { actual }),
        ...(recovery === undefined ? {} : { recovery }),
      }),
    );
    throw new DocumentValidationError(
      contractIssues.length > 0
        ? contractIssues
        : schemaValidationIssues(DesignDocumentSchema, value),
    );
  }

  const document = structuredClone(migrated);
  const issues = validateDocumentInvariants(document);
  if (issues.length > 0) throw new DocumentValidationError(issues);
  return deepFreeze(document);
}

export function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
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
        name: defaultPageName(1),
        rootNodeIds: [],
        extensions: {},
      },
    },
    nodesById: {},
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
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
    exportSettings: [],
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
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
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
      runs: [],
      fontFamily: "Inter",
      fontStyleName: "Semi Bold",
      fontSize: options.fontSize,
      fontWeight: 600,
      fontSlant: "normal",
      lineHeight: options.lineHeight,
      letterSpacing: -0.5,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      paragraphRuns: [],
      textCase: "original",
      textDecoration: "none",
      ...defaultAdvancedTextDecoration("none"),
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "clip",
      textTruncation: "disabled",
      maxLines: null,
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
    exportSettings: [],
    extensions: {},
  };
}

function solid(color: string) {
  return { type: "solid" as const, color, opacity: 1 };
}

export type { ImageNode };
