import {
  executableJsonSchema,
  schemaValidationIssues,
} from "@opendesign/design-contracts";

export type SvgInterchangeIssueSeverity = "error" | "warning";

export const SVG_INTERCHANGE_ISSUE_CODES = [
  "angular-gradient-flattened",
  "boolean-flattened",
  "depth-limit",
  "effect-omitted",
  "element-limit",
  "empty-geometry",
  "external-reference",
  "frame-clipping-omitted",
  "invalid-dimension",
  "invalid-geometry",
  "invalid-root",
  "invalid-transform",
  "line-endpoint-unsupported",
  "malformed-svg",
  "mask-omitted",
  "missing-boolean-geometry",
  "multiple-paints-flattened",
  "regular-shape-fidelity-unsupported",
  "size-limit",
  "stroke-alignment-flattened",
  "text-fidelity-unsupported",
  "text-font-not-embedded",
  "text-layout-fidelity",
  "unsupported-css",
  "unsupported-element",
  "unsupported-filter",
  "unsupported-gradient",
  "unsupported-paint",
  "unsafe-xml",
] as const;

export type SvgInterchangeIssueCode =
  (typeof SVG_INTERCHANGE_ISSUE_CODES)[number];

export interface SvgInterchangeIssue {
  code: SvgInterchangeIssueCode;
  message: string;
  nodeId?: string;
  severity: SvgInterchangeIssueSeverity;
  sourceElement?: string;
}

const BOUNDED_IDENTIFIER_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 512,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;

export const SvgInterchangeIssueSchema = executableJsonSchema({
  type: "object",
  properties: {
    code: { enum: [...SVG_INTERCHANGE_ISSUE_CODES] },
    message: { type: "string", minLength: 1, maxLength: 10_000 },
    nodeId: BOUNDED_IDENTIFIER_SCHEMA,
    severity: { enum: ["error", "warning"] },
    sourceElement: { type: "string", minLength: 1, maxLength: 512 },
  },
  required: ["code", "message", "severity"],
  additionalProperties: false,
});

export function createSvgIssue(
  code: SvgInterchangeIssueCode,
  severity: SvgInterchangeIssueSeverity,
  message: string,
  context: Pick<SvgInterchangeIssue, "nodeId" | "sourceElement"> = {},
): SvgInterchangeIssue {
  return { code, severity, message, ...context };
}

export function svgIssuesHaveErrors(
  issues: readonly SvgInterchangeIssue[],
): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function reportUnsupportedSvgElementAttributes(
  element: Element,
  issues: SvgInterchangeIssue[],
): void {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const name = attribute.name.toLowerCase();
    if (name.startsWith("on")) {
      issues.push(
        createSvgIssue(
          "unsafe-xml",
          "error",
          `SVG event attribute ${attribute.name} is not accepted`,
          { sourceElement: element.localName },
        ),
      );
      continue;
    }
    if (name === "class") {
      issues.push(
        createSvgIssue(
          "unsupported-css",
          "warning",
          "SVG class selectors are not resolved by the editable import boundary",
          { sourceElement: element.localName },
        ),
      );
    }
  }
}

/**
 * Validates the bounded fidelity report shared across Renderer/Main/Agent.
 * This entrypoint intentionally has no XML or geometry dependencies.
 */
export function isSvgInterchangeIssue(
  value: unknown,
): value is SvgInterchangeIssue {
  return schemaValidationIssues(SvgInterchangeIssueSchema, value).length === 0;
}
