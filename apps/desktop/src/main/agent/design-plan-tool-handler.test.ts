import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_PLAN_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  type DesignPlanToolInput,
} from "@/shared/design-agent-tools.js";
import { handleDesignPlanTool } from "./design-plan-tool-handler.js";

const plan: DesignPlanToolInput = {
  version: 1,
  deliverable: "ui",
  objective: "Design Home and Profile",
  outputMode: "editable-composition",
  targets: [
    target("target_home", "Home", "frame_home", 120),
    target("target_profile", "Profile", "frame_profile", 558),
  ],
  visualSystem: {
    avoidances: ["No generic card stack", "No placeholder-only content"],
    formLanguage: "Precise mobile controls",
    palette: ["#101828", "#FFFFFF", "#2563EB"],
    surfaceAndDepth: "One restrained elevation tier",
    typography: ["Inter 28/34", "Inter 14/20"],
    effects: ["Subtle navigation shadow"],
  },
  rasterAssetRoles: [],
  componentStrategy: {
    summary: "No reusable semantic object is needed for this fixture.",
    candidates: [],
  },
  briefFidelity: {
    requiredContent: ["Home and Profile screens"],
    preservedSemantics: [],
    prohibitedAdditions: ["No unrequested product capability"],
    assumptions: ["Use an iOS mobile viewport"],
  },
  designIntent: {
    subject: "A mobile product for focused creative work",
    audience: "Independent designers continuing time-sensitive work",
    primaryJob: "Recognize the next task and continue it immediately",
    visualThesis:
      "A directional editorial field expresses momentum instead of a generic card stack.",
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
};

const context = {
  runId: "run_plan",
  sessionId: "conversation_1",
  documentId: "document_1",
  revision: 0,
  scope: { kind: "page" as const, pageId: "page_1", selectedNodeIds: [] },
  mutationTarget: { kind: "page" as const, pageId: "page_1" },
};

describe("handleDesignPlanTool", () => {
  it("allocates every create target through one atomic renderer transaction", async () => {
    const delivery = {
      version: 2 as const,
      targets: plan.targets.map((candidate) => ({
        targetId: candidate.targetId,
        label: candidate.label,
        pageId: candidate.pageId,
        rootNodeId: candidate.artboard.frameId,
        status: "allocated" as const,
        allocatedRevision: 1,
      })),
      activeTargetId: "target_home",
    };
    const coordinator = {
      registerDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["target_home", "target_profile"],
        plan,
      }),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["target_home", "target_profile"],
        input: {
          label: "Allocate 2 planned artboards",
          commands: plan.targets.map((candidate, index) => ({
            commandId: `allocate_${candidate.targetId}`,
            type: "insert_element",
            pageId: candidate.pageId,
            parentId: null,
            index,
            node: {
              id: candidate.artboard.frameId,
              kind: "frame",
            },
          })),
        },
      }),
      recordDesignPlanAllocated: vi.fn(),
      getDeliveryLedger: vi.fn().mockReturnValue(delivery),
    };
    let renderedCall: ToolCallRequest | undefined;
    const rendererHost = {
      execute: vi.fn((rendererCall: ToolCallRequest) => {
        renderedCall = rendererCall;
        return Promise.resolve({
          content: { ok: true },
          designRevision: {
            previousRevision: 0,
            revision: 1,
            transactionId: "transaction_allocate",
          },
        });
      }),
    };
    const call: ToolCallRequest = {
      toolCallId: "tool_plan",
      toolName: DESIGN_PLAN_TOOL_NAME,
      input: plan,
    };

    const result = await handleDesignPlanTool(
      coordinator as never,
      rendererHost as never,
      call,
      context,
      context,
      new AbortController().signal,
    );

    expect(rendererHost.execute).toHaveBeenCalledOnce();
    expect(renderedCall).toMatchObject({
      toolCallId: "tool_plan_allocate",
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        executionMode: "atomic",
        commands: [
          { node: { id: "frame_home" } },
          { node: { id: "frame_profile" } },
        ],
      },
    });
    expect(coordinator.recordDesignPlanAllocated).toHaveBeenCalledWith(
      "run_plan",
      ["target_home", "target_profile"],
      1,
    );
    expect(result).toMatchObject({
      content: {
        allocation: {
          targetIds: ["target_home", "target_profile"],
          revision: 1,
          transactionId: "transaction_allocate",
        },
        delivery,
      },
      designRevision: {
        previousRevision: 0,
        revision: 1,
        transactionId: "transaction_allocate",
      },
    });
  });

  it("does not advance the delivery ledger when the allocation transaction fails", async () => {
    const coordinator = {
      registerDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["target_home", "target_profile"],
        plan,
      }),
      createDesignPlanAllocation: vi.fn().mockReturnValue({
        targetIds: ["target_home", "target_profile"],
        input: {
          label: "Allocate 2 planned artboards",
          commands: [{ commandId: "allocate_home" }],
        },
      }),
      recordDesignPlanAllocated: vi.fn(),
      getDeliveryLedger: vi.fn(),
    };
    const rendererHost = {
      execute: vi.fn().mockRejectedValue(new Error("revision conflict")),
    };

    await expect(
      handleDesignPlanTool(
        coordinator as never,
        rendererHost as never,
        {
          toolCallId: "tool_plan_failed",
          toolName: DESIGN_PLAN_TOOL_NAME,
          input: plan,
        },
        context,
        context,
        new AbortController().signal,
      ),
    ).rejects.toThrow("revision conflict");
    expect(coordinator.recordDesignPlanAllocated).not.toHaveBeenCalled();
  });
});

function target(targetId: string, label: string, frameId: string, x: number) {
  return {
    targetId,
    label,
    pageId: "page_1",
    objective: `Design ${label}`,
    artboard: {
      mode: "create" as const,
      frameId,
      x,
      y: 80,
      width: 390,
      height: 844,
    },
    composition: {
      direction: "Mobile hierarchy",
      hierarchy: ["Navigation", "Content"],
      regions: [
        {
          nodeId: `${frameId}_content`,
          name: "Content",
          role: "content" as const,
          x: 24,
          y: 96,
          width: 342,
          height: 700,
        },
      ],
      assetIntegration: "Native editable content",
      spacingRhythm: "8px rhythm",
    },
    editableLayers: ["Navigation", "Content"],
    implementationSteps: ["Build navigation", "Build content"],
    validationChecks: ["Check hierarchy", "Check spacing"],
    qualityProfile: {
      kind: "ui" as const,
      platform: "ios" as const,
      interactionMode: "touch" as const,
      safeAreaInsets: { top: 59, right: 0, bottom: 34, left: 0 },
      safeAreaNodeIds: [`${frameId}_content`],
      interactiveNodeIds: [],
    },
  };
}
