import { Type, type Static } from "@sinclair/typebox";
import {
  DesignDiagnosticReportContract,
  DesignDiagnosticReportSchema,
} from "@opendesign/editor-runtime";
import {
  AgentDesignIdAllocationContract,
  AgentDesignIdAllocationSchema,
} from "./design-id-allocation";
import {
  DesignSystemComponentCatalogContract,
  DesignSystemComponentCatalogSchema,
} from "./design-system-component-catalog";
import {
  DesignImageInspectionContract,
  DesignImageInspectionSchema,
} from "./design-image-inspection-contract";
import { defineContract, type ValidationIssue } from "./contract-validation";

const MAX_INSPECTION_HIERARCHY_ISSUES = 64;

const HierarchyIdSchema = Type.String({
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const HierarchyIdsSchema = Type.Array(HierarchyIdSchema, {
  maxItems: 100_000,
  uniqueItems: true,
});
const HierarchySizeSchema = Type.Object(
  {
    width: Type.Number({ minimum: 0 }),
    height: Type.Number({ minimum: 0 }),
  },
  { additionalProperties: true },
);
const HierarchyTransformSchema = Type.Tuple([
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
  Type.Number(),
]);
const InspectedPageSchema = Type.Object(
  {
    id: HierarchyIdSchema,
    rootNodeIds: HierarchyIdsSchema,
  },
  { additionalProperties: true },
);
const InspectedNodeSchema = Type.Object(
  {
    id: HierarchyIdSchema,
    kind: Type.String({ minLength: 1, maxLength: 64 }),
    locked: Type.Boolean(),
    childIds: HierarchyIdsSchema,
    parentId: Type.Union([HierarchyIdSchema, Type.Null()]),
    size: HierarchySizeSchema,
    transform: HierarchyTransformSchema,
    properties: Type.Optional(
      Type.Object(
        {
          assetId: Type.Optional(HierarchyIdSchema),
          componentId: Type.Optional(HierarchyIdSchema),
        },
        { additionalProperties: true },
      ),
    ),
    extensions: Type.Optional(
      Type.Object(
        {
          designRole: Type.Optional(
            Type.String({ minLength: 1, maxLength: 64 }),
          ),
        },
        { additionalProperties: true },
      ),
    ),
  },
  { additionalProperties: true },
);
const InspectedComponentSchema = Type.Object(
  {
    id: HierarchyIdSchema,
    rootNodeId: HierarchyIdSchema,
  },
  { additionalProperties: true },
);
const InspectedDocumentSchema = Type.Object(
  {
    documentId: HierarchyIdSchema,
    revision: Type.Integer({ minimum: 0 }),
    pagesById: Type.Record(HierarchyIdSchema, InspectedPageSchema, {
      maxProperties: 10_000,
    }),
    nodesById: Type.Record(HierarchyIdSchema, InspectedNodeSchema, {
      maxProperties: 100_000,
    }),
    componentsById: Type.Optional(
      Type.Record(HierarchyIdSchema, InspectedComponentSchema, {
        maxProperties: 10_000,
      }),
    ),
    componentCatalog: Type.Optional(DesignSystemComponentCatalogSchema),
    ...DesignImageInspectionSchema.properties,
  },
  { additionalProperties: true },
);

export const DesignInspectionHierarchySchema = Type.Object(
  {
    observedRevision: Type.Integer({ minimum: 0 }),
    content: Type.Object(
      {
        idAllocation: Type.Optional(AgentDesignIdAllocationSchema),
        document: InspectedDocumentSchema,
        diagnostics: Type.Optional(DesignDiagnosticReportSchema),
      },
      { additionalProperties: true },
    ),
  },
  { additionalProperties: false },
);

export type DesignInspectionHierarchy = Static<
  typeof DesignInspectionHierarchySchema
>;
export type DesignInspectionHierarchyContext = {
  documentId: string;
  runId: string;
};

export const DesignInspectionHierarchyContract = defineContract<
  DesignInspectionHierarchy,
  DesignInspectionHierarchy,
  DesignInspectionHierarchyContext
>({
  schema: DesignInspectionHierarchySchema,
  code: "design_inspection_hierarchy.schema_invalid",
  subject: "design inspection hierarchy",
  maximum: 64,
  clone: false,
  refine: inspectionHierarchyIssues,
});

function inspectionHierarchyIssues(
  value: DesignInspectionHierarchy,
  context: DesignInspectionHierarchyContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { document } = value.content;
  if (document.documentId !== context.documentId) {
    issues.push(
      issue(
        "design_inspection_hierarchy.document_mismatch",
        "/content/document/documentId",
        "Inspected documentId must match the Run-bound Design File",
        context.documentId,
        document.documentId,
      ),
    );
  }
  if (document.revision !== value.observedRevision) {
    issues.push(
      issue(
        "design_inspection_hierarchy.revision_mismatch",
        "/content/document/revision",
        "Inspected document revision must match observedRevision",
        value.observedRevision,
        document.revision,
      ),
    );
  }
  if (value.content.idAllocation) {
    issues.push(
      ...prefixIssues(
        AgentDesignIdAllocationContract.issues(value.content.idAllocation, {
          runId: context.runId,
        }),
        "/content/idAllocation",
      ),
    );
  }
  if (document.componentCatalog) {
    issues.push(
      ...prefixIssues(
        DesignSystemComponentCatalogContract.issues(document.componentCatalog),
        "/content/document/componentCatalog",
      ),
    );
  }
  issues.push(
    ...prefixIssues(
      DesignImageInspectionContract.issues({
        assetsById: document.assetsById,
        imageAssetDerivations: document.imageAssetDerivations,
        imageAssetDerivationsTruncated: document.imageAssetDerivationsTruncated,
      }),
      "/content/document",
    ),
  );
  if (value.content.diagnostics) {
    issues.push(
      ...prefixIssues(
        DesignDiagnosticReportContract.issues(value.content.diagnostics),
        "/content/diagnostics",
      ),
      ...diagnosticCorrelationIssues(value),
    );
  }
  issues.push(...identityIssues(document));
  issues.push(...relationshipIssues(document));
  return issues.slice(0, MAX_INSPECTION_HIERARCHY_ISSUES);
}

function diagnosticCorrelationIssues(
  inspection: DesignInspectionHierarchy,
): ValidationIssue[] {
  const diagnostics = inspection.content.diagnostics;
  if (!diagnostics) return [];
  const { document } = inspection.content;
  const issues: ValidationIssue[] = [];
  if (diagnostics.documentId !== document.documentId) {
    issues.push(
      issue(
        "design_inspection_hierarchy.diagnostic_document_mismatch",
        "/content/diagnostics/documentId",
        "Diagnostic documentId must match inspected documentId",
        document.documentId,
        diagnostics.documentId,
      ),
    );
  }
  if (diagnostics.revision !== inspection.observedRevision) {
    issues.push(
      issue(
        "design_inspection_hierarchy.diagnostic_revision_mismatch",
        "/content/diagnostics/revision",
        "Diagnostic revision must match observedRevision",
        inspection.observedRevision,
        diagnostics.revision,
      ),
    );
  }
  const expectedPages = Object.keys(document.pagesById).sort();
  const actualPages = [...diagnostics.pageIds].sort();
  if (JSON.stringify(actualPages) !== JSON.stringify(expectedPages)) {
    issues.push({
      code: "design_inspection_hierarchy.diagnostic_pages_mismatch",
      path: "/content/diagnostics/pageIds",
      message: "Diagnostic Page scope must match inspected pagesById",
      expected: expectedPages,
      actual: actualPages,
      recovery: "Regenerate diagnostics for the exact inspected Page scope.",
    });
  }
  return issues;
}

function identityIssues(
  document: DesignInspectionHierarchy["content"]["document"],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [pageId, page] of Object.entries(document.pagesById)) {
    if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
    if (page.id !== pageId) {
      issues.push(
        issue(
          "design_inspection_hierarchy.page_identity_mismatch",
          `/content/document/pagesById/${escapePath(pageId)}/id`,
          "Page map key must match Page id",
          pageId,
          page.id,
        ),
      );
    }
  }
  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
    if (node.id !== nodeId) {
      issues.push(
        issue(
          "design_inspection_hierarchy.node_identity_mismatch",
          `/content/document/nodesById/${escapePath(nodeId)}/id`,
          "Node map key must match node id",
          nodeId,
          node.id,
        ),
      );
    }
  }
  for (const [componentId, component] of Object.entries(
    document.componentsById ?? {},
  )) {
    if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
    if (component.id !== componentId) {
      issues.push(
        issue(
          "design_inspection_hierarchy.component_identity_mismatch",
          `/content/document/componentsById/${escapePath(componentId)}/id`,
          "Component map key must match Component id",
          componentId,
          component.id,
        ),
      );
    }
  }
  return issues;
}

