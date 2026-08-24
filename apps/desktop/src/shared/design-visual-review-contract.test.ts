import {
  builtinDesignSkillRefsForDeliverable,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_VISUAL_REVIEW_CANONICAL_INPUT_SCHEMA,
  DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
  DesignVisualReviewContract,
  type DesignVisualReviewModelInput,
} from "./design-agent-plan-review";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_REVIEW_TOOL_NAME,
} from "./design-agent-tools";

describe("Visual Review contract", () => {
  it("uses one disclosed structure schema and binds active Plan skills", () => {
    const input = review();
    expect(DesignVisualReviewContract.schema).toBe(
      DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
    );
    expect(DesignVisualReviewContract.canonicalSchema).toBe(
      DESIGN_VISUAL_REVIEW_CANONICAL_INPUT_SCHEMA,
    );
    expect(
      schemaValidationIssues(DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA, input),
    ).toHaveLength(0);

    const logoSkillRefs = builtinDesignSkillRefsForDeliverable("logo");
    expect(
      DesignVisualReviewContract.parse(
        { ...input, skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS },
        { skillRefs: logoSkillRefs },
      ),
    ).toEqual({
      ok: true,
      value: { ...input, skillRefs: logoSkillRefs },
    });
  });

  it("requires trusted host skill binding for canonical output", () => {
    expect(DesignVisualReviewContract.parse(review())).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_visual_review.host_skill_binding_invalid",
          path: "/skillRefs",
        }),
      ],
    });
    expect(
      DesignVisualReviewContract.parse(
        { ...review(), skillRefs: [{ id: "unknown-review-method" }] },
        { canonical: true },
      ),
    ).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_visual_review.skill_refs_invalid",
          path: "/skillRefs",
        }),
      ],
    });
  });

  it("returns action-specific schema paths without duplicate root errors", () => {
    const input = review();
    const { composition: _composition, ...missingComposition } = input;
    expect(_composition).toContain("dominant");
    expect(DesignVisualReviewContract.issues(missingComposition)).toEqual([
      expect.objectContaining({
        code: "design_visual_review.schema_invalid",
        path: "/composition",
      }),
    ]);

    expect(
      DesignVisualReviewContract.issues({
        ...input,
        failedCriteria: ["craft-precision", "craft-precision"],
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_visual_review.schema_invalid",
          path: "/failedCriteria",
        }),
      ]),
    );
  });

  it("keeps visible-evidence quality in one domain refinement", () => {
    const input = review();
    expect(
      DesignVisualReviewContract.issues({
        ...input,
        hierarchy: "Looks good....",
        criteria: {
          ...input.criteria,
          "visual-thesis": "Looks good....",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_visual_review.evidence_not_substantive",
          path: "/hierarchy",
        }),
        expect.objectContaining({
          code: "design_visual_review.criterion_not_substantive",
          path: "/criteria/visual-thesis",
        }),
      ]),
    );
  });

  it("wires Pi validation to the same model contract", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_REVIEW_TOOL_NAME,
    );
    expect(tool).toHaveProperty(
      "validateInputIssues",
      DesignVisualReviewContract.issues,
    );
  });
});

function review(): DesignVisualReviewModelInput {
  return {
    version: 1,
    briefFidelity:
      "The capture preserves the requested product structure without invented capability.",
    distinctiveness:
      "The asymmetric signal workspace is recognizable beyond a generic dashboard.",
    signatureMotif:
      "A continuous signal rail visibly connects navigation and primary work.",
    composition:
      "One dominant work plane and a narrow inspector establish deliberate tension.",
    hierarchy:
      "The primary task and action remain legible before secondary controls.",
    typography:
      "Editorial headings and compact labels have distinct, readable roles.",
    assetIntegration:
      "Icons and imagery align with the control grid and support the subject.",
    formAndSurface:
      "Neutral planes and restrained borders create a coherent depth system.",
    effects:
      "Selection and focus effects are visible without obscuring the content.",
    antiTemplate:
      "The capture avoids equal card grids, ornamental gradients, and generic rings.",
    criteria: {
      "visual-thesis":
        "The operational signal thesis is visible in the dominant work plane.",
      "signature-motif":
        "The signal rail remains visible across navigation and content.",
      "composition-tension":
        "The asymmetric split establishes one dominant region and one support edge.",
      "typography-character":
        "Type roles are distinct and preserve the requested professional character.",
      "material-coherence":
        "Neutral planes and one accent form a consistent material system.",
      "template-avoidance":
        "The capture avoids repeated cards and unrelated decorative primitives.",
      "glance-legibility":
        "The primary task and action remain clear at thumbnail scale.",
      "subject-specificity":
        "The composition remains tied to the requested design workspace subject.",
      "craft-precision":
        "Spacing and control proportions still need deliberate refinement.",
    },
    failedCriteria: ["composition-tension", "craft-precision"],
    refinements: [
      "Increase the primary work plane width and reduce inspector contrast.",
      "Remove secondary borders and normalize control spacing.",
    ],
  };
}
