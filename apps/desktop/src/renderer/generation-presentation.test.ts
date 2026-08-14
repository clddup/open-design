import type {
  DesignNode,
  EditorEvent,
  FrameNode,
} from "@opendesign/design-contracts";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_PLAN_TOOL_NAME,
  type LegacyDesignPlanToolInput,
} from "../shared/design-agent-tools";
import {
  EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
  generationActivityFromAcceptedPlan,
  generationActivityMessageKey,
  generationRevealFromEditorEvent,
  generationSkeletonFromAcceptedPlan,
  projectGenerationPlanPresentationEvent,
} from "./generation-presentation";

const generationPlan = {
  version: 2,
  pageId: "page_welcome",
  deliverable: "poster",
  objective: "Create an editorial launch poster",
  outputMode: "editable-composition",
  artboard: {
    mode: "create",
    frameId: "poster_artboard",
    x: 1_240,
    y: 80,
    width: 800,
    height: 1_000,
  },
  composition: {
    direction: "Asymmetric editorial composition",
    hierarchy: ["Hero visual", "Launch typography"],
    regions: [
      {
        nodeId: "poster_hero",
        name: "Hero visual",
        role: "graphic",
        x: 48,
        y: 80,
        width: 704,
        height: 560,
      },
      {
        nodeId: "poster_title",
        name: "Launch typography",
        role: "typography",
        x: 48,
        y: 688,
        width: 704,
        height: 200,
      },
    ],
    assetIntegration: "Use editable vector artwork with intentional overlap",
    spacingRhythm: "8/16/24/48 px editorial rhythm",
  },
  visualSystem: {
    avoidances: ["No generic text slab", "No centered card stack"],
    formLanguage: "Sharp editorial geometry with one organic hero",
    palette: ["#111111", "#F4F0E8", "#7C6EE6"],
    surfaceAndDepth: "Overlap and tonal contrast without generic cards",
    typography: ["Display 72/76", "Body 18/26"],
    effects: ["Tight outer glow"],
  },
  rasterAssetRoles: [],
  editableLayers: ["Hero visual", "Title", "Supporting copy"],
  implementationSteps: ["Create artboard", "Build regions", "Refine depth"],
  validationChecks: ["Check silhouette", "Check type hierarchy"],
} satisfies LegacyDesignPlanToolInput;