function relationshipIssues(
  document: DesignInspectionHierarchy["content"]["document"],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const cyclicNodeIds = parentCycleNodeIds(document.nodesById);
  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
    if (node.parentId && !document.nodesById[node.parentId]) {
      issues.push(
        relationshipIssue(nodeId, "parentId", "Parent node is missing"),
      );
    }
    for (const [index, childId] of node.childIds.entries()) {
      if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
      if (document.nodesById[childId]?.parentId !== nodeId) {
        issues.push(
          relationshipIssue(
            nodeId,
            `childIds/${index}`,
            "Child parentId must point back to its containing node",
          ),
        );
      }
    }
    if (cyclicNodeIds.has(nodeId)) {
      issues.push(
        relationshipIssue(nodeId, "parentId", "Parent chain must be acyclic"),
      );
    }
  }
  for (const [pageId, page] of Object.entries(document.pagesById)) {
    if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
    for (const [index, rootId] of page.rootNodeIds.entries()) {
      if (issues.length >= MAX_INSPECTION_HIERARCHY_ISSUES) break;
      if (document.nodesById[rootId]?.parentId !== null) {
        issues.push({
          code: "design_inspection_hierarchy.page_root_invalid",
          path: `/content/document/pagesById/${escapePath(pageId)}/rootNodeIds/${index}`,
          message: "Page root must exist and have parentId null",
          actual: rootId,
          recovery:
            "Regenerate inspection from the current authoritative document.",
        });
      }
    }
  }
  return issues;
}

