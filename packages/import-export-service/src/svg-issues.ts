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
  if (!isRecord(value)) return false;
  return (
    typeof value.code === "string" &&
    SVG_INTERCHANGE_ISSUE_CODES.includes(
      value.code as SvgInterchangeIssueCode,
    ) &&
    typeof value.message === "string" &&
    value.message.length > 0 &&
    value.message.length <= 10_000 &&
    (value.nodeId === undefined || boundedIdentifier(value.nodeId)) &&
    (value.sourceElement === undefined ||
      (typeof value.sourceElement === "string" &&
        value.sourceElement.length > 0 &&
        value.sourceElement.length <= 512)) &&
    (value.severity === "error" || value.severity === "warning") &&
    Object.keys(value).every((key) =>
      ["code", "message", "nodeId", "severity", "sourceElement"].includes(key),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 32 || code === 127;
    })
  );
}