describe("Renderer Agent generation presentation", () => {
  it("derives parent-first reveal order from committed Agent additions", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_agent_additions`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    const group = node({
      id: "agent_group",
      kind: "group",
      parentId: "frame_welcome",
      properties: {},
    });
    const child = node({
      id: "agent_child",
      kind: "rectangle",
      parentId: group.id,
      properties: {
        fills: [{ type: "solid", color: "#6574ff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 8,
      },
    });
    const result = runtime.apply({
      transactionId: "transaction_agent_additions",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Build a visible section",
      commands: [
        {
          commandId: "insert_agent_group",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 2,
          node: group,
        },
        {
          commandId: "insert_agent_child",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: group.id,
          index: 0,
          node: child,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    const reveal = generationRevealFromEditorEvent(
      changed,
      runtime.getSnapshot().document,
      "page_welcome",
      500,
    );
    expect(reveal).toMatchObject({
      id: "event_agent_additions",
      nodeIds: ["agent_group", "agent_child"],
      startedAt: 500,
    });
    expect(Object.keys(reveal?.focusPoints ?? {})).toEqual([
      "agent_group",
      "agent_child",
    ]);
    expect(Number.isFinite(reveal?.focusPoints?.agent_group?.x)).toBe(true);
    expect(Number.isFinite(reveal?.focusPoints?.agent_group?.y)).toBe(true);
  });

  it("does not animate user edits", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_user_edit`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    expect(
      runtime.apply({
        transactionId: "transaction_user_edit",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Rename layer",
        commands: [
          {
            commandId: "rename_feature",
            type: "update_properties",
            nodeId: "feature_one",
            name: "Renamed locally",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    expect(
      generationRevealFromEditorEvent(
        changed,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toBeUndefined();
  });

  it("creates a property tween for changed-only Agent revisions", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_agent_update`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    expect(
      runtime.apply({
        transactionId: "transaction_agent_update",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "agent", id: "agent_conversation" },
        label: "Refine existing layer",
        commands: [
          {
            commandId: "refine_feature",
            type: "update_properties",
            nodeId: "feature_one",
            opacity: 0.8,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    expect(
      generationRevealFromEditorEvent(
        changed,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toMatchObject({
      id: "event_agent_update",
      nodeIds: [],
      tweenNodeIds: ["feature_one"],
      startedAt: 500,
    });
  });

  it("does not animate Agent metadata, reparenting, or z-order-only changes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_non_visual`,
    });
    let event: EditorEvent | undefined;
    runtime.subscribe((candidate) => {
      if (candidate.type === "document.changed") event = candidate;
    });
    expect(
      runtime.apply({
        transactionId: "transaction_non_visual",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "agent", id: "agent_conversation" },
        label: "Rename an existing layer",
        commands: [
          {
            commandId: "rename_feature",
            type: "update_properties",
            nodeId: "feature_one",
            name: "Renamed",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(event).toBeDefined();
    if (!event) return;
    expect(
      generationRevealFromEditorEvent(
        event,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toBeUndefined();
  });
});

describe("Renderer typed plan skeleton presentation", () => {
  it("only accepts a plan after the matching Main tool completion", () => {
    const requested = {
      type: "tool.requested" as const,
      runId: "run_plan",
      toolCallId: "tool_plan",
      toolName: DESIGN_PLAN_TOOL_NAME,
      input: generationPlan,
      risk: "read" as const,
    };
    const afterRequest = projectGenerationPlanPresentationEvent(
      EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
      requested,
    );
    expect(afterRequest.acceptedByRunId.run_plan).toBeUndefined();

    const afterCompletion = projectGenerationPlanPresentationEvent(
      afterRequest,
      {
        type: "tool.completed",
        runId: "run_plan",
        toolCallId: "tool_plan",
        result: acceptedPlanResult(generationPlan),
      },
    );
    expect(afterCompletion.acceptedByRunId.run_plan).toMatchObject({
      id: "run_plan:tool_plan",
      plan: generationPlan,
      runId: "run_plan",
      toolCallId: "tool_plan",
    });
    expect(afterCompletion.activityByRunId.run_plan).toEqual({
      id: "run_plan:tool_plan:accepted",
      phase: "structuring",
      runId: "run_plan",
      toolCallId: "tool_plan",
    });
    expect(afterCompletion.requestedByCallId).toEqual({});

    expect(
      projectGenerationPlanPresentationEvent(afterCompletion, {
        type: "run.completed",
        runId: "run_plan",
        finishedAt: "2026-08-11T12:00:00.000Z",
        stopReason: "complete",
      }),
    ).toEqual(EMPTY_GENERATION_PLAN_PRESENTATION_STATE);
  });

  it("replaces the visible skeleton with the authoritative amended plan", () => {
    const requestedPlan = structuredClone(generationPlan);
    const amendedPlan: LegacyDesignPlanToolInput = {
      ...structuredClone(generationPlan),
      objective: "Create a stronger editorial launch poster",
      composition: {
        ...structuredClone(generationPlan.composition),
        direction: "Asymmetric editorial composition with stronger overlap",
      },
    };
    const requested = projectGenerationPlanPresentationEvent(
      EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
      {
        type: "tool.requested",
        runId: "run_amended_plan",
        toolCallId: "tool_amended_plan",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: requestedPlan,
        risk: "read",
      },
    );
    const accepted = projectGenerationPlanPresentationEvent(requested, {
      type: "tool.completed",
      runId: "run_amended_plan",
      toolCallId: "tool_amended_plan",
      result: {
        ...acceptedPlanResult(amendedPlan),
        status: "amended",
        planRevision: 2,
        changedTargetIds: [amendedPlan.artboard.frameId],
        plan: amendedPlan,
      },
    });

    expect(accepted.acceptedByRunId.run_amended_plan?.plan).toEqual(
      amendedPlan,
    );
  });

  it("rejects failed, malformed, or mismatched plan events", () => {
    const malformed = projectGenerationPlanPresentationEvent(
      EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
      {
        type: "tool.requested",
        runId: "run_bad",
        toolCallId: "tool_bad",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: { ...generationPlan, version: 1 },
        risk: "read",
      },
    );
    expect(malformed).toBe(EMPTY_GENERATION_PLAN_PRESENTATION_STATE);

    const requested = projectGenerationPlanPresentationEvent(
      EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
      {
        type: "tool.requested",
        runId: "run_bad",
        toolCallId: "tool_bad",
        toolName: DESIGN_PLAN_TOOL_NAME,
        input: generationPlan,
        risk: "read",
      },
    );
    const mismatched = projectGenerationPlanPresentationEvent(requested, {
      type: "tool.completed",
      runId: "run_bad",
      toolCallId: "tool_bad",
      result: {
        ...acceptedPlanResult(generationPlan),
        pageId: "page_other",
      },
    });
    expect(mismatched.acceptedByRunId.run_bad).toBeUndefined();
    expect(mismatched.requestedByCallId).toEqual({});
  });

  it("projects trusted design tools into semantic stages without using progress prose", () => {
    const accepted = acceptPlanPresentation("run_stages", "tool_plan_stages");
    const requested = projectGenerationPlanPresentationEvent(accepted, {
      type: "tool.requested",
      runId: "run_stages",
      toolCallId: "tool_apply_draft",
      toolName: "opendesign_apply_transaction",
      input: { label: "Build draft", commands: [] },
      risk: "design_write",
    });
    expect(requested.activityByRunId.run_stages).toEqual({
      id: "run_stages:tool_apply_draft:requested",
      phase: "building",
      runId: "run_stages",
      toolCallId: "tool_apply_draft",
    });

    const progressed = projectGenerationPlanPresentationEvent(requested, {
      type: "tool.progress",
      runId: "run_stages",
      toolCallId: "tool_apply_draft",
      message: "provider-controlled progress prose is not displayed",
      progress: 0.42,
    });
    expect(progressed.activityByRunId.run_stages).toMatchObject({
      id: "run_stages:tool_apply_draft:progress:420",
      phase: "building",
      progress: 0.42,
    });

    const failed = projectGenerationPlanPresentationEvent(progressed, {
      type: "tool.failed",
      runId: "run_stages",
      toolCallId: "tool_apply_draft",
      code: "conflict",
      message: "stale revision",
    });
    expect(failed.activityByRunId.run_stages).toMatchObject({
      id: "run_stages:tool_apply_draft:failed",
      phase: "recovering",
    });

    const reviewRequested = projectGenerationPlanPresentationEvent(failed, {
      type: "tool.requested",
      runId: "run_stages",
      toolCallId: "tool_review",
      toolName: "opendesign_record_visual_review",
      input: {},
      risk: "read",
    });
    const reviewCompleted = projectGenerationPlanPresentationEvent(
      reviewRequested,
      {
        type: "tool.completed",
        runId: "run_stages",
        toolCallId: "tool_review",
        result: { ok: true },
      },
    );
    expect(reviewCompleted.reviewedByRunId.run_stages).toBe(true);
    expect(reviewCompleted.activityByRunId.run_stages).toMatchObject({
      phase: "refining",
    });

    const refinement = projectGenerationPlanPresentationEvent(reviewCompleted, {
      type: "tool.requested",
      runId: "run_stages",
      toolCallId: "tool_apply_refinement",
      toolName: "opendesign_apply_transaction",
      input: { label: "Refine", commands: [] },
      risk: "design_write",
    });
    expect(refinement.activityByRunId.run_stages).toMatchObject({
      phase: "refining",
    });

    const vectorRefinement = projectGenerationPlanPresentationEvent(
      reviewCompleted,
      {
        type: "tool.requested",
        runId: "run_stages",
        toolCallId: "tool_vector_refinement",
        toolName: "opendesign_edit_vector",
        input: {
          action: "reverse-path",
          label: "Reverse contour",
          nodeId: "logo_contour",
          pageId: "page_welcome",
        },
        risk: "design_write",
      },
    );
    expect(vectorRefinement.activityByRunId.run_stages).toMatchObject({
      phase: "refining",
    });
  });

  it("uses planned artboard geometry and replaces fulfilled regions with committed nodes", () => {
    const accepted = {
      id: "run_plan:tool_plan",
      plan: generationPlan,
      runId: "run_plan",
      toolCallId: "tool_plan",
    };
    const runtime = new EditorRuntime(createWelcomeDocument());
    expect(
      generationSkeletonFromAcceptedPlan(
        accepted,
        runtime.getSnapshot().document,
        "page_welcome",
      ),
    ).toEqual({
      id: accepted.id,
      artboard: {
        frameId: "poster_artboard",
        height: 1_000,
        pending: true,
        transform: [1, 0, 0, 1, 1_240, 80],
        width: 800,
      },
      regions: generationPlan.composition.regions.map((region) => ({
        height: region.height,
        id: region.nodeId,
        name: region.name,
        role: region.role,
        width: region.width,
        x: region.x,
        y: region.y,
      })),
    });

    const inserted = runtime.apply({
      transactionId: "transaction_plan_structure",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Create planned poster structure",
      commands: [
        {
          commandId: "insert_poster_artboard",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: null,
          index: 1,
          node: frameNode(),
        },
        {
          commandId: "insert_poster_hero",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "poster_artboard",
          index: 0,
          node: node({
            id: "poster_hero",
            kind: "group",
            parentId: "poster_artboard",
            properties: {},
          }),
        },
      ],
    });
    expect(inserted.ok).toBe(true);
    const withEmptyRegion = generationSkeletonFromAcceptedPlan(
      accepted,
      runtime.getSnapshot().document,
      "page_welcome",
    );
    expect(withEmptyRegion?.artboard).toMatchObject({
      pending: false,
      transform: [1, 0, 0, 1, 1_240, 80],
    });
    expect(withEmptyRegion?.regions.map((region) => region.id)).toEqual([
      "poster_hero",
      "poster_title",
    ]);
    expect(
      generationActivityFromAcceptedPlan(
        accepted,
        {
          id: "run_plan:tool_plan:accepted",
          phase: "structuring",
          runId: "run_plan",
        },
        createWelcomeDocument(),
        "page_welcome",
      ),
    ).toBeUndefined();

    const nestedEmptyGroup = runtime.apply({
      transactionId: "transaction_plan_empty_nested_group",
      documentId: "document_welcome",
      baseRevision: 1,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Create an empty nested group",
      commands: [
        {
          commandId: "insert_empty_nested_group",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "poster_hero",
          index: 0,
          node: node({
            id: "poster_hero_empty_group",
            kind: "group",
            parentId: "poster_hero",
            properties: {},
          }),
        },
      ],
    });
    expect(nestedEmptyGroup.ok).toBe(true);
    expect(
      generationSkeletonFromAcceptedPlan(
        accepted,
        runtime.getSnapshot().document,
        "page_welcome",
      )?.regions.map((region) => region.id),
    ).toEqual(["poster_hero", "poster_title"]);

    const heroContent = runtime.apply({
      transactionId: "transaction_plan_hero_content",
      documentId: "document_welcome",
      baseRevision: 2,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Build planned hero",
      commands: [
        {
          commandId: "insert_hero_shape",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "poster_hero",
          index: 1,
          node: node({
            id: "hero_shape",
            kind: "rectangle",
            parentId: "poster_hero",
            properties: {
              fills: [{ type: "solid", color: "#7c6ee6", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 12,
            },
          }),
        },
      ],
    });
    expect(heroContent.ok).toBe(true);
    expect(
      generationSkeletonFromAcceptedPlan(
        accepted,
        runtime.getSnapshot().document,
        "page_welcome",
      )?.regions.map((region) => region.id),
    ).toEqual(["poster_title"]);
  });

  it("follows a translated stable artboard but rejects structural geometry changes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const existing = {
      id: "run_existing:tool_plan",
      plan: {
        ...generationPlan,
        artboard: { ...generationPlan.artboard, mode: "existing" as const },
      },
      runId: "run_existing",
      toolCallId: "tool_plan",
    };
    expect(
      generationSkeletonFromAcceptedPlan(
        existing,
        runtime.getSnapshot().document,
        "page_welcome",
      ),
    ).toBeUndefined();

    const translated = runtime.apply({
      transactionId: "transaction_translated_artboard",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "user_local" },
      label: "Create then move the planned artboard",
      commands: [
        {
          commandId: "insert_conflicting_artboard",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: null,
          index: 1,
          node: {
            ...frameNode(),
            transform: [1, 0, 0, 1, 1_480, 240],
          },
        },
      ],
    });
    expect(translated.ok).toBe(true);
    expect(
      generationSkeletonFromAcceptedPlan(
        { ...existing, plan: generationPlan },
        runtime.getSnapshot().document,
        "page_welcome",
      ),
    ).toMatchObject({
      artboard: {
        pending: false,
        transform: [1, 0, 0, 1, 1_480, 240],
      },
    });
    expect(
      generationActivityFromAcceptedPlan(
        { ...existing, plan: generationPlan },
        {
          id: "run_existing:tool_apply",
          phase: "building",
          runId: "run_existing",
        },
        runtime.getSnapshot().document,
        "page_welcome",
      )?.target,
    ).toEqual({ x: 2_256, y: 264 });

    const resized = runtime.apply({
      transactionId: "transaction_resized_artboard",
      documentId: "document_welcome",
      baseRevision: 1,
      actor: { type: "user", id: "user_local" },
      label: "Resize the planned artboard",
      commands: [
        {
          commandId: "resize_conflicting_artboard",
          type: "update_properties",
          nodeId: "poster_artboard",
          size: { width: 820, height: 1_000 },
        },
      ],
    });
    expect(resized.ok).toBe(true);
    expect(
      generationSkeletonFromAcceptedPlan(
        { ...existing, plan: generationPlan },
        runtime.getSnapshot().document,
        "page_welcome",
      ),
    ).toBeUndefined();
  });

  it("uses stable localized message keys for each semantic stage", () => {
    expect(generationActivityMessageKey("structuring")).toBe(
      "agent.canvasPhaseStructuring",
    );
    expect(generationActivityMessageKey("building")).toBe(
      "agent.canvasPhaseBuilding",
    );
    expect(generationActivityMessageKey("assets")).toBe(
      "agent.canvasPhaseAssets",
    );
    expect(generationActivityMessageKey("reviewing")).toBe(
      "agent.canvasPhaseReviewing",
    );
    expect(generationActivityMessageKey("refining")).toBe(
      "agent.canvasPhaseRefining",
    );
    expect(generationActivityMessageKey("recovering")).toBe(
      "agent.canvasPhaseRecovering",
    );
  });
});

it("treats existing-artboard regions as logical review areas instead of physical skeleton layers", () => {
  const runtime = new EditorRuntime(createWelcomeDocument());
  expect(
    runtime.apply({
      transactionId: "transaction_existing_artboard",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Register existing artboard",
      commands: [
        {
          commandId: "insert_existing_artboard",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: null,
          index: 1,
          node: frameNode(),
        },
      ],
    }).ok,
  ).toBe(true);
  const accepted = {
    id: "run_existing:tool_plan",
    plan: {
      ...generationPlan,
      artboard: { ...generationPlan.artboard, mode: "existing" as const },
    },
    runId: "run_existing",
    toolCallId: "tool_plan",
  };

  expect(
    generationSkeletonFromAcceptedPlan(
      accepted,
      runtime.getSnapshot().document,
      "page_welcome",
    ),
  ).toMatchObject({
    artboard: { frameId: "poster_artboard", pending: false },
    regions: [],
  });
});

function acceptPlanPresentation(runId: string, toolCallId: string) {
  const requested = projectGenerationPlanPresentationEvent(
    EMPTY_GENERATION_PLAN_PRESENTATION_STATE,
    {
      type: "tool.requested",
      runId,
      toolCallId,
      toolName: DESIGN_PLAN_TOOL_NAME,
      input: generationPlan,
      risk: "read",
    },
  );
  return projectGenerationPlanPresentationEvent(requested, {
    type: "tool.completed",
    runId,
    toolCallId,
    result: acceptedPlanResult(generationPlan),
  });
}

function acceptedPlanResult(plan: LegacyDesignPlanToolInput) {
  return {
    ok: true,
    status: "accepted",
    version: plan.version,
    deliverable: plan.deliverable,
    outputMode: plan.outputMode,
    pageId: plan.pageId,
    artboard: plan.artboard,
    regions: plan.composition.regions,
    editableLayers: plan.editableLayers,
    rasterAssetRoles: plan.rasterAssetRoles,
  };
}

function frameNode(): FrameNode {
  return {
    id: "poster_artboard",
    kind: "frame",
    name: "Poster artboard",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 1_240, 80],
    size: { width: 800, height: 1_000 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#f4f0e8", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: true,
    },
    extensions: {},
  };
}

function node(
  input:
    | {
        id: string;
        kind: "group";
        parentId: string;
        properties: Extract<DesignNode, { kind: "group" }>["properties"];
      }
    | {
        id: string;
        kind: "rectangle";
        parentId: string;
        properties: Extract<DesignNode, { kind: "rectangle" }>["properties"];
      },
): DesignNode {
  return {
    ...input,
    name: input.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 24, 24],
    size: { width: 160, height: 96 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
  };
}
