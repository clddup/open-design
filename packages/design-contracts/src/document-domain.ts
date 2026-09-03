import type { ValidationIssue } from "@opendesign/contract-runtime";
import { isValidLayoutLimits } from "./layout.js";
import type {
  DesignDocument,
  TextNode,
  VectorNetworkProperties,
} from "./public-types.js";
import { advancedTextDecorationIssue } from "./text-decoration.js";
import { vectorNetworkHasBranches } from "./vector-topology.js";

export function designDocumentDomainIssues(
  document: DesignDocument,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    const nodePath = `/nodesById/${escapeJsonPointer(nodeId)}`;
    if (!isValidLayoutLimits(node.layoutLimits)) {
      issues.push({
        code: "design.document_layout_limits_invalid",
        path: `${nodePath}/layoutLimits`,
        message: "Layout minimums must not exceed their matching maximums",
        recovery:
          "Correct the node layout limits; do not rely on the loader to rewrite current document data.",
      });
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties
    ) {
      for (const [
        regionIndex,
        region,
      ] of node.properties.network.regions.entries()) {
        if (
          region.fillStyleId !== undefined &&
          documentStyleType(document, region.fillStyleId) !== "PAINT"
        ) {
          issues.push(
            issue(
              "design.document_vector_region_fill_style_reference_invalid",
              `${nodePath}/properties/network/regions/${regionIndex}/fillStyleId`,
              "Vector region fillStyleId must reference a PAINT style",
            ),
          );
        }
      }
    }
    if (
      (node.kind === "path" || node.kind === "vector") &&
      "network" in node.properties &&
      node.properties.variableWidthStrokeProperties !== undefined
    ) {
      issues.push(...variableWidthStrokeIssues(node.properties, nodePath));
    }
    if (node.kind !== "text") continue;
    const decorationIssue = advancedTextDecorationIssue(node.properties);
    if (decorationIssue) {
      issues.push(
        issue(
          "design.document_text_decoration_invalid",
          `${nodePath}/properties/${decorationIssue.field}`,
          decorationIssue.message,
        ),
      );
    }
    const textRunIssue = validateTextRuns(document, node, nodePath);
    if (textRunIssue) issues.push(textRunIssue);
    const paragraphRunIssue = validateParagraphRuns(node, nodePath);
    if (paragraphRunIssue) issues.push(paragraphRunIssue);
  }
  for (const [styleId, style] of Object.entries(document.stylesById)) {
    if (style.styleType !== "TEXT") continue;
    const decorationIssue = advancedTextDecorationIssue(style.textStyle);
    if (!decorationIssue) continue;
    issues.push(
      issue(
        "design.document_text_style_decoration_invalid",
        `/stylesById/${escapeJsonPointer(styleId)}/textStyle/${decorationIssue.field}`,
        decorationIssue.message,
      ),
    );
  }
  return issues;
}

function variableWidthStrokeIssues(
  properties: VectorNetworkProperties,
  nodePath: string,
): ValidationIssue[] {
  const profile = properties.variableWidthStrokeProperties;
  if (!profile || profile.widthProfile === "UNIFORM") return [];
  if ((properties.dashPattern?.length ?? 0) > 0) {
    return [
      issue(
        "design.document_variable_width_dashed_stroke_unsupported",
        `${nodePath}/properties/dashPattern`,
        "Variable width strokes cannot use a dash pattern",
      ),
    ];
  }
  if (vectorNetworkHasBranches(properties.network)) {
    return [
      issue(
        "design.document_variable_width_branching_network_unsupported",
        `${nodePath}/properties/network`,
        "Variable width strokes cannot be applied to a branching Vector Network",
      ),
    ];
  }
  if (profile.widthProfile !== "CUSTOM") return [];
  for (let index = 1; index < profile.variableWidthPoints.length; index += 1) {
    if (
      profile.variableWidthPoints[index]!.position <=
      profile.variableWidthPoints[index - 1]!.position
    ) {
      return [
        issue(
          "design.document_variable_width_points_unordered",
          `${nodePath}/properties/variableWidthStrokeProperties/variableWidthPoints/${index}/position`,
          "Variable width point positions must be strictly increasing",
        ),
      ];
    }
  }
  return [];
}

