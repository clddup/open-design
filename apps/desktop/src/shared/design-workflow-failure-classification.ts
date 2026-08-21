export type DesignWorkflowFailurePhase =
  | "inspection"
  | "material-write"
  | "capture"
  | "component-repair"
  | "plan-repair"
  | "layout-repair";

export type DesignWorkflowFailurePresentation =
  | "applying-draft"
  | "capturing-canvas"
  | "repairing-components"
  | "repairing-plan"
  | "repairing-layout"
  | "canvas-changed"
  | "scope-conflict";

export interface DesignWorkflowFailureClassification {
  code: string;
  phase: DesignWorkflowFailurePhase;
  presentation: DesignWorkflowFailurePresentation;
  routineRecoverable: boolean;
  requiresInspection: boolean;
}

const WORKFLOW_FAILURES: Readonly<
  Record<string, Omit<DesignWorkflowFailureClassification, "code">>
> = {
  inspection_required: recovery("inspection", "applying-draft", true),
  inspection_stale: recovery("inspection", "applying-draft", true),
  material_write_required: recovery("material-write", "applying-draft", false),
  delivery_structure_incomplete: recovery(
    "material-write",
    "applying-draft",
    true,
  ),
  planned_parent_not_materialized: recovery(
    "material-write",
    "applying-draft",
    true,
  ),
  image_attachment_ambiguous: recovery(
    "material-write",
    "applying-draft",
    false,
  ),
  capture_required: recovery("capture", "capturing-canvas", false),
  capture_revision_invalid: recovery("capture", "capturing-canvas", true),
  delivery_verification_required: recovery("capture", "capturing-canvas", true),
  component_strategy_incomplete: recovery(
    "component-repair",
    "repairing-components",
    true,
  ),
  plan_amendment_invalid: recovery("plan-repair", "repairing-plan", true),
  artboard_overlap: recovery("plan-repair", "repairing-plan", false),
  new_node_id_namespace_required: recovery(
    "plan-repair",
    "repairing-plan",
    false,
  ),
  frame_resize_requires_layout_tool: recovery(
    "layout-repair",
    "repairing-layout",
    true,
  ),
  layout_quality_failed: recovery("layout-repair", "repairing-layout", true),
  logo_exploration_incomplete: recovery(
    "material-write",
    "applying-draft",
    true,
  ),
  logo_exploration_required: recovery(
    "material-write",
    "applying-draft",
    false,
  ),
};

export function classifyDesignWorkflowFailure(
  message: string,
): DesignWorkflowFailureClassification | undefined {
  const workflowCode = /^design_workflow\.([a-z_]+):/iu.exec(message)?.[1];
  if (workflowCode) {
    const classification = WORKFLOW_FAILURES[workflowCode];
    return classification
      ? { code: workflowCode, ...classification }
      : undefined;
  }
  if (
    /^Design command .+ targets content outside every declared delivery artboard/im.test(
      message,
    )
  ) {
    return {
      code: "design_target_stale",
      ...recovery("inspection", "applying-draft", true),
    };
  }
  if (/revision conflict|expected revision|stale revision/iu.test(message)) {
    return {
      code: "design_revision_conflict",
      ...recovery("inspection", "canvas-changed", true),
    };
  }
  if (
    /targets a parent outside|exceeds the registered .* scope|outside the registered .* scope/iu.test(
      message,
    )
  ) {
    return {
      code: "design_scope_conflict",
      ...recovery("inspection", "scope-conflict", true),
    };
  }
  return undefined;
}

function recovery(
  phase: DesignWorkflowFailurePhase,
  presentation: DesignWorkflowFailurePresentation,
  requiresInspection: boolean,
): Omit<DesignWorkflowFailureClassification, "code"> {
  return {
    phase,
    presentation,
    routineRecoverable: true,
    requiresInspection,
  };
}
