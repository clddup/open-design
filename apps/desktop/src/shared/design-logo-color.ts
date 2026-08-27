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
      minLength: 16,
      maxLength: 1_000,
      pattern: "\\S",
    },
    lightDarkAdaptation: {
      type: "string",
      minLength: 16,
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
  authoritativePrompt?: string;
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
  if (!input.strategy) {
    return [
      issue(
        code("logo_color_strategy_required"),
        "/logoColorStrategy",
        "Logo delivery requires an explicit primary color strategy",
      ),
    ];
  }

  const issues: ValidationIssue[] = [];
  if (
    input.strategy.mode === "monochrome-by-brief" &&
    (input.authoritativePrompt === undefined ||
      !logoBriefExplicitlyRequiresMonochrome(input.authoritativePrompt))
  ) {
    issues.push(
      issue(
        code("logo_monochrome_not_requested"),
        "/logoColorStrategy/mode",
        "Monochrome may be the primary Logo direction only when the user explicitly requests a monochrome-only identity",
      ),
    );
  }
  if (
    input.strategy.mode === "brand-color" &&
    !paletteHasChromaticColor(input.palette)
  ) {
    issues.push(
      issue(
        code("logo_brand_color_required"),
        "/visualSystem/palette",
        "The primary Logo palette must include at least one explicit chromatic brand color; black, white, and gray remain secondary variants",
        input.palette,
      ),
    );
  }

  const signatures = new Map<string, number>();
  input.directionColors?.forEach((direction, index) => {
    const path = `/logoExploration/directions/${index}/colorSystem/palette`;
    if (
      input.strategy?.mode === "brand-color" &&
      !paletteHasChromaticColor(direction.palette)
    ) {
      issues.push(
        issue(
          code("logo_direction_brand_color_required"),
          path,
          "Each explored Logo direction must show a primary chromatic color system in addition to monochrome evidence",
          direction.palette,
        ),
      );
    }
    const signature = paletteSignature(direction.palette);
    const previous = signatures.get(signature);
    if (previous !== undefined) {
      issues.push({
        ...issue(
          code("logo_direction_color_system_duplicated"),
          path,
          "Explored Logo directions must not reuse the same color system",
          direction.palette,
        ),
        expected: `different from /logoExploration/directions/${previous}/colorSystem/palette`,
      });
    } else {
      signatures.set(signature, index);
    }
  });
  return issues;
}

export function logoBriefExplicitlyRequiresMonochrome(prompt: string): boolean {
  return (
    /(?:monochrome|black[\s-]*(?:and|&)[\s-]*white|single[\s-]*color)[\s-]*(?:only|identity)|(?:only|exclusively|strictly|purely)\s+(?:in\s+)?(?:monochrome|black[\s-]*(?:and|&)[\s-]*white|single[\s-]*color)/iu.test(
      prompt,
    ) ||
    /(?:只要|仅要|仅需|只需|限定(?:为)?|必须(?:为|使用|采用)).{0,12}(?:纯)?(?:黑白|单色)|(?:纯)?(?:黑白|单色).{0,8}(?:限定|为主|主方案|即可)/u.test(
      prompt,
    )
  );
}

export function paletteHasChromaticColor(palette: readonly string[]): boolean {
  return palette.some((entry) => {
    const hex = /#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})\b/iu.exec(entry)?.[1];
    if (hex && hexIsChromatic(hex)) return true;
    const saturation = /hsla?\([^,]+,\s*([\d.]+)%/iu.exec(entry)?.[1];
    if (saturation !== undefined && Number(saturation) >= 12) return true;
    return (
      /\b(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|blue|navy|indigo|violet|purple|magenta|pink|rose|coral)\b/iu.test(
        entry,
      ) || /[红橙黄绿青蓝紫粉]/u.test(entry)
    );
  });
}

function hexIsChromatic(value: string): boolean {
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((channel) => `${channel}${channel}`)
          .join("")
      : value.slice(0, 6);
  const channels = [0, 2, 4].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16),
  );
  return Math.max(...channels) - Math.min(...channels) >= 18;
}

function paletteSignature(palette: readonly string[]): string {
  return [...new Set(palette.map((entry) => entry.trim().toLowerCase()))]
    .sort()
    .join("|");
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
