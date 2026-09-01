import {
  DesignNodeSchema,
  RectSchema,
  Type,
  type Rect,
  type Static,
} from "@opendesign/design-contracts";
import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import {
  createSvgIssue,
  SvgInterchangeIssueSchema,
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
import { SVG_MAX_CHARACTERS } from "./limits.js";
import { SVG_IMPORT_MAX_NODES } from "./svg-parse.js";

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

const SvgResultIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const SvgIssueListSchema = Type.Array(SvgInterchangeIssueSchema, {
  maxItems: SVG_IMPORT_MAX_NODES,
});

export const SuccessfulSvgExportResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    version: Type.Literal(SVG_INTERCHANGE_VERSION),
    mimeType: Type.Literal(SVG_MIME_TYPE),
    svg: Type.String({ minLength: 1, maxLength: SVG_MAX_CHARACTERS }),
    viewport: RectSchema,
    exportedNodeIds: Type.Array(SvgResultIdSchema, {
      maxItems: SVG_IMPORT_MAX_NODES,
      uniqueItems: true,
    }),
    issues: SvgIssueListSchema,
  },
  { additionalProperties: false },
);
const FailedSvgInterchangeResultSchema = Type.Object(
  {
    ok: Type.Literal(false),
    version: Type.Literal(SVG_INTERCHANGE_VERSION),
    issues: SvgIssueListSchema,
  },
  { additionalProperties: false },
);
export const SvgExportResultSchema = Type.Union([
  SuccessfulSvgExportResultSchema,
  FailedSvgInterchangeResultSchema,
]);
export type SvgExportResult = Static<typeof SvgExportResultSchema>;

export interface SvgImportRequest {
  svg: string;
  idPrefix: string;
  name?: string;
}

export const SuccessfulSvgImportResultSchema = Type.Object(
  {
    ok: Type.Literal(true),
    version: Type.Literal(SVG_INTERCHANGE_VERSION),
    rootNodeId: SvgResultIdSchema,
    nodes: Type.Array(DesignNodeSchema, {
      minItems: 1,
      maxItems: SVG_IMPORT_MAX_NODES,
    }),
    sourceViewport: RectSchema,
    issues: SvgIssueListSchema,
  },
  { additionalProperties: false },
);
export const SvgImportResultSchema = Type.Union([
  SuccessfulSvgImportResultSchema,
  FailedSvgInterchangeResultSchema,
]);
export type SvgImportResult = Static<typeof SvgImportResultSchema>;

export const SvgExportResultContract = defineContract<SvgExportResult>({
  schema: SvgExportResultSchema,
  code: "svg_interchange.export_result_structure_invalid",
  subject: "SVG export result",
  refine: svgExportResultDomainIssues,
  clone: false,
});

export const SvgImportResultContract = defineContract<SvgImportResult>({
  schema: SvgImportResultSchema,
  code: "svg_interchange.import_result_structure_invalid",
  subject: "SVG import result",
  refine: svgImportResultDomainIssues,
  clone: false,
});

type SvgFailureResult = Extract<SvgExportResult, { ok: false }>;

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
    exportedNodeIds: [...exportedNodeIds],
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
    nodes: [...imported.nodes],
    sourceViewport: { ...imported.sourceViewport },
    issues: [...imported.issues],
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

function svgExportResultDomainIssues(
  result: SvgExportResult,
): ValidationIssue[] {
  if (!result.ok || isFinitePositiveRect(result.viewport)) return [];
  return [invalidResultBounds("/viewport")];
}

function svgImportResultDomainIssues(
  result: SvgImportResult,
): ValidationIssue[] {
  if (!result.ok) return [];
  if (!isFinitePositiveRect(result.sourceViewport)) {
    return [invalidResultBounds("/sourceViewport")];
  }
  const rootCount = result.nodes.filter(
    (node) => node.id === result.rootNodeId,
  ).length;
  if (rootCount !== 1) {
    return [
      {
        code: "svg_interchange.import_root_invalid",
        path: "/rootNodeId",
        message: "Imported SVG root must identify exactly one returned node",
        expected: 1,
        actual: rootCount,
        recovery: "Regenerate the imported node tree from the SVG source.",
      },
    ];
  }
  const nodeIds = new Set<string>();
  for (const [index, node] of result.nodes.entries()) {
    if (nodeIds.has(node.id)) {
      return [
        {
          code: "svg_interchange.import_node_duplicate",
          path: `/nodes/${index}/id`,
          message: "Imported SVG nodes must have unique IDs",
          actual: node.id,
          recovery: "Regenerate the imported node IDs from one stable prefix.",
        },
      ];
    }
    nodeIds.add(node.id);
  }
  return [];
}

function invalidResultBounds(path: string): ValidationIssue {
  return {
    code: "svg_interchange.result_bounds_invalid",
    path,
    message: "SVG result bounds must be finite and positive",
    recovery: "Recompute the SVG source bounds before returning the result.",
  };
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
    issues: [...issues],
  };
}
