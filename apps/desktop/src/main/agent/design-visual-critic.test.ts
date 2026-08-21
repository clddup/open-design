import { BUILTIN_LOGO_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import type {
  CanonicalStreamEvent,
  ModelRequest,
} from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import type { DesignPlanToolInput } from "../../shared/design-agent-tools.js";
import {
  type DesignVisualCriticContext,
  requireDesignVisualCriticAttachment,
  runIndependentDesignVisualCritic,
} from "./design-visual-critic.js";

const criterionIds = [
  "visual-thesis",
  "signature-motif",
  "composition-tension",
  "typography-character",
  "material-coherence",
  "template-avoidance",
  "glance-legibility",
  "subject-specificity",
  "craft-precision",
  "concept-divergence",
  "black-silhouette",
  "counterform-contour",
  "optical-balance",
  "small-size-recognition",
  "monochrome-integrity",
  "symbol-wordmark-relationship",
  "app-icon-optical-redraw",
  "component-system-integrity",
] as const;

describe("independent design visual critic", () => {
  it("blocks a generic Logo when one non-compensating critical score fails", async () => {
    let capturedRequest: Omit<ModelRequest, "signal"> | undefined;
    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) => {
          capturedRequest = request;
          return Promise.resolve(
            responseEvents(request.attemptId, {
              ...scorecard(4),
              criteria: {
                ...scorecard(4).criteria,
                "black-silhouette": {
                  score: 2,
                  evidence:
                    "The black silhouette remains a generic square tile with no ownable contour.",
                  refinement:
                    "Replace the tile boundary with one ownable asymmetric silhouette.",
                },
              },
            }),
          );
        },
      },
      criticContext(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      passed: false,
      failedCriteria: ["black-silhouette"],
    });
    expect(result.refinements).toContain(
      "Replace the tile boundary with one ownable asymmetric silhouette.",
    );
    expect(capturedRequest?.sessionId).toBe("run_logo:visual-critic");
    expect(capturedRequest?.messages).toHaveLength(1);
    const criticMessage = capturedRequest?.messages[0];
    if (
      criticMessage?.role !== "user" ||
      !Array.isArray(criticMessage.content)
    ) {
      throw new Error(
        "Critic request did not contain one multimodal user message",
      );
    }
    expect(
      criticMessage.content.find((block) => block.type === "image_ref"),
    ).toMatchObject({
      type: "image_ref",
      attachmentId: "capture_logo",
    });
    expect(capturedRequest?.modelSelection).toEqual({
      providerId: "provider",
      modelId: "vision-model",
    });
  });

  it("derives a pass only when every Logo criterion clears host thresholds", async () => {
    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) =>
          Promise.resolve(responseEvents(request.attemptId, scorecard(4))),
      },
      criticContext("final"),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      passed: true,
      averageScore: 4,
      failedCriteria: [],
      observedRevision: 8,
    });
    expect(result.review.failedCriteria).toHaveLength(2);
  });

  it("fails closed when the Provider adds prose or duplicates the verdict", async () => {
    await expect(
      runIndependentDesignVisualCritic(
        {
          complete: (request) =>
            Promise.resolve([
              {
                type: "block.completed",
                attemptId: request.attemptId,
                block: {
                  id: "critic_prose",
                  type: "text",
                  text: "This looks ready.",
                },
              },
              ...responseEvents(request.attemptId, scorecard(4)),
            ]),
        },
        criticContext("final"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("Independent critic did not submit");

    await expect(
      runIndependentDesignVisualCritic(
        {
          complete: (request) => {
            const events = responseEvents(request.attemptId, scorecard(4));
            return Promise.resolve([
              events[0],
              {
                type: "block.completed",
                attemptId: request.attemptId,
                block: {
                  id: "critic_call_duplicate",
                  type: "tool_call",
                  toolCallId: "critic_call_duplicate",
                  name: "opendesign_submit_independent_visual_critique",
                  input: scorecard(4),
                },
              },
              events[1],
            ]);
          },
        },
        criticContext("final"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("Independent critic did not submit");
  });

  it("requires actionable draft refinements and the exact JPEG attachment shape", async () => {
    await expect(
      runIndependentDesignVisualCritic(
        {
          complete: (request) =>
            Promise.resolve(
              responseEvents(request.attemptId, {
                ...scorecard(4),
                refinements: [],
              }),
            ),
        },
        criticContext("draft"),
        new AbortController().signal,
      ),
    ).rejects.toThrow("invalid scorecard");

    expect(
      requireDesignVisualCriticAttachment({
        attachment: {
          attachmentId: "capture_logo",
          name: "capture.jpg",
          mimeType: "image/jpeg",
          byteSize: 12_000,
        },
      }),
    ).toEqual({
      attachmentId: "capture_logo",
      name: "capture.jpg",
      mimeType: "image/jpeg",
      byteSize: 12_000,
    });
    expect(() =>
      requireDesignVisualCriticAttachment({
        attachment: {
          attachmentId: "capture_logo",
          name: "capture.png",
          mimeType: "image/png",
          byteSize: 12_000,
        },
      }),
    ).toThrow("Exact-revision capture attachment is missing or invalid");
    expect(() =>
      requireDesignVisualCriticAttachment({
        attachment: {
          attachmentId: "capture_logo",
          name: "capture.jpg",
          mimeType: "image/jpeg",
          byteSize: 12_000,
          filePath: "/tmp/not-allowed.jpg",
        },
      }),
    ).toThrow("Exact-revision capture attachment is missing or invalid");
  });
});

function scorecard(score: number): {
  summary: string;
  criteria: Record<
    string,
    { score: number; evidence: string; refinement?: string }
  >;
  refinements: string[];
} {
  return {
    summary:
      "The exact revision shows a coherent logo system with visible small-size specimens.",
    criteria: Object.fromEntries(
      criterionIds.map((id) => [
        id,
        {
          score,
          evidence: `The rendered capture provides concrete delivery evidence for ${id}.`,
        },
      ]),
    ),
    refinements: [
      "Tighten the most visually consequential spacing relationship.",
      "Strengthen one visible identifying detail without adding decoration.",
    ],
  };
}

function responseEvents(
  attemptId: string,
  input: ReturnType<typeof scorecard>,
): CanonicalStreamEvent[] {
  return [
    {
      type: "block.completed",
      attemptId,
      block: {
        id: "critic_call",
        type: "tool_call",
        toolCallId: "critic_call",
        name: "opendesign_submit_independent_visual_critique",
        input,
      },
    },
    {
      type: "attempt.completed",
      attemptId,
      stopReason: "tool_use",
      usage: {
        inputTokens: 100,
        outputTokens: 100,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
      },
    },
  ];
}

function criticContext(
  phase: "draft" | "final" = "draft",
): DesignVisualCriticContext {
  const plan = logoPlan();
  return {
    runId: "run_logo",
    modelSelection: {
      providerId: "provider",
      modelId: "vision-model",
      reasoningEffort: "high",
    },
    userRequest: "Design a distinctive OpenDesign logo and desktop app icon.",
    plan,
    target: plan.targets[0],
    observedRevision: 8,
    phase,
    attachment: {
      attachmentId: "capture_logo",
      byteSize: 12_000,
      mimeType: "image/jpeg",
      name: "logo-capture.jpg",
    },
  };
}

function logoPlan(): DesignPlanToolInput {
  return {
    version: 1,
    deliverable: "logo",
    objective: "Create a distinctive logo system",
    outputMode: "editable-composition",
    targets: [
      {
        targetId: "logo-system",
        label: "Selected Logo System",
        pageId: "page_logo",
        objective: "Create the selected logo system",
        artboard: {
          mode: "create",
          frameId: "logo_artboard",
          x: 0,
          y: 0,
          width: 1200,
          height: 900,
        },
        composition: {
          assetIntegration: "Editable vector specimens only",
          direction: "Compare silhouette, wordmark, and icon specimens",
          hierarchy: ["symbol", "wordmark"],
          spacingRhythm: "Optical specimen spacing",
          regions: [
            {
              nodeId: "logo_region",
              name: "Logo specimens",
              role: "graphic",
              x: 40,
              y: 40,
              width: 1120,
              height: 820,
            },
          ],
        },
        editableLayers: ["symbol", "wordmark", "specimens"],
        implementationSteps: ["symbol", "wordmark", "small-size tests"],
        validationChecks: ["silhouette", "optical balance"],
        qualityProfile: { kind: "graphic" },
      },
    ],
    visualSystem: {
      avoidances: ["generic square tile", "sparkle"],
      formLanguage: "Ownable asymmetric open contour",
      palette: ["#111111", "#2f6bff", "#ffffff"],
      surfaceAndDepth: "Flat monochrome-first identity",
      typography: ["Custom wordmark relationship"],
      effects: ["No decorative effect dependency"],
    },
    rasterAssetRoles: [],
    componentStrategy: {
      summary: "Logo specimens remain reusable Component instances.",
      candidates: [],
    },
    briefFidelity: {
      requiredContent: ["symbol", "wordmark", "small-size tests"],
      preservedSemantics: ["OpenDesign brand"],
      prohibitedAdditions: ["generic square tile"],
      assumptions: [],
    },
    designIntent: {
      subject: "OpenDesign AI-native professional design platform",
      audience: "Professional designers using a desktop design tool",
      primaryJob: "Recognize OpenDesign at app-icon and wordmark sizes",
      visualThesis: "Open structure becomes a precise ownable contour",
      signatureMotif: "One open counterform creates the identifying gesture",
      typographyLanguage: "Restrained wordmark with optical edits",
      colorMaterialLanguage: "Black and white first with restrained blue",
      compositionTension: "Specimens expose silhouette before explanation",
      antiPatterns: ["generic tile", "sparkle"],
    },
    skillRefs: BUILTIN_LOGO_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    logoExploration: {
      targetId: "logo-system",
      directions: [
        {
          conceptId: "open-contour",
          label: "Open Contour",
          principle: "path-contour",
          thesis: "One open contour creates an ownable silhouette",
          constructionLogic: "A continuous contour defines aperture and edge",
          rootNodeId: "logo_direction",
          monochromeNodeId: "logo_monochrome",
          smallSizeNodeIds: ["logo_16", "logo_24", "logo_32"],
        },
      ],
    },
  };
}
