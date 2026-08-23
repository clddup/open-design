import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { describe, expect, it, vi } from "vitest";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  type DesignFirstSliceToolInput,
} from "@/shared/design-agent-tools.js";
import { handleDesignFirstSliceTool } from "./design-first-slice-tool-handler.js";

const context = {
  runId: "run_slice",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 3,
  scope: { kind: "page" as const, pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page" as const, pageId: "page_1" },
};

describe("handleDesignFirstSliceTool", () => {
  it("commits allocation and the first real slice through one semantic history group", async () => {
    const input = firstSliceInput();
    const compiled = compileDesignFirstSliceToolInput(input);
    const delivery = {
      version: 2 as const,
      targets: [
        {
          targetId: "home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          status: "drafted" as const,
          allocatedRevision: 4,
          draftRevision: 5,
        },
      ],
      activeTargetId: "home",
    };
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      registerDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["home"],
        plan: compiled.plan,
      }),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["home"],
        input: {
          label: "Allocate Home artboard",
          commands: [
            {
              commandId: "allocate_home",
              type: "insert_element",
              pageId: "page_1",
              parentId: null,
              index: 0,
              node: { id: "frame_home", kind: "frame" },
            },
          ],
        },
      }),
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForAllocatedApply: vi.fn().mockReturnValue({
        input: compiled.apply,
        plan: compiled.plan,
        targetIds: ["home"],
      }),
      assertDesignApplyResult: vi.fn(),
      recordDesignPlanAllocated: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
      getDeliveryLedger: vi.fn().mockReturnValue(delivery),
    };
    let rendererCall: ToolCallRequest | undefined;
    const rendererHost = {
      execute: vi.fn((call: ToolCallRequest) => {
        rendererCall = call;
        return Promise.resolve({
          content: {
            ok: true,
            committedSteps: [
              {
                stepIds: ["allocate_artboards"],
                label: "Create real artboard",
                revision: 4,
              },
              {
                stepIds: ["hero"],
                label: "Build hero",
                revision: 5,
              },
            ],
          },
          designRevision: {
            previousRevision: 3,
            revision: 5,
            transactionId: "transaction_slice",
          },
        });
      }),
    };
    const call = {
      toolCallId: "slice_1",
      toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
      input: firstSliceModelInput(input),
    };

    const result = await handleDesignFirstSliceTool(
      coordinator as never,
      rendererHost as never,
      call,
      context,
      context,
      new AbortController().signal,
    );

    expect(rendererCall).toMatchObject({
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        steps: [
          {
            stepId: "allocate_artboards",
            commandIds: ["allocate_home"],
          },
          { stepId: "hero" },
        ],
        commands: [
          { commandId: "allocate_home" },
          { commandId: "first_slice_1" },
        ],
      },
    });
    expect(coordinator.recordDesignPlanAllocated).toHaveBeenCalledWith(
      "run_slice",
      ["home"],
      4,
    );
    expect(coordinator.recordDesignApplyCompleted).toHaveBeenCalledWith(
      "run_slice",
      compiled.apply,
      expect.objectContaining({ targetIds: ["home"] }),
      5,
    );
    expect(coordinator.registerDesignPlan).toHaveBeenCalledWith(
      context,
      expect.objectContaining({
        briefFidelity: {
          requiredContent: ["Create a focused home screen"],
          preservedSemantics: [],
          prohibitedAdditions: [
            "Do not invent unrequested content, features, or delivery targets",
          ],
          assumptions: [],
        },
      }),
    );
    expect(result).toMatchObject({
      content: {
        allocation: { targetIds: ["home"], revision: 4 },
        firstSlice: { targetId: "home", revision: 5 },
        delivery,
      },
      designRevision: { previousRevision: 3, revision: 5 },
    });
  });

  it("does not advance allocation or delivery state when the combined renderer transaction fails", async () => {
    const input = firstSliceInput();
    const compiled = compileDesignFirstSliceToolInput(input);
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      registerDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["home"],
        plan: compiled.plan,
      }),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["home"],
        input: {
          label: "Allocate Home artboard",
          commands: [{ commandId: "allocate_home" }],
        },
      }),
      assertVisualReviewBeforeWrite: vi.fn(),
      assertDesignPlanForAllocatedApply: vi.fn().mockReturnValue({
        input: compiled.apply,
        plan: compiled.plan,
        targetIds: ["home"],
      }),
      assertDesignApplyResult: vi.fn(),
      recordDesignPlanAllocated: vi.fn(),
      recordDesignApplyCompleted: vi.fn(),
    };
    const rendererHost = {
      execute: vi.fn().mockRejectedValue(new Error("stage rejected")),
    };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_failed",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input: firstSliceModelInput(input),
        },
        context,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("stage rejected");
    expect(coordinator.recordDesignPlanAllocated).not.toHaveBeenCalled();
    expect(coordinator.recordDesignApplyCompleted).not.toHaveBeenCalled();
  });

  it("rejects a one-direction compact Logo call when the authoritative brief requests three", async () => {
    const input = firstSliceInput();
    input.deliverable = "logo";
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Concept Exploration 提供 3 个真正不同的设计方向"),
      registerDesignPlan: vi.fn(),
    };
    const rendererHost = { execute: vi.fn() };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_logo_incomplete",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input: firstSliceModelInput(input),
        },
        context,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("design_workflow.logo_exploration_required");
    expect(coordinator.registerDesignPlan).not.toHaveBeenCalled();
    expect(rendererHost.execute).not.toHaveBeenCalled();
  });

  it("returns a field-level domain failure before any zero-revision write", async () => {
    const input = firstSliceModelInput(firstSliceInput());
    const firstSlice = input.firstSlice as {
      stages: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    firstSlice.stages[0].elements[0].parentId = "missing_region";
    const coordinator = {
      authoritativeDesignPrompt: vi
        .fn()
        .mockReturnValue("Create a focused home screen"),
      registerDesignPlan: vi.fn(),
      createDesignPlanAllocation: vi.fn(),
    };
    const rendererHost = { execute: vi.fn() };

    await expect(
      handleDesignFirstSliceTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "slice_invalid_parent",
          toolName: DESIGN_FIRST_SLICE_TOOL_NAME,
          input,
        },
        { ...context, revision: 0 },
        { ...context, revision: 0 },
        new AbortController().signal,
      ),
    ).rejects.toThrow(
      "first_slice.parent_not_available at /firstSlice/stages/0/elements/0/parentId",
    );
    expect(coordinator.registerDesignPlan).not.toHaveBeenCalled();
    expect(coordinator.createDesignPlanAllocation).not.toHaveBeenCalled();
    expect(rendererHost.execute).not.toHaveBeenCalled();
  });
});

