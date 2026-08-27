import { describe, expect, it } from "vitest";
import {
  logoBriefExplicitlyRequiresMonochrome,
  logoColorDomainIssues,
  paletteHasChromaticColor,
} from "./design-logo-color";

const strategy = {
  mode: "brand-color" as const,
  rationale:
    "Electric blue expresses precise creative action in the primary mark.",
  lightDarkAdaptation:
    "Use deep blue on light surfaces and a brighter optical blue on dark surfaces.",
};

describe("Logo color strategy", () => {
  it("distinguishes chromatic palettes from monochrome tests", () => {
    expect(paletteHasChromaticColor(["#111111", "#FFFFFF"])).toBe(false);
    expect(paletteHasChromaticColor(["#111827 ink", "#2F6BFF action"])).toBe(
      true,
    );
    expect(paletteHasChromaticColor(["electric violet", "soft white"])).toBe(
      true,
    );
  });

  it("does not confuse a requested monochrome variant with a monochrome-only identity", () => {
    expect(
      logoBriefExplicitlyRequiresMonochrome(
        "Include monochrome and 16 px tests for the final logo.",
      ),
    ).toBe(false);
    expect(
      logoBriefExplicitlyRequiresMonochrome(
        "The primary identity must be monochrome only.",
      ),
    ).toBe(true);
    expect(
      logoBriefExplicitlyRequiresMonochrome("主 Logo 仅需使用纯黑白"),
    ).toBe(true);
  });

  it("requires primary brand color and distinct exploration color systems", () => {
    const issues = logoColorDomainIssues({
      deliverable: "logo",
      palette: ["#111111", "#FFFFFF"],
      strategy,
      directionColors: [
        { palette: ["#111111", "#FFFFFF"] },
        { palette: ["#2F6BFF", "#FFFFFF"] },
        { palette: ["#2f6bff", "#ffffff"] },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_plan.logo_brand_color_required",
          path: "/visualSystem/palette",
        }),
        expect.objectContaining({
          code: "design_plan.logo_direction_brand_color_required",
          path: "/logoExploration/directions/0/colorSystem/palette",
        }),
        expect.objectContaining({
          code: "design_plan.logo_direction_color_system_duplicated",
          path: "/logoExploration/directions/2/colorSystem/palette",
        }),
      ]),
    );
  });

  it("accepts monochrome as primary only when the authoritative brief says so", () => {
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
    ).toContainEqual(
      expect.objectContaining({
        code: "design_plan.logo_monochrome_not_requested",
        path: "/logoColorStrategy/mode",
      }),
    );
    expect(
      logoColorDomainIssues({
        authoritativePrompt: "Include a monochrome variant and color app icon.",
        deliverable: "logo",
        palette: ["#111111", "#FFFFFF"],
        strategy: monochrome,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_plan.logo_monochrome_not_requested",
        path: "/logoColorStrategy/mode",
      }),
    );
    expect(
      logoColorDomainIssues({
        authoritativePrompt: "The primary identity must be monochrome only.",
        deliverable: "logo",
        palette: ["#111111", "#FFFFFF"],
        strategy: monochrome,
      }),
    ).toEqual([]);
  });
});
