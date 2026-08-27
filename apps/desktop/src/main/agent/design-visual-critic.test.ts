import { BUILTIN_LOGO_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import type {
  CanonicalStreamEvent,
  ModelRequest,
} from "@opendesign/model-gateway";
import { describe, expect, it } from "vitest";
import type { DesignPlanToolInput } from "@/shared/design-agent-tools.js";
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
  "black-silhouette",
  "counterform-contour",
  "optical-balance",
  "small-size-recognition",
  "monochrome-integrity",
  "brand-color-system",
  "concept-divergence",
  "color-system-divergence",
  "logo-concept-open-contour-quality",
  "logo-concept-modular-path-quality",
  "logo-concept-spatial-link-quality",
  "symbol-wordmark-relationship",
  "app-icon-optical-redraw",
  "app-icon-ecosystem-distinction",
  "component-system-integrity",
] as const;

const singleMarkCriterionIds = [
  "visual-thesis",
  "signature-motif",
  "composition-tension",
  "typography-character",
  "material-coherence",
  "template-avoidance",
  "glance-legibility",
  "subject-specificity",
  "craft-precision",
  "black-silhouette",
  "counterform-contour",
  "optical-balance",
  "small-size-recognition",
  "monochrome-integrity",
  "brand-color-system",
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

  it("treats primary brand color, exploration color divergence, and desktop icon distinction as critical", async () => {
    const weakColor = scorecard(4);
    weakColor.criteria["brand-color-system"] = {
      score: 2,
      evidence:
        "The primary marks are only black and white while blue appears only in the presentation caption.",
      refinement:
        "Apply one brief-specific brand color to the primary mark and show its light/dark adaptations.",
    };
    weakColor.criteria["color-system-divergence"] = {
      score: 3,
      evidence:
        "All three directions reuse the same blue-white palette with no distinct semantic role.",
      refinement:
        "Give each concept a materially different color system tied to its own thesis.",
    };
    weakColor.criteria["app-icon-ecosystem-distinction"] = {
      score: 3,
      evidence:
        "The icon reads as a generic monochrome tile among other desktop application icons.",
      refinement:
        "Rebalance color mass and negative space for recognizable macOS and Windows icon contexts.",
    };

    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) =>
          Promise.resolve(responseEvents(request.attemptId, weakColor)),
      },
      criticContext("final"),
      new AbortController().signal,
    );

    expect(result.passed).toBe(false);
    expect(result.failedCriteria).toEqual(
      expect.arrayContaining([
        "brand-color-system",
        "color-system-divergence",
        "app-icon-ecosystem-distinction",
      ]),
    );
  });

  it("reviews one requested Logo/Icon without invented exploration or system criteria", async () => {
    const context = criticContext("final");
    context.plan.logoOutputs = ["symbol"];
    delete context.plan.logoExploration;
    let capturedRequest: Omit<ModelRequest, "signal"> | undefined;
    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) => {
          capturedRequest = request;
          return Promise.resolve(
            responseEvents(
              request.attemptId,
              scorecardFor(singleMarkCriterionIds, 4),
            ),
          );
        },
      },
      context,
      new AbortController().signal,
    );

    expect(result.passed).toBe(true);
    expect(result.criteria).not.toHaveProperty("concept-divergence");
    expect(result.criteria).not.toHaveProperty("color-system-divergence");
    expect(result.criteria).not.toHaveProperty("app-icon-optical-redraw");
    expect(result.criteria).not.toHaveProperty(
      "app-icon-ecosystem-distinction",
    );
    expect(result.criteria).not.toHaveProperty("component-system-integrity");
    expect(JSON.stringify(capturedRequest?.tools)).not.toContain(
      "concept-divergence",
    );
  });

  it("rejects an exploration when its third direction is filler even if the other directions pass", async () => {
    const weakThirdDirection = scorecard(4);
    weakThirdDirection.criteria["logo-concept-spatial-link-quality"] = {
      score: 2,
      evidence:
        "The third direction is two arbitrary blobs whose 24 and 16 px specimens collapse into unrelated noise.",
      refinement:
        "Replace the third direction with a constructed silhouette whose identifying contour survives at 16 px without its caption.",
    };

    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) =>
          Promise.resolve(
            responseEvents(request.attemptId, weakThirdDirection),
          ),
      },
      criticContext("final"),
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      passed: false,
      failedCriteria: ["logo-concept-spatial-link-quality"],
    });
    expect(result.refinements).toContain(
      "Replace the third direction with a constructed silhouette whose identifying contour survives at 16 px without its caption.",
    );
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

  it("reviews declared visual references as a non-compensating criterion", async () => {
    const attachmentId = `image_${"a".repeat(64)}`;
    const context = criticContext("final");
    context.plan.referenceStrategy = {
      synthesis:
        "Transfer the reference's editorial contrast without copying its subject or layout literally.",
      references: [
        {
          attachmentId,
          decision: "style-reference",
          application:
            "Use the reference's hard tonal contrast and restrained material hierarchy.",
          preserve: ["hard tonal contrast"],
          avoid: ["literal composition copy"],
        },
      ],
    };
    context.referenceAttachments = [
      {
        attachmentId,
        name: "reference.png",
        mimeType: "image/png",
        byteSize: 4_000,
      },
    ];
    let capturedRequest: Omit<ModelRequest, "signal"> | undefined;
    const referencedScorecard = {
      ...scorecard(4),
      criteria: {
        ...scorecard(4).criteria,
        "reference-adherence": {
          score: 2,
          evidence:
            "The delivery ignores the reference's hard tonal contrast and material hierarchy.",
          refinement:
            "Rebuild the dominant tonal relationship while preserving the original content.",
        },
      },
    };

    const result = await runIndependentDesignVisualCritic(
      {
        complete: (request) => {
          capturedRequest = request;
          return Promise.resolve(
            responseEvents(request.attemptId, referencedScorecard),
          );
        },
      },
      context,
      new AbortController().signal,
    );

    expect(result.failedCriteria).toContain("reference-adherence");
    const message = capturedRequest?.messages[0];
    if (message?.role !== "user" || !Array.isArray(message.content)) {
      throw new Error("Critic reference request is missing multimodal content");
    }
    expect(
      message.content.filter((block) => block.type === "image_ref"),
    ).toHaveLength(2);
    expect(message.content.at(-1)).toMatchObject({
      type: "image_ref",
      attachmentId,
    });
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
  return scorecardFor(criterionIds, score);
}

function scorecardFor(
  ids: readonly string[],
  score: number,
): ReturnType<typeof scorecard> {
  return {
    summary:
      "The exact revision shows a coherent logo system with visible small-size specimens.",
    criteria: Object.fromEntries(
      ids.map((id) => [
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
    referenceAttachments: [],
  };
}

function logoPlan(): DesignPlanToolInput {
  return {
    version: 1,
    deliverable: "logo",
    logoOutputs: ["symbol", "wordmark", "app-icon", "lockups"],
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
      surfaceAndDepth: "Flat color-led identity with monochrome variants",
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
      calibration: {
        surfaceMode: "graphic",
        expressiveness: "balanced",
        density: "airy",
      },
      visualThesis: "Open structure becomes a precise ownable contour",
      signatureMotif: "One open counterform creates the identifying gesture",
      typographyLanguage: "Restrained wordmark with optical edits",
      colorMaterialLanguage:
        "A precise electric blue primary carries recognition while black and white remain proof variants",
      compositionTension: "Specimens expose silhouette before explanation",
      antiPatterns: ["generic tile", "sparkle"],
    },
    skillRefs: BUILTIN_LOGO_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    logoColorStrategy: {
      mode: "brand-color",
      rationale:
        "Electric blue signals precise creative action and belongs to the primary mark rather than its presentation board.",
      lightDarkAdaptation:
        "Use the deeper blue on light surfaces and a brighter optical blue with white counterforms on dark surfaces.",
    },
    logoExploration: {
      targetId: "logo-system",
      directions: [
        {
          conceptId: "open-contour",
          label: "Open Contour",
          principle: "path-contour",
          thesis: "One open contour creates an ownable silhouette",
          constructionLogic: "A continuous contour defines aperture and edge",
          colorSystem: {
            palette: ["#2F6BFF", "#111827", "#EFF4FF"],
            rationale:
              "Electric blue energizes the open contour while deep ink preserves precision.",
          },
          rootNodeId: "logo_direction",
          monochromeNodeId: "logo_monochrome",
          smallSizeNodeIds: ["logo_32", "logo_24", "logo_16"],
        },
        {
          conceptId: "modular-path",
          label: "Modular Path",
          principle: "modular-system",
          thesis: "A modular path creates a precise recognizable system",
          constructionLogic:
            "Repeated modules lock into one asymmetric identifying contour",
          colorSystem: {
            palette: ["#F97316", "#431407", "#FFF7ED"],
            rationale:
              "Signal orange makes modular assembly feel active and materially distinct.",
          },
          rootNodeId: "logo_direction_modular",
          monochromeNodeId: "logo_monochrome_modular",
          smallSizeNodeIds: [
            "logo_modular_32",
            "logo_modular_24",
            "logo_modular_16",
          ],
        },
        {
          conceptId: "spatial-link",
          label: "Spatial Link",
          principle: "spatial-layering",
          thesis: "An open spatial link expresses structured collaboration",
          constructionLogic:
            "Two interlocking planes preserve one deliberate open counterform",
          colorSystem: {
            palette: ["#8B5CF6", "#2E1065", "#F5F3FF"],
            rationale:
              "Violet separates the interlocking planes while maintaining one ownable silhouette.",
          },
          rootNodeId: "logo_direction_spatial",
          monochromeNodeId: "logo_monochrome_spatial",
          smallSizeNodeIds: [
            "logo_spatial_32",
            "logo_spatial_24",
            "logo_spatial_16",
          ],
        },
      ],
    },
  };
}
