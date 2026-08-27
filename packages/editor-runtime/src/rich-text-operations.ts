import type {
  DesignNode,
  DesignOperation,
  TextParagraphRun,
  TextParagraphStyle,
  TextRun,
  TextRunStyle,
} from "@opendesign/design-contracts";
import {
  applyTextParagraphRangeStyle,
  applyTextRangeStyle,
  remapTextParagraphRunsAfterContentChange,
  remapTextStyleRunsAfterContentChange,
  textParagraphRanges,
  validateTextParagraphRuns,
  validateTextStyleRuns,
} from "@opendesign/text-service";
import { OperationError } from "./operation-error.js";

type TextNode = Extract<DesignNode, { kind: "text" }>;
type RangeCommand = Extract<
  DesignOperation,
  { type: "update_text_range_style" }
>;
type EditCommand = Extract<DesignOperation, { type: "commit_text_edit" }>;

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

const PARAGRAPH_STYLE_FIELDS = [
  "paragraphIndent",
  "paragraphSpacing",
  "listOptions",
  "indentation",
  "listSpacing",
] as const;
const PARAGRAPH_STYLE_FIELD_SET = new Set<string>(PARAGRAPH_STYLE_FIELDS);

export function normalizeTextNodeRuns(node: TextNode, commandId: string): void {
  node.properties.runs ??= [];
  node.properties.paragraphRuns ??= [];
  const issue = validateTextStyleRuns(
    node.properties.content,
    node.properties.runs,
  );
  if (issue) throw invalidRuns(node.id, commandId, issue);
  const paragraphIssue = validateTextParagraphRuns(
    node.properties.content,
    node.properties.paragraphRuns,
  );
  if (paragraphIssue) {
    throw invalidParagraphRuns(node.id, commandId, paragraphIssue);
  }
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
  let paragraphRuns = node.properties.paragraphRuns ?? [];
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
    try {
      paragraphRuns = remapTextParagraphRunsAfterContentChange(
        previousContent,
        nextContent,
        paragraphRuns,
        textParagraphBaseStyle(node),
        "before",
        sameParagraphStyle,
      );
    } catch (error) {
      throw invalidParagraphRuns(
        node.id,
        commandId,
        error instanceof Error ? error.message : "Text paragraph remap failed",
      );
    }
  }
  const patch = Object.fromEntries(
    RUN_STYLE_FIELDS.flatMap((field) =>
      Object.hasOwn(properties, field) ? [[field, properties[field]]] : [],
    ),
  );
  const paragraphPatch = Object.fromEntries(
    PARAGRAPH_STYLE_FIELDS.flatMap((field) =>
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
  });
  if (Object.keys(paragraphPatch).length > 0 && paragraphRuns.length > 0) {
    paragraphRuns = paragraphRuns.map((run) => ({
      ...run,
      style: { ...run.style, ...paragraphPatch },
    }));
  }
  node.properties.paragraphRuns = compactParagraphRuns(paragraphRuns, {
    ...textParagraphBaseStyle(node),
    ...paragraphPatch,
  });
}

export function commitTextEditingSession(
  node: TextNode,
  command: EditCommand,
): void {
  normalizeTextNodeRuns(node, command.commandId);
  const contentChanged = command.content !== node.properties.content;
  if (command.runs) {
    const issue = validateTextStyleRuns(command.content, command.runs);
    if (issue) throw invalidRuns(node.id, command.commandId, issue);
  }
  const committedRuns = command.runs
    ? compactRuns(structuredClone(command.runs), textRunBaseStyle(node))
    : undefined;
  const characterRunsChanged =
    committedRuns !== undefined &&
    !sameRuns(committedRuns, node.properties.runs ?? []);
  if (
    !contentChanged &&
    !characterRunsChanged &&
    command.paragraphPatches.length === 0
  ) {
    throw new OperationError(
      command.commandId,
      "design.text.edit_noop",
      "Text editing session did not change content, character styles, or paragraph styles",
      "invalid",
      { context: { code: "no-op", nodeId: node.id } },
    );
  }
  prepareTextPropertiesUpdate(
    node,
    { content: command.content },
    command.commandId,
  );
  node.properties.content = command.content;
  if (committedRuns) node.properties.runs = committedRuns;
  const paragraphs = textParagraphRanges(command.content);
  const starts = new Set(paragraphs.map((paragraph) => paragraph.start));
  const ends = new Set(paragraphs.map((paragraph) => paragraph.end));
  let previousEnd = -1;
  for (const [index, patch] of command.paragraphPatches.entries()) {
    if (
      patch.start < previousEnd ||
      !starts.has(patch.start) ||
      !ends.has(patch.end)
    ) {
      throw new OperationError(
        command.commandId,
        "design.text.paragraph_patch_invalid",
        "Text editing paragraph patches must be ordered, non-overlapping, and aligned to final paragraph boundaries",
        "invalid",
        {
          path: `/paragraphPatches/${index}`,
          context: { code: "invalid-paragraph-range", nodeId: node.id },
        },
      );
    }
    updateTextRangeStyle(node, {
      commandId: `${command.commandId}:paragraph:${index}`,
      type: "update_text_range_style",
      nodeId: node.id,
      start: patch.start,
      end: patch.end,
      style: patch.style,
    });
    previousEnd = patch.end;
  }
  normalizeTextNodeRuns(node, command.commandId);
}

