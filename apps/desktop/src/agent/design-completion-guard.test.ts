import type {
  AgentCompletionContext,
  AgentToolCallRecord,
} from "@opendesign/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "@/shared/design-agent-tools";
import { reviewDesignCompletion } from "./design-completion-guard";

const materialWrite: AgentToolCallRecord = {
  toolCallId: "write_1",
  toolName: DESIGN_EDIT_TOOL_NAME,
  input: {
    edits: [
      {
        kind: "node",
        input: {
          label: "Build mascot",
          commands: [{ type: "insert_element" }, { type: "insert_element" }],
        },
      },
    ],
  },
  status: "completed",
  revision: 5,
  revisionAdvanced: true,
};

const designPlan: AgentToolCallRecord = {
  toolCallId: "plan_1",
  toolName: DESIGN_PLAN_TOOL_NAME,
  input: {
    outputMode: "editable-composition",
    artboard: { mode: "existing", frameId: "artboard_1" },
  },
  status: "completed",
};

const inspection: AgentToolCallRecord = {
  toolCallId: "inspect_1",
  toolName: DESIGN_INSPECT_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 4,
};

const deliveryScope: AgentToolCallRecord = {
  toolCallId: "scope_1",
  toolName: DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  input: {},
  status: "completed",
  result: {
    deliveryScope: {
      version: 1,
      deliverable: "ui",
      objective: "Design the complete product suite",
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          objective: "Design the complete Home experience",
          artboard: { width: 1440, height: 900 },
          requiredContent: ["Primary Home content"],
        },
        {
          targetId: "target_profile",
          label: "Profile",
          objective: "Design the complete Profile experience",
          artboard: { width: 1440, height: 900 },
          requiredContent: ["Primary Profile content"],
        },
      ],
      exclusions: [],
      assumptions: [],
    },
  },
};

const firstCapture: AgentToolCallRecord = {
  toolCallId: "capture_1",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 5,
};

const visualReview: AgentToolCallRecord = {
  toolCallId: "review_1",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {
    briefFidelity:
      "The rendered design preserves the requested mascot content without inventing product controls",
    composition: "Main silhouette needs more breathing room",
    hierarchy: "Primary and secondary elements compete",
    typography: "Secondary type needs lower contrast",
    assetIntegration: "Hero edge is not integrated with the title",
    formAndSurface: "The opaque surface is too heavy",
    effects: "Glow needs a tighter radius",
    refinements: ["Open negative space", "Reduce the opaque surface"],
  },
  status: "completed",
  revision: 5,
};

const refinementWrite: AgentToolCallRecord = {
  toolCallId: "write_2",
  toolName: DESIGN_EDIT_TOOL_NAME,
  input: {
    edits: [
      {
        kind: "node",
        input: {
          label: "Refine mascot silhouette",
          commands: [{ type: "update_properties" }],
        },
      },
    ],
  },
  status: "completed",
  revision: 6,
  revisionAdvanced: true,
};

const finalCapture: AgentToolCallRecord = {
  toolCallId: "capture_2",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 6,
  result: deliveryResult("verified"),
};

function context(
  toolCalls: AgentToolCallRecord[],
  unresolvedDesignWriteFailure?: AgentCompletionContext["unresolvedDesignWriteFailure"],
  requestOverrides: Partial<AgentCompletionContext["request"]> = {},
): AgentCompletionContext {
  return {
    request: {
      runId: "run_1",
      sessionId: "conversation_1",
      prompt: "Design a mascot",
      documentId: "document_1",
      revision: 4,
      scope: { kind: "page", pageId: "page_1", selectedNodeIds: [] },
      mutationTarget: { kind: "page", pageId: "page_1" },
      modelSelection: {
        providerId: "mock",
        modelId: "design",
        reasoningEffort: "medium",
      },
      ...requestOverrides,
    },
    currentRevision: toolCalls.at(-1)?.revision ?? 4,
    turn: 4,
    rejectionCount: 0,
    toolCalls,
    ...(unresolvedDesignWriteFailure === undefined
      ? {}
      : { unresolvedDesignWriteFailure }),
  };
}

