import { describe, expect, it } from "vitest";
import { createAgentDesignIdAllocation } from "./design-id-allocation";
import {
  DesignInspectionHierarchyContract,
  type DesignInspectionHierarchy,
} from "./design-inspection-hierarchy-contract";

const context = { documentId: "document_1", runId: "run_1" };

function inspection(): DesignInspectionHierarchy {
  return {
    observedRevision: 4,
    content: {
      idAllocation: createAgentDesignIdAllocation("run_1"),
      document: {
        documentId: "document_1",
        revision: 4,
        pageOrder: ["page_1"],
        pagesById: {
          page_1: { id: "page_1", name: "Page 1", rootNodeIds: ["frame_1"] },
        },
        nodesById: {
          frame_1: {
            id: "frame_1",
            kind: "frame",
            name: "Frame 1",
            locked: false,
            childIds: ["title_1"],
            parentId: null,
            size: { width: 1440, height: 900 },
            transform: [1, 0, 0, 1, 0, 0],
            properties: {},
          },
          title_1: {
            id: "title_1",
            kind: "text",
            locked: false,
            childIds: [],
            parentId: "frame_1",
            size: { width: 320, height: 48 },
            transform: [1, 0, 0, 1, 48, 48],
            properties: {},
          },
        },
        componentsById: {},
      },
      otherProjection: { warnings: [] },
    },
  } as DesignInspectionHierarchy;
}

describe("design inspection hierarchy contract", () => {
  it("accepts the hierarchy projection while preserving unrelated inspection fields", () => {
    expect(
      DesignInspectionHierarchyContract.parse(inspection(), context).ok,
    ).toBe(true);
  });

  it("reports structural fields before hierarchy relationships", () => {
    const input = inspection();
    input.content.document.nodesById.frame_1.transform = [
      1, 0, 0, 1, 0,
    ] as never;
    expect(DesignInspectionHierarchyContract.issues(input, context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "/content/document/nodesById/frame_1/transform",
        }),
      ]),
    );
  });

  it("returns stable paths for identity, parent, cycle, and Run allocation", () => {
    const identity = inspection();
    identity.content.document.nodesById.frame_1.id = "other";
    expect(
      DesignInspectionHierarchyContract.issues(identity, context),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_inspection_hierarchy.node_identity_mismatch",
        path: "/content/document/nodesById/frame_1/id",
      }),
    );

    const missingParent = inspection();
    missingParent.content.document.nodesById.title_1.parentId = "missing";
    expect(
      DesignInspectionHierarchyContract.issues(missingParent, context),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_inspection_hierarchy.relationship_invalid",
        path: "/content/document/nodesById/title_1/parentId",
      }),
    );

    const cycle = inspection();
    cycle.content.document.nodesById.frame_1.parentId = "title_1";
    expect(DesignInspectionHierarchyContract.issues(cycle, context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_inspection_hierarchy.relationship_invalid",
          path: "/content/document/nodesById/frame_1/parentId",
        }),
      ]),
    );

    const wrongRun = inspection();
    wrongRun.content.idAllocation = createAgentDesignIdAllocation("run_2");
    expect(
      DesignInspectionHierarchyContract.issues(wrongRun, context),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_design_id_allocation.run_mismatch",
        path: "/content/idAllocation/newNodeIdPrefix",
      }),
    );
  });

  it("correlates diagnostic identity, revision, and Page scope", () => {
    const input = inspection();
    input.content.diagnostics = {
      version: 1,
      documentId: "document_other",
      revision: 3,
      pageIds: ["page_other"],
      checkedNodeCount: 0,
      errorCount: 0,
      warningCount: 0,
      features: {
        blends: 0,
        blurs: 0,
        glows: 0,
        gradients: 0,
        images: 0,
        masks: 0,
        paths: 0,
        text: 0,
      },
      items: [],
    };
    expect(DesignInspectionHierarchyContract.issues(input, context)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_inspection_hierarchy.diagnostic_document_mismatch",
          path: "/content/diagnostics/documentId",
        }),
        expect.objectContaining({
          code: "design_inspection_hierarchy.diagnostic_revision_mismatch",
          path: "/content/diagnostics/revision",
        }),
        expect.objectContaining({
          code: "design_inspection_hierarchy.diagnostic_pages_mismatch",
          path: "/content/diagnostics/pageIds",
        }),
      ]),
    );
  });
});