export function updateTextRangeStyle(
  node: TextNode,
  command: RangeCommand,
): void {
  normalizeTextNodeRuns(node, command.commandId);
  if (Object.keys(command.style).length === 0) {
    throw new OperationError(
      command.commandId,
      "design.text.style_patch_empty",
      "Text range style update must change at least one field",
      "invalid",
      { path: `/nodesById/${escapePointer(node.id)}/properties/runs` },
    );
  }
  const runPatch = Object.fromEntries(
    Object.entries(command.style).filter(
      ([field]) => !PARAGRAPH_STYLE_FIELD_SET.has(field),
    ),
  );
  const paragraphPatch = Object.fromEntries(
    Object.entries(command.style).filter(([field]) =>
      PARAGRAPH_STYLE_FIELD_SET.has(field),
    ),
  );
  let next = node.properties.runs ?? [];
  let nextParagraphs = node.properties.paragraphRuns ?? [];
  try {
    if (Object.keys(runPatch).length > 0) {
      next = applyTextRangeStyle(
        node.properties.content,
        next,
        textRunBaseStyle(node),
        { start: command.start, end: command.end },
        (style) => patchRunStyle(style, runPatch),
        sameRunStyle,
      );
    }
    if (Object.keys(paragraphPatch).length > 0) {
      if (!Object.hasOwn(command.style, "textStyleId")) {
        const touched = textParagraphRanges(node.properties.content).filter(
          (paragraph) =>
            paragraph.end > command.start && paragraph.start < command.end,
        );
        const first = touched[0];
        const last = touched.at(-1);
        if (first && last) {
          next = applyTextRangeStyle(
            node.properties.content,
            next,
            textRunBaseStyle(node),
            { start: first.start, end: last.end },
            detachTextStyleReference,
            sameRunStyle,
          );
        }
      }
      nextParagraphs = applyTextParagraphRangeStyle(
        node.properties.content,
        nextParagraphs,
        textParagraphBaseStyle(node),
        { start: command.start, end: command.end },
        (style) => patchParagraphStyle(style, paragraphPatch),
        sameParagraphStyle,
      );
    }
  } catch (error) {
    throw new OperationError(
      command.commandId,
      "design.text.range_update_invalid",
      error instanceof Error ? error.message : "Text range update failed",
      "invalid",
      {
        path: `/nodesById/${escapePointer(node.id)}/properties/${
          Object.keys(runPatch).length > 0 ? "runs" : "paragraphRuns"
        }`,
      },
    );
  }
  next = compactRuns(next, textRunBaseStyle(node));
  nextParagraphs = compactParagraphRuns(
    nextParagraphs,
    textParagraphBaseStyle(node),
  );
  if (
    sameRuns(next, node.properties.runs ?? []) &&
    sameParagraphRuns(nextParagraphs, node.properties.paragraphRuns ?? [])
  ) {
    throw new OperationError(
      command.commandId,
      "design.text.range_style_unchanged",
      "Text range already uses the requested style",
      "invalid",
      { context: { code: "no-op", nodeId: node.id } },
    );
  }
  node.properties.runs = next;
  node.properties.paragraphRuns = nextParagraphs;
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

export function textParagraphBaseStyle(node: TextNode): TextParagraphStyle {
  return {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: node.properties.listSpacing,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
  };
}

function patchParagraphStyle(
  style: TextParagraphStyle,
  patch: Readonly<Record<string, unknown>>,
): TextParagraphStyle {
  const next = { ...style, ...patch };
  if (
    Object.hasOwn(patch, "listOptions") &&
    next.listOptions.type !== "none" &&
    next.indentation === 0 &&
    !Object.hasOwn(patch, "indentation")
  ) {
    next.indentation = 1;
  }
  return next;
}

function detachTextStyleReference(style: TextRunStyle): TextRunStyle {
  if (style.textStyleId === undefined) return style;
  const next = structuredClone(style);
  delete next.textStyleId;
  return next;
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

function compactParagraphRuns(
  runs: readonly TextParagraphRun[],
  baseStyle: TextParagraphStyle,
): TextParagraphRun[] {
  if (
    runs.length === 1 &&
    runs[0]?.start === 0 &&
    sameParagraphStyle(runs[0].style, baseStyle)
  ) {
    return [];
  }
  const merged: TextParagraphRun[] = [];
  for (const run of runs) {
    const previous = merged.at(-1);
    if (
      previous &&
      previous.end === run.start &&
      sameParagraphStyle(previous.style, run.style)
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

function sameParagraphStyle(
  left: TextParagraphStyle,
  right: TextParagraphStyle,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameRuns(
  left: readonly TextRun[],
  right: readonly TextRun[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameParagraphRuns(
  left: readonly TextParagraphRun[],
  right: readonly TextParagraphRun[],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidRuns(nodeId: string, commandId: string, message: string) {
  return new OperationError(
    commandId,
    "design.text.runs_invalid",
    message,
    "invalid",
    {
      path: `/nodesById/${escapePointer(nodeId)}/properties/runs`,
    },
  );
}

function invalidParagraphRuns(
  nodeId: string,
  commandId: string,
  message: string,
) {
  return new OperationError(
    commandId,
    "design.text.paragraph_runs_invalid",
    message,
    "invalid",
    {
      path: `/nodesById/${escapePointer(nodeId)}/properties/paragraphRuns`,
    },
  );
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