function validateTextRuns(
  document: DesignDocument,
  node: TextNode,
  nodePath: string,
): ValidationIssue | undefined {
  const runs = node.properties.runs;
  const path = `${nodePath}/properties/runs`;
  if (!runs) {
    return issue(
      "design.document_text_runs_required",
      path,
      "Text nodes require an explicit rich-text run list",
    );
  }
  const content = node.properties.content;
  if (content.length === 0) {
    return runs.length === 0
      ? undefined
      : issue(
          "design.document_text_runs_nonempty",
          path,
          "An empty text node cannot contain rich-text runs",
        );
  }
  if (runs.length === 0) return undefined;

  let expectedStart = 0;
  let previousStyle: string | undefined;
  for (const [index, run] of runs.entries()) {
    const runPath = `${path}/${index}`;
    const style = JSON.stringify(run.style);
    const decorationIssue = advancedTextDecorationIssue(run.style);
    if (decorationIssue) {
      return issue(
        "design.document_text_run_decoration_invalid",
        `${runPath}/style/${decorationIssue.field}`,
        decorationIssue.message,
      );
    }
    if (run.start !== expectedStart) {
      return issue(
        "design.document_text_runs_not_contiguous",
        `${runPath}/start`,
        `Text run must start at UTF-16 offset ${expectedStart}`,
      );
    }
    if (run.end <= run.start || run.end > content.length) {
      return issue(
        "design.document_text_run_range_invalid",
        `${runPath}/end`,
        "Text run end must follow start and remain within the text content",
      );
    }
    if (
      !isUtf16Boundary(content, run.start) ||
      !isUtf16Boundary(content, run.end)
    ) {
      return issue(
        "design.document_text_run_utf16_split",
        runPath,
        "Text runs cannot split a UTF-16 surrogate pair",
      );
    }
    if (style === previousStyle) {
      return issue(
        "design.document_text_runs_unmerged",
        runPath,
        "Adjacent text runs with identical styles must be merged",
      );
    }
    if (
      run.style.textStyleId !== undefined &&
      documentStyleType(document, run.style.textStyleId) !== "TEXT"
    ) {
      return issue(
        "design.document_text_style_reference_invalid",
        `${runPath}/style/textStyleId`,
        "textStyleId must reference a TEXT style",
      );
    }
    if (
      run.style.fillStyleId !== undefined &&
      documentStyleType(document, run.style.fillStyleId) !== "PAINT"
    ) {
      return issue(
        "design.document_fill_style_reference_invalid",
        `${runPath}/style/fillStyleId`,
        "fillStyleId must reference a PAINT style",
      );
    }
    expectedStart = run.end;
    previousStyle = style;
  }
  return expectedStart === content.length
    ? undefined
    : issue(
        "design.document_text_runs_incomplete",
        path,
        "Rich-text runs must cover the complete text content",
      );
}

function validateParagraphRuns(
  node: TextNode,
  nodePath: string,
): ValidationIssue | undefined {
  const runs = node.properties.paragraphRuns;
  const path = `${nodePath}/properties/paragraphRuns`;
  if (!runs) {
    return issue(
      "design.document_paragraph_runs_required",
      path,
      "Text nodes require an explicit paragraph run list",
    );
  }
  const content = node.properties.content;
  if (content.length === 0) {
    return runs.length === 0
      ? undefined
      : issue(
          "design.document_paragraph_runs_nonempty",
          path,
          "An empty text node cannot contain paragraph runs",
        );
  }
  if (runs.length === 0) return undefined;

  let expectedStart = 0;
  let previousStyle: string | undefined;
  for (const [index, run] of runs.entries()) {
    const runPath = `${path}/${index}`;
    const style = JSON.stringify(run.style);
    if (run.start !== expectedStart) {
      return issue(
        "design.document_paragraph_runs_not_contiguous",
        `${runPath}/start`,
        `Paragraph run must start at offset ${expectedStart}`,
      );
    }
    if (run.end <= run.start || run.end > content.length) {
      return issue(
        "design.document_paragraph_run_range_invalid",
        `${runPath}/end`,
        "Paragraph run end must follow start and remain within the text content",
      );
    }
    if (
      !isParagraphStart(content, run.start) ||
      !isParagraphEnd(content, run.end)
    ) {
      return issue(
        "design.document_paragraph_boundary_invalid",
        runPath,
        "Paragraph runs must align with paragraph boundaries",
      );
    }
    if (run.style.listOptions.type !== "none" && run.style.indentation === 0) {
      return issue(
        "design.document_list_indentation_required",
        `${runPath}/style/indentation`,
        "List paragraphs require non-zero indentation",
      );
    }
    if (style === previousStyle) {
      return issue(
        "design.document_paragraph_runs_unmerged",
        runPath,
        "Adjacent paragraph runs with identical styles must be merged",
      );
    }
    expectedStart = run.end;
    previousStyle = style;
  }
  return expectedStart === content.length
    ? undefined
    : issue(
        "design.document_paragraph_runs_incomplete",
        path,
        "Paragraph runs must cover the complete text content",
      );
}

function documentStyleType(document: DesignDocument, styleId: string) {
  return (
    document.stylesById[styleId] ?? document.libraryStylesById[styleId]?.style
  )?.styleType;
}

function isParagraphStart(content: string, index: number): boolean {
  if (index === 0) return true;
  const previous = content.charCodeAt(index - 1);
  if (previous === 0x0a) return true;
  return previous === 0x0d && content.charCodeAt(index) !== 0x0a;
}

function isParagraphEnd(content: string, index: number): boolean {
  if (index === content.length) return true;
  const previous = content.charCodeAt(index - 1);
  if (previous === 0x0a) return true;
  return previous === 0x0d && content.charCodeAt(index) !== 0x0a;
}

function isUtf16Boundary(content: string, index: number): boolean {
  if (index === 0 || index === content.length) return true;
  const before = content.charCodeAt(index - 1);
  const after = content.charCodeAt(index);
  return !(
    before >= 0xd800 &&
    before <= 0xdbff &&
    after >= 0xdc00 &&
    after <= 0xdfff
  );
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Correct the reported document field; current-version documents are never silently repaired.",
  };
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
