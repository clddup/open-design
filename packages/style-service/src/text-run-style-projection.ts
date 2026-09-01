import type {
  DesignNode,
  SharedStyleDefinition,
  TextRunStyle,
} from "@opendesign/design-contracts";

export interface TextRunStyleProjectionIssue {
  code: "incompatible-reference" | "missing-style";
  message: string;
  nodeId: string;
  path: string;
  styleId: string;
}

type StyleResolver = (styleId: string) => SharedStyleDefinition | undefined;

export function textRunUsesAnyStyle(node: DesignNode): boolean {
  return (
    node.kind === "text" &&
    (node.properties.runs ?? []).some(
      (run) =>
        run.style.textStyleId !== undefined ||
        run.style.fillStyleId !== undefined,
    )
  );
}

export function materializeTextRunStyles(
  node: DesignNode,
  resolveStyle: StyleResolver,
): TextRunStyleProjectionIssue[] {
  if (node.kind !== "text" || !node.properties.runs) return [];
  const issues: TextRunStyleProjectionIssue[] = [];
  node.properties.runs = node.properties.runs.map((run, index) => {
    const style = structuredClone(run.style);
    materializeTextStyle(node.id, index, style, resolveStyle, issues);
    materializeFillStyle(node.id, index, style, resolveStyle, issues);
    return { ...run, style };
  });
  return issues;
}

function materializeTextStyle(
  nodeId: string,
  runIndex: number,
  target: TextRunStyle,
  resolveStyle: StyleResolver,
  issues: TextRunStyleProjectionIssue[],
): void {
  const styleId = target.textStyleId;
  if (!styleId) return;
  const style = resolveStyle(styleId);
  if (!style || style.styleType !== "TEXT") {
    issues.push(styleIssue(nodeId, runIndex, "textStyleId", styleId, style));
    return;
  }
  Object.assign(target, {
    fontFamily: style.textStyle.fontFamily,
    fontStyleName: style.textStyle.fontStyleName,
    fontSize: style.textStyle.fontSize,
    fontWeight: style.textStyle.fontWeight,
    fontSlant: style.textStyle.fontSlant,
    letterSpacing: style.textStyle.letterSpacing,
    lineHeight: style.textStyle.lineHeight,
    textCase: style.textStyle.textCase,
    textDecoration: style.textStyle.textDecoration,
  });
}

function materializeFillStyle(
  nodeId: string,
  runIndex: number,
  target: TextRunStyle,
  resolveStyle: StyleResolver,
  issues: TextRunStyleProjectionIssue[],
): void {
  const styleId = target.fillStyleId;
  if (!styleId) return;
  const style = resolveStyle(styleId);
  if (!style || style.styleType !== "PAINT") {
    issues.push(styleIssue(nodeId, runIndex, "fillStyleId", styleId, style));
    return;
  }
  target.fills = structuredClone(style.paints);
}

function styleIssue(
  nodeId: string,
  runIndex: number,
  field: "fillStyleId" | "textStyleId",
  styleId: string,
  style: SharedStyleDefinition | undefined,
): TextRunStyleProjectionIssue {
  return {
    code: style ? "incompatible-reference" : "missing-style",
    path: `/nodesById/${pointer(nodeId)}/properties/runs/${runIndex}/style/${field}`,
    message: style
      ? `Text run ${field} cannot consume ${style.styleType} style ${styleId}`
      : `Style ${styleId} does not exist`,
    nodeId,
    styleId,
  };
}

function pointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
