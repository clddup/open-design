import { describe, expect, it } from "vitest";
import { logoColorDomainIssues } from "./design-logo-color";

const strategy = {
  mode: "brand-color" as const,
  rationale:
    "Electric blue expresses precise creative action in the primary mark.",
  lightDarkAdaptation:
    "Use deep blue on light surfaces and a brighter optical blue on dark surfaces.",
};

describe("Logo color strategy", () => {
  it("keeps aesthetic color judgment out of structural validation", () => {
    expect(
      logoColorDomainIssues({
        deliverable: "logo",
        palette: ["#111111", "#FFFFFF"],
        directionColors: [
          { palette: ["#111111", "#FFFFFF"] },
          { palette: ["#111111", "#FFFFFF"] },
        ],
      }),
    ).toEqual([]);
  });

  it("does not add a hidden prompt-language gate for a declared monochrome strategy", () => {
    const monochrome = {
      ...strategy,
      mode: "monochrome-by-brief" as const,
    };
    expect(
      logoColorDomainIssues({
        deliverable: "logo",
        palette: ["#111111", "#FFFFFF"],
        strategy: monochrome,
      }),
    ).toEqual([]);
  });

  it("rejects Logo-only metadata on another deliverable", () => {
    expect(
      logoColorDomainIssues({
        deliverable: "ui",
        palette: ["#2563EB"],
        strategy,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_plan.logo_color_strategy_wrong_deliverable",
        path: "/logoColorStrategy",
      }),
    );
  });
});
