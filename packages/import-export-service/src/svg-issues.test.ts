import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  createSvgIssue,
  isSvgInterchangeIssue,
  reportUnsupportedSvgElementAttributes,
  svgIssuesHaveErrors,
  type SvgInterchangeIssue,
} from "./svg-issues.js";

describe("SVG fidelity issues", () => {
  it("creates and classifies one stable structured issue format", () => {
    const warning = createSvgIssue(
      "unsupported-css",
      "warning",
      "Class selectors are not preserved",
      { sourceElement: "rect" },
    );
    const error = createSvgIssue(
      "unsafe-xml",
      "error",
      "Event handlers are rejected",
      { sourceElement: "rect" },
    );

    expect(isSvgInterchangeIssue(warning)).toBe(true);
    expect(svgIssuesHaveErrors([warning])).toBe(false);
    expect(svgIssuesHaveErrors([warning, error])).toBe(true);
  });

  it("reports unsupported attributes without duplicating mask policy", () => {
    const element = new DOMParser().parseFromString(
      '<rect class="hero" mask="url(#mask)" onclick="run()"/>',
      "image/svg+xml",
    ).documentElement;
    const issues: SvgInterchangeIssue[] = [];

    reportUnsupportedSvgElementAttributes(element, issues);

    expect(issues).toEqual([
      expect.objectContaining({
        code: "unsupported-css",
        severity: "warning",
        sourceElement: "rect",
      }),
      expect.objectContaining({
        code: "unsafe-xml",
        severity: "error",
        sourceElement: "rect",
      }),
    ]);
  });
});