function expectBlocked(
  toolCalls: AgentToolCallRecord[],
  message: string,
): void {
  const result = reviewDesignCompletion(context(toolCalls));
  expect(result.allow).toBe(false);
  if (result.allow) throw new Error("Expected completion to be blocked");
  expect(result.message).toContain(message);
}

function deliveryResult(profileStatus: "pending" | "verified") {
  return {
    delivery: {
      version: 4,
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          reservedNodeIds: ["frame_home"],
          status: "verified",
          allocatedRevision: 5,
          draftRevision: 5,
          captureRevision: 5,
          reviewRevision: 5,
          refinementRevision: 6,
          verifiedRevision: 6,
        },
        profileStatus === "verified"
          ? {
              targetId: "target_profile",
              label: "Profile",
              pageId: "page_1",
              rootNodeId: "frame_profile",
              reservedNodeIds: ["frame_profile"],
              status: "verified",
              allocatedRevision: 7,
              draftRevision: 7,
              captureRevision: 7,
              reviewRevision: 7,
              refinementRevision: 8,
              verifiedRevision: 8,
            }
          : {
              targetId: "target_profile",
              label: "Profile",
              pageId: "page_1",
              rootNodeId: "frame_profile",
              reservedNodeIds: ["frame_profile"],
              status: "pending",
            },
      ],
      activeTargetId: profileStatus === "verified" ? null : "target_profile",
      planExecution: {
        planRevision: 1,
        targets: [
          {
            targetId: "target_home",
            steps: [
              {
                stepId: "home_content",
                label: "Build Home",
                kind: "implementation",
                status: "completed",
                startedRevision: 4,
                completedRevision: 5,
              },
              {
                stepId: "target_home.review-refine",
                label: "Review and refine Home",
                kind: "review-refine",
                status: "completed",
                startedRevision: 5,
                completedRevision: 6,
              },
            ],
          },
          {
            targetId: "target_profile",
            steps:
              profileStatus === "verified"
                ? [
                    {
                      stepId: "profile_content",
                      label: "Build Profile",
                      kind: "implementation",
                      status: "completed",
                      startedRevision: 6,
                      completedRevision: 7,
                    },
                    {
                      stepId: "target_profile.review-refine",
                      label: "Review and refine Profile",
                      kind: "review-refine",
                      status: "completed",
                      startedRevision: 7,
                      completedRevision: 8,
                    },
                  ]
                : [
                    {
                      stepId: "profile_content",
                      label: "Build Profile",
                      kind: "implementation",
                      status: "in_progress",
                      startedRevision: 6,
                    },
                    {
                      stepId: "target_profile.review-refine",
                      label: "Review and refine Profile",
                      kind: "review-refine",
                      status: "pending",
                    },
                  ],
          },
        ],
      },
    },
  };
}

