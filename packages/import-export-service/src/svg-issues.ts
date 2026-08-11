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
  "size-limit",
  "stroke-alignment-flattened",
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
