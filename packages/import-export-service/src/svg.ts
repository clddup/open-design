import type { DesignNode, Rect } from "@opendesign/design-contracts";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  createSvgIssue,
  svgIssuesHaveErrors,
  type SvgInterchangeIssue,
  type SvgInterchangeIssueCode,
} from "./svg-issues.js";
import {
  exportSvgNodeRoots,
  type SvgNodeExportRequest,
} from "./svg-export-nodes.js";
import { importSvgNodes } from "./svg-import-nodes.js";
import { parseSvgImportSource } from "./svg-parse.js";
import {
  createSvgExportDocument,
  serializeSvgExportDocument,
} from "./svg-serialize.js";

export * from "./svg-issues.js";
export {
  resolvedBooleanPathsForSvg,
  type SvgResolvedBooleanPath,
} from "./svg-export-nodes.js";

export const SVG_INTERCHANGE_VERSION = 1 as const;
export const SVG_MIME_TYPE = "image/svg+xml" as const;

export interface SvgExportRequest extends SvgNodeExportRequest {
  rootNodeIds: readonly string[];
  viewport: Rect;
  title?: string;
}

export type SvgExportResult =
  | {
      ok: true;
      version: typeof SVG_INTERCHANGE_VERSION;
      mimeType: typeof SVG_MIME_TYPE;
      svg: string;
      viewport: Rect;
      exportedNodeIds: readonly string[];
      issues: readonly SvgInterchangeIssue[];
    }
  | {
      ok: false;
      version: typeof SVG_INTERCHANGE_VERSION;
      issues: readonly SvgInterchangeIssue[];
    };

export interface SvgImportRequest {
  svg: string;
  idPrefix: string;
  name?: string;
}

export type SvgImportResult =
  | {
      ok: true;
      version: typeof SVG_INTERCHANGE_VERSION;
      rootNodeId: string;
      nodes: readonly DesignNode[];
      sourceViewport: Rect;
      issues: readonly SvgInterchangeIssue[];
    }
  | {
      ok: false;
      version: typeof SVG_INTERCHANGE_VERSION;
      issues: readonly SvgInterchangeIssue[];
    };

interface SvgFailureResult {
  ok: false;
  version: typeof SVG_INTERCHANGE_VERSION;
  issues: readonly SvgInterchangeIssue[];
}

export function exportSvg(request: SvgExportRequest): SvgExportResult {
  const issues: SvgInterchangeIssue[] = [];
  if (!isFinitePositiveRect(request.viewport)) {
    return failure(
      "invalid-dimension",
      "SVG export viewport must be finite and positive",
    );
  }
  if (request.rootNodeIds.length === 0) {
    return failure(
      "invalid-root",
      "SVG export requires at least one root node",
    );
  }
  const rootSet = new Set(request.rootNodeIds);
  if (rootSet.size !== request.rootNodeIds.length) {
    return failure("invalid-root", "SVG export root node IDs must be unique");
  }
  for (const rootNodeId of request.rootNodeIds) {
    const node = request.document.nodesById[rootNodeId];
    if (!node) {
      issues.push(
        createSvgIssue(
          "invalid-root",
          "error",
          `SVG export root ${rootNodeId} does not exist`,
          { nodeId: rootNodeId },
        ),
      );
      continue;
    }
    let parentId = node.parentId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      if (rootSet.has(parentId)) {
        issues.push(
          createSvgIssue(
            "invalid-root",
            "error",
            `SVG export root ${rootNodeId} is already contained by selected root ${parentId}`,
            { nodeId: rootNodeId },
          ),
        );
        break;
      }
      seen.add(parentId);
      parentId = request.document.nodesById[parentId]?.parentId ?? null;
    }
  }
  if (svgIssuesHaveErrors(issues)) return failed(issues);

  const exportDocument = createSvgExportDocument({
    version: SVG_INTERCHANGE_VERSION,
    viewport: request.viewport,
    ...(request.title === undefined ? {} : { title: request.title }),
  });
  const { definitions, document: xmlDocument, root } = exportDocument;
  const exportedNodeIds = exportSvgNodeRoots({
    definitions,
    document: xmlDocument,
    issues,
    request,
    root,
    rootNodeIds: request.rootNodeIds,
  });
  if (svgIssuesHaveErrors(issues)) return failed(issues);
  const serialized = serializeSvgExportDocument(exportDocument);
  if (!serialized.ok) return failed([serialized.issue]);
  return {
    ok: true,
    version: SVG_INTERCHANGE_VERSION,
    mimeType: SVG_MIME_TYPE,
    svg: serialized.svg,
    viewport: { ...request.viewport },
    exportedNodeIds,
    issues,
  };
}

export function importSvg(
  request: SvgImportRequest,
  geometry: VectorGeometryProvider,
): SvgImportResult {
  const parsed = parseSvgImportSource(request);
  if (!parsed.ok) return failed(parsed.issues);
  const { root, sourceViewport } = parsed.value;
  const imported = importSvgNodes({
    geometry,
    idPrefix: request.idPrefix,
    root,
    sourceViewport,
    version: SVG_INTERCHANGE_VERSION,
    ...(request.name === undefined ? {} : { name: request.name }),
  });
  if (!imported.ok) return failed(imported.issues);
  return {
    ok: true,
    version: SVG_INTERCHANGE_VERSION,
    rootNodeId: imported.rootNodeId,
    nodes: imported.nodes,
    sourceViewport: imported.sourceViewport,
    issues: imported.issues,
  };
}

function isFinitePositiveRect(value: Rect): boolean {
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0
  );
}

function failure(
  code: SvgInterchangeIssueCode,
  message: string,
): SvgFailureResult {
  return failed([createSvgIssue(code, "error", message)]);
}

function failed(issues: readonly SvgInterchangeIssue[]): SvgFailureResult {
  return {
    ok: false,
    version: SVG_INTERCHANGE_VERSION,
    issues,
  };
}