describe("design completion guard", () => {
  it("allows non-material conversations to finish normally", () => {
    expect(reviewDesignCompletion(context([]))).toEqual({ allow: true });
  });

  it("blocks Run completion while the Main Plan ledger has an unfinished step", () => {
    const result = reviewDesignCompletion(
      context([
        {
          ...finalCapture,
          toolCallId: "capture_plan_incomplete",
          result: {
            delivery: {
              version: 4,
              targets: [
                {
                  targetId: "target_home",
                  label: "Home",
                  pageId: "page_1",
                  rootNodeId: "frame_home",
                  reservedNodeIds: ["frame_home"],
                  status: "drafted",
                  allocatedRevision: 4,
                  draftRevision: 5,
                },
              ],
              activeTargetId: "target_home",
              planExecution: {
                planRevision: 1,
                targets: [
                  {
                    targetId: "target_home",
                    steps: [
                      {
                        stepId: "build_content",
                        label: "Build content",
                        kind: "implementation",
                        status: "in_progress",
                        startedRevision: 4,
                      },
                      {
                        stepId: "target_home.review-refine",
                        label: "Review and refine",
                        kind: "review-refine",
                        status: "pending",
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      ]),
    );

    expect(result.allow).toBe(false);
    if (result.allow) throw new Error("Expected incomplete Plan rejection");
    expect(result.message).toContain("build_content");
    expect(result.message).toContain("do not skip pending steps");
  });

  it("requires and enforces a host-recorded scope for a broad brief", () => {
    const missing = reviewDesignCompletion(
      context([], undefined, { deliveryScopeReview: "required" }),
    );
    expect(missing.allow).toBe(false);
    if (missing.allow) throw new Error("Expected delivery scope review");
    expect(missing.message).toContain("opendesign_review_delivery_scope");

    const allTargetsVerified = {
      ...finalCapture,
      toolCallId: "capture_scope_verified",
      result: deliveryResult("verified"),
    };
    expect(
      reviewDesignCompletion(
        context([deliveryScope, allTargetsVerified], undefined, {
          deliveryScopeReview: "required",
        }),
      ),
    ).toEqual({ allow: true });

    const reducedScope = structuredClone(deliveryScope);
    if (!reducedScope.result || typeof reducedScope.result !== "object") {
      throw new Error("Expected Delivery Scope result");
    }
    const reducedResult = reducedScope.result as {
      deliveryScope: { targets: unknown[] };
    };
    reducedResult.deliveryScope.targets =
      reducedResult.deliveryScope.targets.slice(0, 1);
    const mismatch = reviewDesignCompletion(
      context([reducedScope, allTargetsVerified], undefined, {
        deliveryScopeReview: "required",
      }),
    );
    expect(mismatch.allow).toBe(false);
    if (mismatch.allow) throw new Error("Expected scope/ledger mismatch");
    expect(mismatch.message).toContain("not an ordered prefix");

    const firstStageDelivery = structuredClone(
      deliveryResult("verified").delivery,
    );
    firstStageDelivery.targets = firstStageDelivery.targets.slice(0, 1);
    firstStageDelivery.planExecution.targets =
      firstStageDelivery.planExecution.targets.slice(0, 1);
    firstStageDelivery.activeTargetId = null;
    const nextStage = reviewDesignCompletion(
      context(
        [
          deliveryScope,
          {
            ...allTargetsVerified,
            toolCallId: "capture_scope_first_stage",
            result: { delivery: firstStageDelivery },
          },
        ],
        undefined,
        { deliveryScopeReview: "required" },
      ),
    );
    expect(nextStage.allow).toBe(false);
    if (nextStage.allow) throw new Error("Expected the next rolling Plan");
    expect(nextStage.message).toContain("target_profile");
    expect(nextStage.message).toContain("opendesign_generate_first_slice");

    const continuedStage = reviewDesignCompletion(
      context(
        [
          {
            ...allTargetsVerified,
            toolCallId: "capture_continued_first_stage",
            result: { delivery: firstStageDelivery },
          },
        ],
        undefined,
        {
          deliveryScopeReview: "required",
          initialDesignInspection: {
            version: 1,
            observedRevision: 8,
            content: {
              inspection: { notice: "bounded host projection" },
              deliveryStage: {
                totalTargets: 2,
                plannedTargets: 1,
                verifiedTargets: 1,
                currentPlan: {
                  stage: 1,
                  status: "verified",
                  targets: [
                    {
                      targetId: "target_home",
                      label: "Home",
                      objective: "Design the complete Home experience",
                      requiredContent: ["Primary Home content"],
                    },
                  ],
                },
                nextTarget: {
                  stage: 2,
                  targetId: "target_profile",
                  label: "Profile",
                  objective: "Design the complete Profile experience",
                  requiredContent: ["Primary Profile content"],
                  artboard: {
                    pageId: "page_1",
                    frameId: "frame_profile",
                    x: 1600,
                    y: 0,
                    width: 1440,
                    height: 900,
                  },
                },
              },
            },
          },
        },
      ),
    );
    expect(continuedStage.allow).toBe(false);
    if (continuedStage.allow) {
      throw new Error("Expected continuation scope to remain active");
    }
    expect(continuedStage.message).toContain("target_profile");
  });

  it("asks for the first executable Plan after scope artboards are reserved", () => {
    const reservedScope = structuredClone(deliveryScope);
    reservedScope.result = {
      ...(reservedScope.result as Record<string, unknown>),
      deliveryStage: {
        totalTargets: 2,
        plannedTargets: 0,
        verifiedTargets: 0,
        nextTarget: {
          stage: 1,
          targetId: "target_home",
          label: "Home",
          objective: "Design the complete Home experience",
          requiredContent: ["Primary Home content"],
          artboard: {
            pageId: "page_1",
            frameId: "run_scope_scope_1",
            x: 0,
            y: 0,
            width: 1440,
            height: 900,
          },
        },
      },
    };

    const result = reviewDesignCompletion(
      context([reservedScope], undefined, {
        deliveryScopeReview: "required",
      }),
    );

    expect(result.allow).toBe(false);
    if (result.allow) throw new Error("Expected executable Plan requirement");
    expect(result.message).toContain("no executable target");
    expect(result.message).toContain("target_home");
  });

  it("rejects a completion claim when planning never produced a design write", () => {
    expectBlocked([inspection, designPlan], "not a completed design");
  });

  it("rejects text-only completion after an invalid first-slice structure", () => {
    const result = reviewDesignCompletion(
      context([], {
        toolCallId: "invalid_first_slice",
        toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
        code: "invalid_tool_input",
        message:
          "/firstSlice/stages contains 33 elements; combined maximum is 32",
        inspectionCompleted: false,
      }),
    );

    expect(result.allow).toBe(false);
    if (result.allow) throw new Error("Expected completion to be blocked");
    expect(result.message).toContain("corrected tool call");
    expect(result.message).toContain("text-only explanation");
    expect(result.message).toContain("restart the request");
  });

  it("blocks a real continuation while inspection reports unfinished delivery", () => {
    const unfinished = deliveryResult("pending").delivery;
    const result = reviewDesignCompletion(
      context(
        [{ ...inspection, result: { unfinishedDelivery: unfinished } }],
        undefined,
        {
          continuation: {
            parentRunId: "run_parent",
            rootRunId: "run_parent",
            attempt: 1,
            maxAttempts: 3,
            reason: "budget",
          },
        },
      ),
    );
    expect(result.allow).toBe(false);
    if (result.allow) throw new Error("Expected continuation to be blocked");
    expect(result.message).toContain("profile_content");
  });

  it("does not turn old unfinished delivery into an explicit direct edit obligation", () => {
    const unfinished = deliveryResult("pending").delivery;
    expect(
      reviewDesignCompletion(
        context(
          [
            { ...inspection, result: { unfinishedDelivery: unfinished } },
            materialWrite,
          ],
          undefined,
          { deliveryScopeReview: "direct" },
        ),
      ),
    ).toEqual({ allow: true });
  });

  it("does not upgrade a successful direct edit into capture and review ceremony", () => {
    expect(
      reviewDesignCompletion(
        context([inspection, designPlan, materialWrite], undefined, {
          deliveryScopeReview: "direct",
        }),
      ),
    ).toEqual({ allow: true });
  });

  it("allows an explicit trusted Page clear to supersede unfinished delivery without capture", () => {
    const unfinished = deliveryResult("pending").delivery;
    expect(
      reviewDesignCompletion(
        context(
          [
            { ...inspection, result: { unfinishedDelivery: unfinished } },
            {
              toolCallId: "clear_page",
              toolName: DESIGN_PAGE_TOOL_NAME,
              input: {
                action: "clear",
                label: "Clear current Page",
                pageId: "page_1",
              },
              status: "completed",
              revision: 5,
              result: { deliveryDisposition: "superseded" },
            },
          ],
          {
            toolCallId: "old_failure",
            toolName: DESIGN_EDIT_TOOL_NAME,
            code: "design.invalid",
            message: "Old Main deletion failed",
            inspectionCompleted: true,
          },
        ),
      ),
    ).toEqual({ allow: true });
  });

  it("rejects completion after inspection until the failed design write is corrected", () => {
    const result = reviewDesignCompletion(
      context(
        [
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          refinementWrite,
          {
            ...finalCapture,
            result: deliveryResult("verified"),
          },
        ],
        {
          toolCallId: "duplicate_write",
          toolName: DESIGN_EDIT_TOOL_NAME,
          code: "design.duplicate",
          message: "Node login-brand-cover-v3 already exists",
          inspectionCompleted: true,
        },
      ),
    );

    expect(result.allow).toBe(false);
    if (result.allow) throw new Error("Expected completion to be blocked");
    expect(result.message).toContain("design.duplicate");
    expect(result.message).toContain(
      "no corrected revision-advancing design write",
    );
  });

  it("requires capture to return Main-owned delivery and review evidence", () => {
    expect(reviewDesignCompletion(context([materialWrite]))).toEqual({
      allow: true,
    });
    expectBlocked(
      [
        inspection,
        designPlan,
        { ...materialWrite, revisionAdvanced: undefined },
      ],
      "No material design transaction reached",
    );
    expectBlocked([designPlan, materialWrite], "document inspection");
    expectBlocked(
      [inspection, designPlan, materialWrite],
      "opendesign_capture_canvas",
    );
    expectBlocked(
      [inspection, designPlan, materialWrite, firstCapture],
      "Main-owned delivery ledger and visual verdict",
    );
    expectBlocked(
      [inspection, designPlan, materialWrite, firstCapture, visualReview],
      "Main-owned delivery ledger and visual verdict",
    );
  });

  it("accepts trusted host inspection plus the combined plan and first-slice write", () => {
    const compact: AgentToolCallRecord = {
      toolCallId: "slice_1",
      toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
      input: {
        firstSlice: {
          stages: [
            {
              elements: [
                { kind: "frame" },
                { kind: "rectangle" },
                { kind: "text" },
              ],
            },
          ],
        },
      },
      status: "completed",
      revision: 5,
      revisionAdvanced: true,
      result: {
        plan: {
          version: 1,
          outputMode: "editable-composition",
          targets: [
            {
              artboard: { mode: "create", frameId: "frame_home" },
            },
          ],
        },
      },
    };
    const compactContext = context(
      [compact, firstCapture, visualReview, refinementWrite, finalCapture],
      undefined,
      {
        initialDesignInspection: {
          version: 1,
          observedRevision: 4,
          content: { inspection: { notice: "bounded host projection" } },
        },
      },
    );

    expect(reviewDesignCompletion(compactContext)).toEqual({ allow: true });
  });

  it("refuses to finish while any required delivery target is incomplete", () => {
    const firstTargetVerified = {
      ...finalCapture,
      result: deliveryResult("pending"),
    };
    expectBlocked(
      [
        inspection,
        designPlan,
        materialWrite,
        firstCapture,
        visualReview,
        refinementWrite,
        firstTargetVerified,
      ],
      "profile_content",
    );
    const allTargetsVerified = {
      ...finalCapture,
      toolCallId: "capture_all_verified",
      result: deliveryResult("verified"),
    };
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          refinementWrite,
          allTargetsVerified,
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts an all-verified host ledger from one trusted capture", () => {
    expect(
      reviewDesignCompletion(
        context([
          {
            toolCallId: "capture_verified",
            toolName: DESIGN_CAPTURE_TOOL_NAME,
            input: {},
            status: "completed",
            revision: 8,
            result: {
              ...deliveryResult("verified"),
            },
          },
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("does not allow generated imagery to replace a canvas design", () => {
    const generated: AgentToolCallRecord = {
      toolCallId: "generate_1",
      toolName: GENERATE_IMAGE_TOOL_NAME,
      input: { prompt: "Generate a hero", role: "hero" },
      status: "completed",
    };
    expectBlocked(
      [inspection, designPlan, generated],
      "did not change the design",
    );
  });

  it("treats placing a generated image as a material canvas write", () => {
    const placeImage: AgentToolCallRecord = {
      toolCallId: "place_1",
      toolName: PLACE_IMAGE_TOOL_NAME,
      input: {
        attachmentId: `image_${"a".repeat(64)}`,
        role: "final-single-image",
      },
      status: "completed",
      revision: 5,
      revisionAdvanced: true,
    };

    const singleRasterPlan: AgentToolCallRecord = {
      ...designPlan,
      input: {
        outputMode: "single-raster",
        artboard: { mode: "create", frameId: "artboard_1" },
      },
    };

    expectBlocked(
      [inspection, singleRasterPlan, placeImage],
      "opendesign_capture_canvas",
    );
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          singleRasterPlan,
          placeImage,
          firstCapture,
          visualReview,
          refinementWrite,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("requires rendered review after a raster-backed editable write without counting layers", () => {
    const editablePlan: AgentToolCallRecord = {
      ...designPlan,
      input: {
        outputMode: "editable-composition",
        artboard: { mode: "create", frameId: "artboard_1" },
      },
    };
    const artboardOnly: AgentToolCallRecord = {
      toolCallId: "write_artboard",
      toolName: DESIGN_EDIT_TOOL_NAME,
      input: {
        edits: [
          {
            kind: "node",
            input: {
              label: "Create artboard",
              commands: [
                {
                  type: "insert_element",
                  node: { id: "artboard_1", kind: "frame" },
                },
              ],
            },
          },
        ],
      },
      status: "completed",
      revision: 5,
      revisionAdvanced: true,
    };
    const placeHero: AgentToolCallRecord = {
      toolCallId: "place_hero",
      toolName: PLACE_IMAGE_TOOL_NAME,
      input: { role: "hero" },
      status: "completed",
      revision: 6,
      revisionAdvanced: true,
    };

    expectBlocked(
      [inspection, editablePlan, artboardOnly, placeHero],
      "opendesign_capture_canvas",
    );
  });

  it("accepts a semantic hierarchy edit as a post-review refinement without making it a material draft", () => {
    const hierarchyWrite: AgentToolCallRecord = {
      toolCallId: "hierarchy_1",
      toolName: DESIGN_EDIT_TOOL_NAME,
      input: {
        edits: [
          {
            kind: "hierarchy",
            input: {
              action: "group",
              pageId: "page_1",
              nodeIds: ["body", "face"],
              groupId: "mascot",
            },
          },
        ],
      },
      status: "completed",
      revision: 6,
      revisionAdvanced: true,
    };

    expect(reviewDesignCompletion(context([hierarchyWrite]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          hierarchyWrite,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts an explicit Image update as a post-review refinement without making it a material draft", () => {
    const updateImage: AgentToolCallRecord = {
      toolCallId: "update_image_1",
      toolName: UPDATE_IMAGE_TOOL_NAME,
      input: {
        action: "set-placement",
        pageId: "page_1",
        nodeId: "hero_image",
        placement: { mode: "fit" },
      },
      status: "completed",
      revision: 6,
      revisionAdvanced: true,
    };

    expect(reviewDesignCompletion(context([updateImage]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          updateImage,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts a precise arrangement as a post-review refinement without making it a material draft", () => {
    const arrangeWrite: AgentToolCallRecord = {
      toolCallId: "arrange_1",
      toolName: DESIGN_EDIT_TOOL_NAME,
      input: {
        edits: [
          {
            kind: "arrange",
            input: {
              action: "set-horizontal-spacing",
              pageId: "page_1",
              nodeIds: ["card_one", "card_two"],
              spacing: 24,
            },
          },
        ],
      },
      status: "completed",
      revision: 7,
      revisionAdvanced: true,
    };

    expect(reviewDesignCompletion(context([arrangeWrite]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          arrangeWrite,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
  });

  it("accepts editable SVG import as a refinement without treating a direct import as a full design draft", () => {
    const importSvg: AgentToolCallRecord = {
      toolCallId: "import_svg_1",
      toolName: IMPORT_SVG_TOOL_NAME,
      input: {
        attachmentId: `svg_${"a".repeat(64)}`,
        pageId: "page_1",
        parentId: "artboard_1",
        index: 2,
        x: 120,
        y: 80,
      },
      status: "completed",
      revision: 6,
      revisionAdvanced: true,
    };

    expect(reviewDesignCompletion(context([inspection, importSvg]))).toEqual({
      allow: true,
    });
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          importSvg,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
  });
});
