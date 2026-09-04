import type { ValidationIssue } from "./contract-validation";

export const DESIGN_LOGO_COLOR_MODES = [
  "brand-color",
  "monochrome-by-brief",
] as const;

export const DESIGN_LOGO_COLOR_STRATEGY_SCHEMA = {
  type: "object",
  properties: {
    mode: { enum: [...DESIGN_LOGO_COLOR_MODES] },
    rationale: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      pattern: "\\S",
    },
    lightDarkAdaptation: {
      type: "string",
      minLength: 1,
      maxLength: 1_000,
      pattern: "\\S",
    },
  },
  required: ["mode", "rationale", "lightDarkAdaptation"],
  additionalProperties: false,
} as const;

export type DesignLogoColorStrategy = {
  mode: (typeof DESIGN_LOGO_COLOR_MODES)[number];
  rationale: string;
  lightDarkAdaptation: string;
};

export type DesignLogoDirectionColor = {
  palette: string[];
};

export function logoColorDomainIssues(input: {
  codePrefix?: "design_plan" | "first_slice";
  deliverable: string;
  directionColors?: readonly DesignLogoDirectionColor[];
  palette: readonly string[];
  strategy?: DesignLogoColorStrategy;
}): ValidationIssue[] {
  const code = (reason: string) =>
    `${input.codePrefix ?? "design_plan"}.${reason}`;
  if (input.deliverable !== "logo") {
    return input.strategy
      ? [
          issue(
            code("logo_color_strategy_wrong_deliverable"),
            "/logoColorStrategy",
            "Logo color strategy is only valid for a logo deliverable",
          ),
        ]
      : [];
  }
  return [];
}

function issue(
  code: string,
  path: string,
  message: string,
  actual?: string | readonly string[],
): ValidationIssue {
  return {
    code,
    path,
    message,
    ...(actual === undefined
      ? {}
      : { actual: typeof actual === "string" ? actual : [...actual] }),
    recovery:
      "Use color as part of the primary brand identity. Keep monochrome as a required test or variant unless the user's brief explicitly makes it the main identity.",
  };
}