function parentCycleNodeIds(
  nodesById: DesignInspectionHierarchy["content"]["document"]["nodesById"],
): Set<string> {
  const cyclic = new Set<string>();
  const resolved = new Set<string>();
  for (const nodeId of Object.keys(nodesById)) {
    if (resolved.has(nodeId)) continue;
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let current: string | null = nodeId;
    while (current && !resolved.has(current) && nodesById[current]) {
      const cycleStart = pathIndex.get(current);
      if (cycleStart !== undefined) {
        for (const cyclicId of path.slice(cycleStart)) cyclic.add(cyclicId);
        break;
      }
      pathIndex.set(current, path.length);
      path.push(current);
      current = nodesById[current]?.parentId ?? null;
    }
    for (const visitedId of path) resolved.add(visitedId);
  }
  return cyclic;
}

function relationshipIssue(
  nodeId: string,
  field: string,
  message: string,
): ValidationIssue {
  return {
    code: "design_inspection_hierarchy.relationship_invalid",
    path: `/content/document/nodesById/${escapePath(nodeId)}/${field}`,
    message,
    recovery: "Regenerate inspection from the current authoritative document.",
  };
}

function issue(
  code: string,
  path: string,
  message: string,
  expected: string | number,
  actual: string | number,
): ValidationIssue {
  return {
    code,
    path,
    message,
    expected,
    actual,
    recovery: "Inspect the current Run-bound Design File again.",
  };
}

function prefixIssues(
  issues: readonly ValidationIssue[],
  prefix: string,
): ValidationIssue[] {
  return issues.map((entry) => ({
    ...entry,
    path: entry.path === "/" ? prefix : `${prefix}${entry.path}`,
  }));
}

function escapePath(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
