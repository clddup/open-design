import { describe, expect, it } from "vitest";
import { classifyDesignWorkflowFailure } from "./design-workflow-failure-classification";

describe("design workflow failure classification", () => {
  it.each([
    ["inspection_required", "inspection", "applying-draft"],
    ["inspection_stale", "inspection", "applying-draft"],
    ["material_write_required", "material-write", "applying-draft"],
    ["delivery_structure_incomplete", "material-write", "applying-draft"],
    ["planned_parent_not_materialized", "material-write", "applying-draft"],
    ["image_attachment_ambiguous", "material-write", "applying-draft"],
    ["capture_required", "capture", "capturing-canvas"],
    ["capture_revision_invalid", "capture", "capturing-canvas"],
    ["delivery_verification_required", "capture", "capturing-canvas"],
    [
      "component_strategy_incomplete",
      "component-repair",
      "repairing-components",
    ],
    ["plan_amendment_invalid", "plan-repair", "repairing-plan"],
    ["new_node_id_namespace_required", "plan-repair", "repairing-plan"],
    ["frame_resize_requires_layout_tool", "layout-repair", "repairing-layout"],
    ["layout_quality_failed", "layout-repair", "repairing-layout"],
    ["logo_exploration_incomplete", "material-write", "applying-draft"],
    ["logo_exploration_required", "material-write", "applying-draft"],
  ] as const)(
    "classifies %s once for Main and Timeline",
    (code, phase, presentation) => {
      expect(
        classifyDesignWorkflowFailure(`design_workflow.${code}: detail`),
      ).toMatchObject({
        code,
        phase,
        presentation,
        routineRecoverable: true,
      });
    },
  );

  it("classifies stale delivery-artboard writes without duplicating regex users", () => {
    expect(
      classifyDesignWorkflowFailure(
        "Design command update-card targets content outside every declared delivery artboard",
      ),
    ).toMatchObject({
      code: "design_target_stale",
      phase: "inspection",
      routineRecoverable: true,
    });
  });

  it.each([
    [
      "Expected revision 4 but found 5",
      "design_revision_conflict",
      "canvas-changed",
    ],
    [
      "Agent command insert-card exceeds the registered page scope",
      "design_scope_conflict",
      "scope-conflict",
    ],
  ] as const)(
    "classifies runtime conflict: %s",
    (message, code, presentation) => {
      expect(classifyDesignWorkflowFailure(message)).toMatchObject({
        code,
        presentation,
        routineRecoverable: true,
        requiresInspection: true,
      });
    },
  );
});
