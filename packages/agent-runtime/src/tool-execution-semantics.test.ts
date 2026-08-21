import { describe, expect, it } from "vitest";
import {
  projectToolResultForModel,
  validateDesignRevision,
} from "./tool-execution-semantics.js";

describe("tool result model projection", () => {
  it("keeps revision and stable IDs but omits complete node snapshots from design diffs", () => {
    const result = {
      ok: true,
      revision: 8,
      committedSteps: [{ stepIds: ["hero"], label: "Build hero", revision: 8 }],
      changes: {
        documentId: "document_1",
        fromRevision: 7,
        toRevision: 8,
        addedNodeIds: ["hero", "hero_title"],
        changedNodeIds: [],
        removedNodeIds: [],
        changes: [
          {
            type: "added",
            nodeId: "hero_title",
            after: {
              id: "hero_title",
              properties: { content: "x".repeat(12_000) },
            },
            changedFields: ["node"],
          },
        ],
      },
      delivery: { version: 2, activeTargetId: "home" },
    };

    const projected = projectToolResultForModel(result);

    expect(projected).toMatchObject({
      revision: 8,
      committedSteps: [{ stepIds: ["hero"], label: "Build hero", revision: 8 }],
      changes: {
        documentId: "document_1",
        fromRevision: 7,
        toRevision: 8,
        addedNodeIds: ["hero", "hero_title"],
        changeDetailsOmitted: { changes: 1 },
      },
      delivery: { version: 2, activeTargetId: "home" },
    });
    expect(JSON.stringify(projected)).not.toContain("properties");
    expect(JSON.stringify(projected).length).toBeLessThan(1_000);
    expect(result.changes.changes[0]?.after?.properties.content).toHaveLength(
      12_000,
    );
  });

  it("preserves compact delivery recovery state when a document result is oversized", () => {
    const unfinishedDelivery = {
      version: 1,
      targets: [
        {
          targetId: "target_profile",
          label: "Profile",
          pageId: "page_1",
          rootNodeId: "frame_profile",
          status: "pending",
        },
      ],
      activeTargetId: "target_profile",
    };

    expect(
      projectToolResultForModel({
        document: { nodes: "x".repeat(80_000) },
        unfinishedDelivery,
      }),
    ).toMatchObject({ unfinishedDelivery });
  });

  it("projects a first-slice checkpoint as compact continuation context", () => {
    const projected = projectToolResultForModel({
      ok: true,
      revision: 12,
      committedSteps: [{ stepIds: ["concept_a"], revision: 12 }],
      plan: {
        version: 1,
        deliverable: "logo",
        objective: "Create a complete brand system",
        outputMode: "editable-composition",
        targets: [
          {
            targetId: "concepts",
            label: "Concept Exploration",
            pageId: "page_1",
            artboard: { mode: "create", frameId: "frame_concepts" },
            composition: {
              regions: [
                { nodeId: "concept_a", name: "Direction A" },
                { nodeId: "concept_b", name: "Direction B" },
              ],
            },
          },
        ],
        briefFidelity: { requiredContent: ["x".repeat(20_000)] },
        visualSystem: { formLanguage: "x".repeat(20_000) },
        logoExploration: { targetId: "concepts", directions: [] },
      },
      delivery: { version: 3, activeTargetId: "concepts" },
      changes: { changes: Array.from({ length: 100 }, () => ({})) },
      checkpoint: {
        version: 1,
        action: "first-slice-and-capture",
        status: "completed",
      },
    });

    expect(projected).toMatchObject({
      revision: 12,
      plan: {
        deliverable: "logo",
        targets: [
          {
            targetId: "concepts",
            artboard: { frameId: "frame_concepts" },
            regions: [{ nodeId: "concept_a" }, { nodeId: "concept_b" }],
          },
        ],
      },
      delivery: { activeTargetId: "concepts" },
    });
    expect(JSON.stringify(projected)).not.toContain("briefFidelity");
    expect(JSON.stringify(projected)).not.toContain("visualSystem");
    expect(JSON.stringify(projected)).not.toContain('"changes"');
    expect(JSON.stringify(projected).length).toBeLessThan(3_000);
  });
});

describe("trusted design revision transitions", () => {
  it("accepts a trusted write rebased over newer external document revisions", () => {
    expect(
      validateDesignRevision(
        {
          previousRevision: 7,
          rebasedFromRevision: 5,
          revision: 8,
          transactionId: "transaction_rebased_insert",
        },
        5,
      ),
    ).toEqual({
      previousRevision: 7,
      rebasedFromRevision: 5,
      revision: 8,
      transactionId: "transaction_rebased_insert",
    });
  });

  it("rejects backward, non-monotonic, and untrusted revision transitions", () => {
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 7,
          revision: 8,
          transactionId: "transaction_missing_rebase_proof",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 4,
          revision: 6,
          transactionId: "transaction_backward_base",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
    expect(() =>
      validateDesignRevision(
        {
          previousRevision: 7,
          revision: 7,
          transactionId: "transaction_non_monotonic",
        },
        5,
      ),
    ).toThrow("invalid design revision transition");
  });
});