function firstSliceModelInput(
  input: DesignFirstSliceToolInput,
): Record<string, unknown> {
  const value = structuredClone(input) as unknown as Record<string, unknown>;
  for (const key of [
    "designIntent",
    "skillRefs",
    "briefFidelity",
    "visualSystem",
    "rasterAssetRoles",
    "referenceStrategy",
    "semanticObjects",
  ]) {
    Reflect.deleteProperty(value, key);
  }
  for (const target of value.targets as Array<Record<string, unknown>>) {
    for (const key of ["objective", "layout", "spacing", "qualityProfile"]) {
      Reflect.deleteProperty(target, key);
    }
  }
  return value;
}

function firstSliceInput(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create a focused home screen",
    designIntent: {
      subject: "A mobile product home for focused creative work",
      audience: "Independent designers continuing time-sensitive work",
      primaryJob: "Recognize the next task and continue it immediately",
      visualThesis:
        "A directional editorial field expresses momentum instead of a generic mobile card stack.",
      signatureMotif:
        "One cropped signal rail connects identity, next action, and progress.",
      typographyLanguage:
        "Editorial display type sets pace while compact neutral text preserves clarity.",
      colorMaterialLanguage:
        "Tinted ink planes and one electric signal color create controlled hierarchy.",
      compositionTension:
        "Offset alignment and decisive scale contrast pull attention toward action.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No equal grid of same-radius feature tiles",
        "No generic purple gradient used as the only identity",
      ],
    },
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    briefFidelity: {
      requiredContent: ["Focused home screen"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use an iOS mobile viewport"],
    },
    targets: [
      {
        targetId: "home",
        label: "Home",
        pageId: "page_1",
        objective: "Show the product value immediately",
        frame: {
          frameId: "frame_home",
          x: 80,
          y: 40,
          width: 390,
          height: 844,
        },
        layout: "Vertical mobile composition",
        spacing: "8px base with 24px sections",
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          input: "touch",
          insets: [59, 0, 34, 0],
          safeNodeIds: ["home_hero"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "home_hero",
            name: "Hero",
            role: "content",
            parentId: "frame_home",
            x: 24,
            y: 80,
            width: 342,
            height: 240,
          },
        ],
      },
    ],
    visualSystem: {
      formLanguage: "Calm editorial geometry",
      palette: ["#0F172A", "#F8FAFC", "#7C3AED"],
      surfaceAndDepth: "Flat with one elevated focal surface",
      typography: ["Inter Bold 32/38", "Inter Regular 16/24"],
    },
    rasterAssetRoles: [],
    firstSlice: {
      targetId: "home",
      label: "Create Home hero",
      stages: [
        {
          stageId: "hero",
          label: "Build hero",
          elements: [
            {
              id: "hero_title",
              kind: "text",
              name: "Hero Title",
              parentId: "home_hero",
              x: 24,
              y: 24,
              width: 294,
              height: 84,
              text: {
                content: "Design with momentum",
                fontFamily: "Inter",
                fontStyleName: "Bold",
                fontWeight: 700,
                fontSlant: "normal",
                fontSize: 32,
                lineHeight: 38,
                color: "#0F172A",
                textResize: "auto-height",
              },
            },
          ],
        },
      ],
    },
  };
}
