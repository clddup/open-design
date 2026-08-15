import type {
  AgentCompletionContext,
  AgentToolCallRecord,
} from "@opendesign/agent-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools";
import { reviewDesignCompletion } from "./design-completion-guard";

const materialWrite: AgentToolCallRecord = {
  toolCallId: "write_1",
  toolName: DESIGN_APPLY_TOOL_NAME,
  input: {
    label: "Build mascot",
    commands: [{ type: "insert_element" }, { type: "insert_element" }],
  },
  status: "completed",
  revision: 5,
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

const firstCapture: AgentToolCallRecord = {
  toolCallId: "capture_1",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 5,
};

const visualReview: AgentToolCallRecord = {
  toolCallId: "review_1",
  toolName: DESIGN_REVIEW_TOOL_NAME,
  input: {
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
  toolName: DESIGN_APPLY_TOOL_NAME,
  input: {
    label: "Refine mascot silhouette",
    commands: [{ type: "update_properties" }],
  },
  status: "completed",
  revision: 6,
};

const finalCapture: AgentToolCallRecord = {
  toolCallId: "capture_2",
  toolName: DESIGN_CAPTURE_TOOL_NAME,
  input: {},
  status: "completed",
  revision: 6,
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
      version: 2,
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
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
              status: "pending",
            },
      ],
      activeTargetId: profileStatus === "verified" ? null : "target_profile",
    },
  };
}

describe("design completion guard", () => {
  it("allows non-material conversations to finish normally", () => {
    expect(reviewDesignCompletion(context([]))).toEqual({ allow: true });
  });

  it("rejects a completion claim when planning never produced a design write", () => {
    expectBlocked([inspection, designPlan], "not a completed design");
  });

  it("blocks a resumed Run while inspection reports unfinished delivery", () => {
    const unfinished = deliveryResult("pending").delivery;
    expectBlocked(
      [
        {
          ...inspection,
          result: { unfinishedDelivery: unfinished },
        },
      ],
      "1/2 verified",
    );
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
          toolName: DESIGN_APPLY_TOOL_NAME,
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

  it("requires capture, refinement, and a final capture in order", () => {
    expectBlocked([materialWrite], "structured design plan");
    expectBlocked([designPlan, materialWrite], "document inspection");
    expectBlocked(
      [inspection, designPlan, materialWrite],
      "opendesign_capture_canvas",
    );
    expectBlocked(
      [inspection, designPlan, materialWrite, firstCapture],
      "opendesign_record_visual_review",
    );
    expectBlocked(
      [inspection, designPlan, materialWrite, firstCapture, visualReview],
      "concrete refinement transaction",
    );
    expectBlocked(
      [
        inspection,
        designPlan,
        materialWrite,
        firstCapture,
        visualReview,
        refinementWrite,
      ],
      "again",
    );
    expect(
      reviewDesignCompletion(
        context([
          inspection,
          designPlan,
          materialWrite,
          firstCapture,
          visualReview,
          refinementWrite,
          finalCapture,
        ]),
      ),
    ).toEqual({ allow: true });
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
      result: {
        plan: {
          version: 4,
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
          content: "{}",
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
      "1/2 verified",
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

  it("rejects a new editable artboard that is only a placed raster", () => {
    const editablePlan: AgentToolCallRecord = {
      ...designPlan,
      input: {
        outputMode: "editable-composition",
        artboard: { mode: "create", frameId: "artboard_1" },
      },
    };
    const artboardOnly: AgentToolCallRecord = {
      toolCallId: "write_artboard",
      toolName: DESIGN_APPLY_TOOL_NAME,
      input: {
        label: "Create artboard",
        commands: [
          {
            type: "insert_element",
            node: { id: "artboard_1", kind: "frame" },
          },
        ],
      },
      status: "completed",
      revision: 5,
    };
    const placeHero: AgentToolCallRecord = {
      toolCallId: "place_hero",
      toolName: PLACE_IMAGE_TOOL_NAME,
      input: { role: "hero" },
      status: "completed",
      revision: 6,
    };

    expectBlocked(
      [inspection, editablePlan, artboardOnly, placeHero],
      "dominated by one placed raster",
    );
  });

  it("accepts a semantic hierarchy edit as a post-review refinement without making it a material draft", () => {
    const hierarchyWrite: AgentToolCallRecord = {
      toolCallId: "hierarchy_1",
      toolName: DESIGN_HIERARCHY_TOOL_NAME,
      input: {
        action: "group",
        pageId: "page_1",
        nodeIds: ["body", "face"],
        groupId: "mascot",
      },
      status: "completed",
      revision: 6,
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
      toolName: DESIGN_ARRANGE_TOOL_NAME,
      input: {
        action: "set-horizontal-spacing",
        pageId: "page_1",
        nodeIds: ["card_one", "card_two"],
        spacing: 24,
      },
      status: "completed",
      revision: 7,
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
