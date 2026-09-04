import type { ToolCallRequest } from "@opendesign/agent-contracts";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_PLAN_TOOL_NAME,
  type DesignPlanToolInput,
} from "@/shared/design-agent-tools.js";
import { handleDesignPlanTool } from "./design-plan-tool-handler.js";

const plan: DesignPlanToolInput = {
  version: 1,
  deliverable: "ui",
  objective: "Design Home",
  outputMode: "editable-composition",
  targets: [target("target_home", "Home", "frame_home", 120)],
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
    requiredContent: ["Home screen"],
    preservedSemantics: [],
    prohibitedAdditions: ["No unrequested product capability"],
    assumptions: ["Use an iOS mobile viewport"],
  },
  designIntent: {
    subject: "A mobile product for focused creative work",
    audience: "Independent designers continuing time-sensitive work",
    primaryJob: "Recognize the next task and continue it immediately",
    calibration: {
      surfaceMode: "operate",
      expressiveness: "balanced",
      density: "balanced",
    },
    visualThesis:
      "A directional editorial field expresses momentum instead of a generic card stack.",
    signatureDecision:
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
  it("records the executable Plan without writing an empty artboard", () => {
    const delivery = {
      version: 4 as const,
      targets: [
        {
          targetId: "target_home",
          label: "Home",
          pageId: "page_1",
          rootNodeId: "frame_home",
          reservedNodeIds: ["frame_home"],
          status: "pending" as const,
        },
      ],
      activeTargetId: "target_home",
    };
    const coordinator = {
      authoritativeDesignPrompt: vi.fn().mockReturnValue("Design Home"),
      prepareDesignPlan: vi.fn().mockReturnValue({
        status: "accepted",
        planRevision: 1,
        changedTargetIds: ["target_home"],
        plan,
        state: {},
      }),
      commitDesignPlan: vi.fn(
        (_context: unknown, preparation: Record<string, unknown>) =>
          preparation,
      ),
      getDeliveryLedger: vi.fn().mockReturnValue(delivery),
      getDeliveryStageContext: vi.fn().mockReturnValue(undefined),
    };
    const call: ToolCallRequest = {
      toolCallId: "tool_plan",
      toolName: DESIGN_PLAN_TOOL_NAME,
      input: plan,
    };

    const result = handleDesignPlanTool(coordinator as never, call, context);

    expect(coordinator.commitDesignPlan).toHaveBeenCalledOnce();
    expect(result.content).toMatchObject({
      delivery,
      nextAction: "write-current-target",
    });
    expect(result).not.toHaveProperty("designRevision");
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
    implementationSteps: [
      { stepId: "build_navigation", label: "Build navigation" },
      { stepId: "build_content", label: "Build content" },
    ],
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
