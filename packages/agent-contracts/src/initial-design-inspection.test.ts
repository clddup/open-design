import { describe, expect, it } from "vitest";
import {
  AgentInitialDesignInspectionContract,
  MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS,
  type AgentInitialDesignInspection,
} from "./initial-design-inspection.js";

describe("Agent initial design inspection contract", () => {
  it("accepts a structured bounded host projection", () => {
    expect(AgentInitialDesignInspectionContract.parse(inspection()).ok).toBe(
      true,
    );
  });

  it("reports document revision drift and empty projections at exact paths", () => {
    const revisionDrift = inspection();
    revisionDrift.content.inspection.document!.revision = 8;
    expect(AgentInitialDesignInspectionContract.issues(revisionDrift)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "agent_initial_inspection.revision_mismatch",
          path: "/content/inspection/document/revision",
        }),
      ]),
    );
    expect(
      AgentInitialDesignInspectionContract.issues({
        ...inspection(),
        content: { inspection: {} },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_initial_inspection.schema_invalid",
        path: "/content/inspection",
      }),
    );
  });

  it("reports the model budget and nested Delivery Stage issue paths", () => {
    expect(
      AgentInitialDesignInspectionContract.issues({
        ...inspection(),
        content: {
          inspection: {
            notice: "x".repeat(MAX_INITIAL_DESIGN_INSPECTION_CHARACTERS + 1),
          },
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "agent_initial_inspection.content_size_invalid",
        path: "/content",
      }),
    );

    const stageDrift = inspection();
    stageDrift.content.deliveryStage = {
      totalTargets: 1,
      plannedTargets: 2,
      verifiedTargets: 0,
      currentPlan: {
        stage: 1,
        status: "active",
        targets: [
          {
            targetId: "target_home",
            label: "Home",
            objective: "Design Home",
            requiredContent: ["Primary content"],
          },
        ],
      },
    };
    expect(
      AgentInitialDesignInspectionContract.issues(stageDrift),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_delivery_stage.planned_count_invalid",
        path: "/content/deliveryStage/plannedTargets",
      }),
    );
  });
});

function inspection(): AgentInitialDesignInspection {
  return {
    version: 1,
    observedRevision: 7,
    content: {
      inspection: {
        document: {
          documentId: "document_1",
          revision: 7,
          pagesById: {
            page_1: { id: "page_1", rootNodeIds: [] },
          },
          nodesById: {},
        },
      },
    },
  };
}
