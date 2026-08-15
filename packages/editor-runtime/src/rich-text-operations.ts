import type {
  DesignNode,
  DesignOperation,
  TextRun,
  TextRunStyle,
} from "@opendesign/design-contracts";
import {
  applyTextRangeStyle,
  remapTextStyleRunsAfterContentChange,
  validateTextStyleRuns,
} from "@opendesign/text-service";
import { OperationError } from "./operation-error.js";

type TextNode = Extract<DesignNode, { kind: "text" }>;
type RangeCommand = Extract<
  DesignOperation,
  { type: "update_text_range_style" }
>;

const RUN_STYLE_FIELDS = [
  "fontFamily",
  "fontStyleName",
  "fontSize",
  "fontWeight",
  "fontSlant",
  "letterSpacing",
  "lineHeight",
  "textCase",
  "textDecoration",
  "fills",
] as const;

export function normalizeTextNodeRuns(node: TextNode, commandId: string): void {
  node.properties.runs ??= [];
  const issue = validateTextStyleRuns(
    node.properties.content,
    node.properties.runs,
  );
  if (issue) throw invalidRuns(node.id, commandId, issue);
}

export function prepareTextPropertiesUpdate(
  node: TextNode,
  properties: Readonly<Record<string, unknown>> | undefined,
  commandId: string,
): void {
  normalizeTextNodeRuns(node, commandId);
  if (!properties) return;
  const previousContent = node.properties.content;
  const nextContent =
    typeof properties.content === "string"
      ? properties.content
      : previousContent;
  let runs = node.properties.runs ?? [];
  if (nextContent !== previousContent) {
    try {
      runs = remapTextStyleRunsAfterContentChange(
        previousContent,
        nextContent,
        runs,
        textRunBaseStyle(node),
        "before",
        sameRunStyle,
      ).runs;
    } catch (error) {
      throw invalidRuns(
        node.id,
        commandId,
        error instanceof Error ? error.message : "Text run remap failed",
      );
    }
  }
  const patch = Object.fromEntries(
    RUN_STYLE_FIELDS.flatMap((field) =>
      Object.hasOwn(properties, field) ? [[field, properties[field]]] : [],
    ),
  );
  if (Object.keys(patch).length > 0 && runs.length > 0) {
    runs = runs.map((run) => ({
      ...run,
      style: patchRunStyle(run.style, patch),
    }));
  }
  node.properties.runs = compactRuns(runs, {
    ...textRunBaseStyle(node),
    ...patch,
  } as TextRunStyle);
}

export function updateTextRangeStyle(
  node: TextNode,
  command: RangeCommand,
): void {
  normalizeTextNodeRuns(node, command.commandId);
  if (Object.keys(command.style).length === 0) {
    throw new OperationError(
      command.commandId,
      "Text range style update must change at least one field",
      "invalid",
      { path: `/nodesById/${escapePointer(node.id)}/properties/runs` },
    );
  }
  let next: TextRun[];
  try {
    next = applyTextRangeStyle(
      node.properties.content,
      node.properties.runs ?? [],
      textRunBaseStyle(node),
      { start: command.start, end: command.end },
      (style) => patchRunStyle(style, command.style),
      sameRunStyle,
    );
  } catch (error) {
    throw new OperationError(
      command.commandId,
      error instanceof Error ? error.message : "Text range update failed",
      "invalid",
      { path: `/nodesById/${escapePointer(node.id)}/properties/runs` },
    );
  }
  next = compactRuns(next, textRunBaseStyle(node));
  if (sameRuns(next, node.properties.runs ?? [])) {
    throw new OperationError(
      command.commandId,
      "Text range already uses the requested style",
      "invalid",
      { details: { code: "no-op", nodeId: node.id } },
    );
  }
  node.properties.runs = next;
}

export function textRunBaseStyle(node: TextNode): TextRunStyle {
  return {
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    fills: structuredClone(node.properties.fills),
    ...(node.textStyleId ? { textStyleId: node.textStyleId } : {}),
    ...(node.fillStyleId ? { fillStyleId: node.fillStyleId } : {}),
  };
}

function patchRunStyle(
  style: TextRunStyle,
  patch: Readonly<Record<string, unknown>>,
): TextRunStyle {
  const next = structuredClone(style) as Record<string, unknown>;
  if (
    !Object.hasOwn(patch, "textStyleId") &&
    [
      "fontFamily",
      "fontStyleName",
      "fontSize",
      "fontWeight",
      "fontSlant",
      "letterSpacing",
      "lineHeight",
      "textCase",
      "textDecoration",
    ].some((field) => Object.hasOwn(patch, field))
  ) {
    delete next.textStyleId;
  }
  if (!Object.hasOwn(patch, "fillStyleId") && Object.hasOwn(patch, "fills")) {
    delete next.fillStyleId;
  }
  for (const [field, value] of Object.entries(patch)) {
    if (
      value === null &&
      (field === "textStyleId" || field === "fillStyleId")
    ) {
      delete next[field];
    } else {
      next[field] = structuredClone(value);
    }
  }
  return next as TextRunStyle;
}

function compactRuns(
  runs: readonly TextRun[],
  baseStyle: TextRunStyle,
): TextRun[] {
  if (
    runs.length === 1 &&
    runs[0]?.start === 0 &&
    sameRunStyle(runs[0].style, baseStyle)
  ) {
    return [];
  }
  const merged: TextRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.end === run.start &&
      sameRunStyle(previous.style, run.style)
    ) {
      previous.end = run.end;
    } else {
      merged.push(structuredClone(run));
    }
  }
  return merged;
}

function sameRunStyle(left: TextRunStyle, right: TextRunStyle): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRuns(
  left: readonly TextRun[],
  right: readonly TextRun[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidRuns(nodeId: string, commandId: string, message: string) {
  return new OperationError(commandId, message, "invalid", {
    path: `/nodesById/${escapePointer(nodeId)}/properties/runs`,
  });
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
