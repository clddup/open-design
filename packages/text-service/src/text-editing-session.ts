import {
  canonicalizeTextParagraphRuns,
  remapTextParagraphRunsAfterContentChange,
  textParagraphRanges,
  type TextListOptions,
  type TextParagraphRun,
  type TextParagraphStyle,
} from "./text-paragraphs.js";
import {
  applyTextRangeStyle,
  canonicalizeTextStyleRuns,
  diffTextContent,
  isUtf16CodePointBoundary,
  remapTextStyleRunsAfterContentChange,
  type TextContentEdit,
  type TextStyleRun,
} from "./text-ranges.js";

export const TEXT_EDITING_SESSION_SERVICE_CONTRACT_VERSION = 2 as const;

export interface TextEditingSelection {
  end: number;
  start: number;
}

export type TextEditingListCommand =
  | "indent"
  | "outdent"
  | "remove-marker"
  | "exit-empty-item"
  | "toggle-ordered"
  | "toggle-unordered";

export interface TextEditingParagraphPatch {
  end: number;
  start: number;
  style: Partial<TextParagraphStyle>;
}

export interface TextEditingSessionCommit<Style extends object = object> {
  content: string;
  paragraphPatches: TextEditingParagraphPatch[];
  runs?: TextStyleRun<Style>[];
}

export interface TextEditingSessionRewrite {
  content: string;
  selection: TextEditingSelection;
}

export interface TextEditingSessionInputResult<Style extends object = object> {
  rewrite?: TextEditingSessionRewrite;
  state: TextEditingSessionState<Style>;
}

export interface TextEditingSessionCommandResult<
  Style extends object = object,
> {
  changed: boolean;
  handled: boolean;
  state: TextEditingSessionState<Style>;
}

interface TextEditingCharacterState<Style extends object> {
  baseStyle: Style;
  equalStyle: (left: Style, right: Style) => boolean;
  originalRuns: TextStyleRun<Style>[];
  runs: TextStyleRun<Style>[];
  typingStyle: { offset: number; style: Style } | null;
}

interface AutomaticListUndo<Style extends object> {
  character: TextEditingCharacterState<Style> | null;
  content: string;
  paragraphRuns: TextParagraphRun<TextParagraphStyle>[];
  selection: TextEditingSelection;
  trailingStyle: TextParagraphStyle | null;
}

export interface TextEditingSessionState<Style extends object = object> {
  automaticListUndo: AutomaticListUndo<Style> | null;
  baseStyle: TextParagraphStyle;
  character: TextEditingCharacterState<Style> | null;
  content: string;
  originalContent: string;
  originalParagraphRuns: TextParagraphRun<TextParagraphStyle>[];
  paragraphRuns: TextParagraphRun<TextParagraphStyle>[];
  selection: TextEditingSelection;
  trailingStyle: TextParagraphStyle | null;
}

export interface TextEditingSelectionInspection<Style extends object> {
  characterMixedFields: readonly (keyof Style)[];
  characterStyle: Style;
  paragraphMixedFields: readonly (keyof TextParagraphStyle)[];
  paragraphStyle: TextParagraphStyle;
  text: string;
}

interface EditingParagraphRange {
  contentEnd: number;
  end: number;
  start: number;
  trailing: boolean;
}

export function createTextEditingSession(
  content: string,
  paragraphRuns: readonly TextParagraphRun<TextParagraphStyle>[],
  baseStyle: TextParagraphStyle,
): TextEditingSessionState {
  const canonical = canonicalParagraphRuns(content, paragraphRuns, baseStyle);
  return {
    automaticListUndo: null,
    baseStyle: structuredClone(baseStyle),
    character: null,
    content,
    originalContent: content,
    originalParagraphRuns: structuredClone([...paragraphRuns]),
    paragraphRuns: canonical,
    selection: { start: 0, end: 0 },
    trailingStyle: trailingParagraphStyle(content, canonical, baseStyle),
  };
}

export function createRichTextEditingSession<Style extends object>(
  content: string,
  runs: readonly TextStyleRun<Style>[],
  baseCharacterStyle: Style,
  paragraphRuns: readonly TextParagraphRun<TextParagraphStyle>[],
  baseParagraphStyle: TextParagraphStyle,
  equalStyle: (left: Style, right: Style) => boolean = sameStructuredValue,
): TextEditingSessionState<Style> {
  const paragraphState = createTextEditingSession(
    content,
    paragraphRuns,
    baseParagraphStyle,
  );
  return {
    automaticListUndo: null,
    baseStyle: paragraphState.baseStyle,
    character: {
      baseStyle: structuredClone(baseCharacterStyle),
      equalStyle,
      originalRuns: structuredClone([...runs]),
      runs: canonicalizeTextStyleRuns(
        content,
        runs,
        baseCharacterStyle,
        equalStyle,
      ),
      typingStyle: null,
    },
    content: paragraphState.content,
    originalContent: paragraphState.originalContent,
    originalParagraphRuns: paragraphState.originalParagraphRuns,
    paragraphRuns: paragraphState.paragraphRuns,
    selection: paragraphState.selection,
    trailingStyle: paragraphState.trailingStyle,
  };
}

export function applyTextEditingSessionInput<Style extends object>(
  current: TextEditingSessionState<Style>,
  content: string,
  selection: TextEditingSelection,
  options: { automaticList: boolean },
): TextEditingSessionInputResult<Style> {
  validateSelection(content, selection);
  let state = remapSessionContent(
    { ...current, automaticListUndo: null },
    content,
    selection,
  );
  if (!options.automaticList || selection.start !== selection.end) {
    return { state };
  }
  const paragraph = paragraphAt(state.content, selection.start);
  const prefix = state.content.slice(paragraph.start, selection.start);
  const listType = automaticListType(prefix);
  const style = paragraphStyle(state, paragraph);
  if (!listType || style.listOptions.type !== "none") return { state };

  const undo: AutomaticListUndo<Style> = {
    character: cloneCharacterState(state.character),
    content: state.content,
    paragraphRuns: structuredClone(state.paragraphRuns),
    selection: { ...selection },
    trailingStyle: cloneNullableStyle(state.trailingStyle),
  };
  const nextContent = `${state.content.slice(0, paragraph.start)}${state.content.slice(selection.end)}`;
  const nextSelection = { start: paragraph.start, end: paragraph.start };
  state = remapSessionContent(state, nextContent, nextSelection);
  state = updateParagraphStyles(
    state,
    { start: paragraph.start, end: paragraph.start },
    (value) => ({
      ...value,
      indentation: Math.max(1, value.indentation),
      listOptions: { type: listType },
    }),
  );
  state.automaticListUndo = undo;
  return {
    rewrite: {
      content: state.content,
      selection: nextSelection,
    },
    state,
  };
}

export function undoAutomaticTextList<Style extends object>(
  current: TextEditingSessionState<Style>,
): TextEditingSessionInputResult<Style> | null {
  const undo = current.automaticListUndo;
  if (!undo) return null;
  const state: TextEditingSessionState<Style> = {
    ...current,
    automaticListUndo: null,
    character: cloneCharacterState(undo.character),
    content: undo.content,
    paragraphRuns: structuredClone(undo.paragraphRuns),
    selection: { ...undo.selection },
    trailingStyle: cloneNullableStyle(undo.trailingStyle),
  };
  return {
    rewrite: { content: state.content, selection: { ...undo.selection } },
    state,
  };
}

export function applyTextEditingListCommand<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
  command: TextEditingListCommand,
): TextEditingSessionCommandResult<Style> {
  validateSelection(current.content, selection);
  const paragraphs = touchedParagraphs(current.content, selection);
  if (paragraphs.length === 0) {
    return { changed: false, handled: false, state: current };
  }
  const styles = paragraphs.map((paragraph) =>
    paragraphStyle(current, paragraph),
  );
  const active = styles.filter((style) => style.listOptions.type !== "none");
  if (
    command !== "toggle-ordered" &&
    command !== "toggle-unordered" &&
    active.length === 0
  ) {
    return { changed: false, handled: false, state: current };
  }
  if (command === "exit-empty-item") {
    const paragraph = paragraphs[0]!;
    if (
      paragraphs.length !== 1 ||
      paragraph.contentEnd !== paragraph.start ||
      styles[0]!.listOptions.type === "none"
    ) {
      return { changed: false, handled: false, state: current };
    }
  }
  if (
    command === "remove-marker" &&
    (selection.start !== selection.end ||
      paragraphs.length !== 1 ||
      selection.start !== paragraphs[0]!.start ||
      styles[0]!.listOptions.type === "none")
  ) {
    return { changed: false, handled: false, state: current };
  }

  const targetType =
    command === "toggle-ordered"
      ? "ordered"
      : command === "toggle-unordered"
        ? "unordered"
        : null;
  const disableToggle =
    targetType !== null &&
    styles.every((style) => style.listOptions.type === targetType);
  let changed = false;
  let state: TextEditingSessionState<Style> = {
    ...current,
    automaticListUndo: null,
    selection: { ...selection },
  };
  paragraphs.forEach((paragraph, index) => {
    const before = styles[index]!;
    const after = updateListStyle(before, command, targetType, disableToggle);
    if (sameParagraphStyle(before, after)) return;
    changed = true;
    state = updateParagraphStyles(
      state,
      { start: paragraph.start, end: paragraph.start },
      () => after,
    );
  });
  return { changed, handled: true, state };
}

export function updateTextEditingSelection<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
): TextEditingSessionState<Style> {
  validateSelection(current.content, selection);
  const unchanged = sameSelection(current.selection, selection);
  if (unchanged) return current;
  return {
    ...current,
    automaticListUndo: null,
    character: current.character
      ? { ...current.character, typingStyle: null }
      : null,
    selection: { ...selection },
  };
}

export function updateTextEditingCharacterStyle<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
  update: (style: Style) => Style,
): TextEditingSessionState<Style> {
  const selected = updateTextEditingSelection(current, selection);
  const character = selected.character;
  if (!character) {
    throw new Error("Text editing session does not own character styles");
  }
  if (selection.start === selection.end) {
    const style = character.typingStyle
      ? character.typingStyle.style
      : characterStyleAtCaret(
          selected.content,
          character.runs,
          character.baseStyle,
          selection.start,
        );
    return {
      ...selected,
      automaticListUndo: null,
      character: {
        ...character,
        typingStyle: {
          offset: selection.start,
          style: update(structuredClone(style)),
        },
      },
    };
  }
  return {
    ...selected,
    automaticListUndo: null,
    character: {
      ...character,
      runs: applyTextRangeStyle(
        selected.content,
        character.runs,
        character.baseStyle,
        selection,
        update,
        character.equalStyle,
      ),
      typingStyle: null,
    },
  };
}

export function updateTextEditingParagraphStyle<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
  update: (style: TextParagraphStyle) => TextParagraphStyle,
): TextEditingSessionState<Style> {
  let selected = updateTextEditingSelection(current, selection);
  for (const paragraph of touchedParagraphs(selected.content, selection)) {
    selected = updateParagraphStyles(
      selected,
      { start: paragraph.start, end: paragraph.start },
      update,
    );
  }
  return { ...selected, selection: { ...selection } };
}

export function inspectTextEditingSelection<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
): TextEditingSelectionInspection<Style> {
  validateSelection(current.content, selection);
  const character = current.character;
  if (!character) {
    throw new Error("Text editing session does not own character styles");
  }
  const characterStyles =
    selection.start === selection.end
      ? [
          character.typingStyle?.offset === selection.start
            ? character.typingStyle.style
            : characterStyleAtCaret(
                current.content,
                character.runs,
                character.baseStyle,
                selection.start,
              ),
        ]
      : canonicalizeTextStyleRuns(
          current.content,
          character.runs,
          character.baseStyle,
          character.equalStyle,
        )
          .filter(
            (run) => run.end > selection.start && run.start < selection.end,
          )
          .map((run) => run.style);
  const characterStyle = structuredClone(
    characterStyles[0] ?? character.baseStyle,
  );
  const paragraphs = touchedParagraphs(current.content, selection);
  const paragraphStyles = paragraphs.map((paragraph) =>
    paragraphStyle(current, paragraph),
  );
  const paragraphStyleValue = structuredClone(
    paragraphStyles[0] ?? current.baseStyle,
  );
  return {
    characterMixedFields: mixedStyleFields(characterStyle, characterStyles),
    characterStyle,
    paragraphMixedFields: mixedStyleFields(
      paragraphStyleValue,
      paragraphStyles,
    ),
    paragraphStyle: paragraphStyleValue,
    text: current.content.slice(selection.start, selection.end),
  };
}

export function finalizeTextEditingSession<Style extends object = object>(
  state: TextEditingSessionState<Style>,
): TextEditingSessionCommit<Style> {
  const baseline = canonicalParagraphRuns(
    state.content,
    state.originalContent === state.content
      ? state.originalParagraphRuns
      : remapTextParagraphRunsAfterContentChange(
          state.originalContent,
          state.content,
          state.originalParagraphRuns,
          state.baseStyle,
          "before",
          sameParagraphStyle,
        ),
    state.baseStyle,
  );
  const target = canonicalParagraphRuns(
    state.content,
    state.paragraphRuns,
    state.baseStyle,
  );
  const patches: TextEditingParagraphPatch[] = [];
  for (const paragraph of textParagraphRanges(state.content)) {
    const before = styleAt(baseline, state.baseStyle, paragraph.start);
    const after = styleAt(target, state.baseStyle, paragraph.start);
    const style = paragraphStylePatch(before, after);
    if (Object.keys(style).length === 0) continue;
    const previous = patches.at(-1);
    if (
      previous?.end === paragraph.start &&
      JSON.stringify(previous.style) === JSON.stringify(style)
    ) {
      previous.end = paragraph.end;
    } else {
      patches.push({ ...paragraph, style });
    }
  }
  const runs = finalizeCharacterRuns(state);
  return {
    content: state.content,
    paragraphPatches: patches,
    ...(runs ? { runs } : {}),
  };
}

function remapSessionContent<Style extends object>(
  current: TextEditingSessionState<Style>,
  content: string,
  selection: TextEditingSelection,
): TextEditingSessionState<Style> {
  if (content === current.content) return { ...current, selection };
  const edit = diffTextContent(current.content, content);
  const insertedIntoTrailing =
    current.trailingStyle !== null && edit.start === current.content.length;
  const inheritedAtEdit = paragraphStyleAtOffset(current, edit.start);
  let paragraphRuns = remapTextParagraphRunsAfterContentChange(
    current.content,
    content,
    current.paragraphRuns,
    current.content.length === 0 && current.trailingStyle
      ? current.trailingStyle
      : current.baseStyle,
    "before",
    sameParagraphStyle,
  );
  if (insertedIntoTrailing && edit.insert.length > 0) {
    paragraphRuns = applyStyleToMaterializedParagraphs(
      content,
      paragraphRuns,
      current.baseStyle,
      { start: edit.start, end: edit.start + edit.insert.length },
      () => structuredClone(current.trailingStyle!),
    ).paragraphRuns;
  }
  const trailingStyle = hasTrailingParagraph(content)
    ? content.length === 0
      ? structuredClone(inheritedAtEdit)
      : structuredClone(
          styleAt(paragraphRuns, inheritedAtEdit, content.length - 1),
        )
    : null;
  const character = remapCharacterContent(current, content, selection, edit);
  return {
    ...current,
    automaticListUndo: null,
    character,
    content,
    paragraphRuns,
    selection,
    trailingStyle,
  };
}

function remapCharacterContent<Style extends object>(
  current: TextEditingSessionState<Style>,
  content: string,
  selection: TextEditingSelection,
  edit: TextContentEdit,
): TextEditingCharacterState<Style> | null {
  const character = current.character;
  if (!character) return null;
  let runs = remapTextStyleRunsAfterContentChange(
    current.content,
    content,
    character.runs,
    character.baseStyle,
    "before",
    character.equalStyle,
  ).runs;
  const typing = character.typingStyle;
  const consumesTypingStyle =
    typing !== null &&
    edit.start === typing.offset &&
    edit.end === typing.offset &&
    edit.insert.length > 0;
  if (consumesTypingStyle) {
    runs = applyTextRangeStyle(
      content,
      runs,
      character.baseStyle,
      { start: edit.start, end: edit.start + edit.insert.length },
      () => structuredClone(typing.style),
      character.equalStyle,
    );
  }
  return {
    ...character,
    runs,
    typingStyle:
      consumesTypingStyle && selection.start === selection.end
        ? { offset: selection.start, style: structuredClone(typing.style) }
        : null,
  };
}

function finalizeCharacterRuns<Style extends object>(
  state: TextEditingSessionState<Style>,
): TextStyleRun<Style>[] | null {
  const character = state.character;
  if (!character) return null;
  const baseline = canonicalizeTextStyleRuns(
    state.content,
    state.originalContent === state.content
      ? character.originalRuns
      : remapTextStyleRunsAfterContentChange(
          state.originalContent,
          state.content,
          character.originalRuns,
          character.baseStyle,
          "before",
          character.equalStyle,
        ).runs,
    character.baseStyle,
    character.equalStyle,
  );
  const target = canonicalizeTextStyleRuns(
    state.content,
    character.runs,
    character.baseStyle,
    character.equalStyle,
  );
  return sameStyleRuns(baseline, target, character.equalStyle) ? null : target;
}

function characterStyleAtCaret<Style extends object>(
  content: string,
  runs: readonly TextStyleRun<Style>[],
  baseStyle: Style,
  offset: number,
): Style {
  if (content.length === 0) return structuredClone(baseStyle);
  const target = offset === 0 ? 0 : Math.min(offset - 1, content.length - 1);
  return structuredClone(
    runs.find((run) => run.start <= target && target < run.end)?.style ??
      baseStyle,
  );
}

function sameStyleRuns<Style extends object>(
  left: readonly TextStyleRun<Style>[],
  right: readonly TextStyleRun<Style>[],
  equal: (left: Style, right: Style) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (run, index) =>
        run.start === right[index]?.start &&
        run.end === right[index]?.end &&
        right[index] !== undefined &&
        equal(run.style, right[index].style),
    )
  );
}

function mixedStyleFields<Style extends object>(
  baseline: Style,
  values: readonly Style[],
): readonly (keyof Style)[] {
  const keys = new Set<keyof Style>();
  for (const value of [baseline, ...values]) {
    for (const key of Object.keys(value) as (keyof Style)[]) keys.add(key);
  }
  return [...keys].filter((key) =>
    values.some(
      (value) => JSON.stringify(value[key]) !== JSON.stringify(baseline[key]),
    ),
  );
}

function sameSelection(
  left: TextEditingSelection,
  right: TextEditingSelection,
): boolean {
  return left.start === right.start && left.end === right.end;
}

function sameStructuredValue<Value>(left: Value, right: Value): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneCharacterState<Style extends object>(
  value: TextEditingCharacterState<Style> | null,
): TextEditingCharacterState<Style> | null {
  if (!value) return null;
  return {
    ...value,
    baseStyle: structuredClone(value.baseStyle),
    originalRuns: structuredClone(value.originalRuns),
    runs: structuredClone(value.runs),
    typingStyle: value.typingStyle
      ? {
          offset: value.typingStyle.offset,
          style: structuredClone(value.typingStyle.style),
        }
      : null,
  };
}

function updateParagraphStyles<Style extends object>(
  current: TextEditingSessionState<Style>,
  selection: TextEditingSelection,
  update: (style: TextParagraphStyle) => TextParagraphStyle,
): TextEditingSessionState<Style> {
  const materialized = applyStyleToMaterializedParagraphs(
    current.content,
    current.paragraphRuns,
    current.baseStyle,
    selection,
    update,
  );
  const trailing = editingParagraphRanges(current.content).find(
    (paragraph) => paragraph.trailing && touches(paragraph, selection),
  );
  return {
    ...current,
    automaticListUndo: null,
    paragraphRuns: materialized.paragraphRuns,
    selection: { ...selection },
    trailingStyle:
      trailing && current.trailingStyle
        ? update(structuredClone(current.trailingStyle))
        : current.trailingStyle,
  };
}

function applyStyleToMaterializedParagraphs(
  content: string,
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  baseStyle: TextParagraphStyle,
  selection: TextEditingSelection,
  update: (style: TextParagraphStyle) => TextParagraphStyle,
): { paragraphRuns: TextParagraphRun<TextParagraphStyle>[] } {
  const canonical = canonicalParagraphRuns(content, runs, baseStyle);
  const next = textParagraphRanges(content).map((paragraph) => {
    const style = styleAt(canonical, baseStyle, paragraph.start);
    return {
      ...paragraph,
      style: touches(paragraph, selection)
        ? update(structuredClone(style))
        : structuredClone(style),
    };
  });
  return { paragraphRuns: mergeParagraphRuns(next) };
}

function updateListStyle(
  style: TextParagraphStyle,
  command: TextEditingListCommand,
  targetType: "ordered" | "unordered" | null,
  disableToggle: boolean,
): TextParagraphStyle {
  if (targetType) {
    return {
      ...style,
      indentation: Math.max(1, style.indentation),
      listOptions: { type: disableToggle ? "none" : targetType },
    };
  }
  if (style.listOptions.type === "none") return style;
  if (command === "indent") {
    return { ...style, indentation: Math.min(5, style.indentation + 1) };
  }
  if (command === "outdent") {
    return { ...style, indentation: Math.max(1, style.indentation - 1) };
  }
  if (command === "remove-marker") {
    return { ...style, listOptions: { type: "none" } };
  }
  if (command === "exit-empty-item") {
    return style.indentation > 1
      ? { ...style, indentation: style.indentation - 1 }
      : {
          ...style,
          indentation: 0,
          listOptions: { type: "none" },
        };
  }
  return style;
}

function canonicalParagraphRuns(
  content: string,
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  baseStyle: TextParagraphStyle,
): TextParagraphRun<TextParagraphStyle>[] {
  return canonicalizeTextParagraphRuns(
    content,
    runs,
    baseStyle,
    sameParagraphStyle,
  );
}

function paragraphStyleAtOffset<Style extends object>(
  state: TextEditingSessionState<Style>,
  offset: number,
): TextParagraphStyle {
  if (
    state.trailingStyle &&
    (state.content.length === 0 || offset === state.content.length)
  ) {
    return structuredClone(state.trailingStyle);
  }
  return structuredClone(
    styleAt(
      state.paragraphRuns,
      state.baseStyle,
      Math.max(0, Math.min(offset, state.content.length - 1)),
    ),
  );
}

function paragraphStyle<Style extends object>(
  state: TextEditingSessionState<Style>,
  paragraph: EditingParagraphRange,
): TextParagraphStyle {
  if (paragraph.trailing) {
    return structuredClone(state.trailingStyle ?? state.baseStyle);
  }
  return structuredClone(
    styleAt(state.paragraphRuns, state.baseStyle, paragraph.start),
  );
}

function styleAt(
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  fallback: TextParagraphStyle,
  offset: number,
): TextParagraphStyle {
  return (
    runs.find((run) => run.start <= offset && offset < run.end)?.style ??
    fallback
  );
}

function trailingParagraphStyle(
  content: string,
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
  baseStyle: TextParagraphStyle,
): TextParagraphStyle | null {
  if (!hasTrailingParagraph(content)) return null;
  if (content.length === 0) return structuredClone(baseStyle);
  return structuredClone(styleAt(runs, baseStyle, content.length - 1));
}

function touchedParagraphs(
  content: string,
  selection: TextEditingSelection,
): EditingParagraphRange[] {
  if (selection.start === selection.end) {
    return [paragraphAt(content, selection.start)];
  }
  return editingParagraphRanges(content).filter((paragraph) =>
    touches(paragraph, selection),
  );
}

function paragraphAt(content: string, offset: number): EditingParagraphRange {
  const paragraphs = editingParagraphRanges(content);
  return (
    paragraphs.find((paragraph) => paragraph.start === offset) ??
    paragraphs.find((paragraph) =>
      paragraph.trailing
        ? offset === paragraph.start
        : paragraph.start <= offset && offset < paragraph.end,
    ) ??
    paragraphs.at(-1)!
  );
}

function editingParagraphRanges(content: string): EditingParagraphRange[] {
  const ranges = textParagraphRanges(content).map((paragraph) => ({
    ...paragraph,
    contentEnd: paragraphContentEnd(content, paragraph),
    trailing: false,
  }));
  if (hasTrailingParagraph(content)) {
    ranges.push({
      contentEnd: content.length,
      end: content.length,
      start: content.length,
      trailing: true,
    });
  }
  return ranges;
}

function paragraphContentEnd(
  content: string,
  paragraph: { start: number; end: number },
): number {
  if (paragraph.end <= paragraph.start) return paragraph.end;
  if (content.slice(paragraph.end - 2, paragraph.end) === "\r\n") {
    return paragraph.end - 2;
  }
  const last = content.charCodeAt(paragraph.end - 1);
  return last === 0x0a || last === 0x0d ? paragraph.end - 1 : paragraph.end;
}

function touches(
  paragraph: Pick<EditingParagraphRange, "start" | "end">,
  selection: TextEditingSelection,
): boolean {
  if (selection.start === selection.end) {
    if (paragraph.start === paragraph.end) {
      return selection.start === paragraph.start;
    }
    return (
      paragraph.start <= selection.start && selection.start < paragraph.end
    );
  }
  return paragraph.end > selection.start && paragraph.start < selection.end;
}

function hasTrailingParagraph(content: string): boolean {
  return (
    content.length === 0 || content.endsWith("\n") || content.endsWith("\r")
  );
}

function automaticListType(prefix: string): TextListOptions["type"] | null {
  if (prefix === "- " || prefix === "* ") return "unordered";
  if (prefix === "1. " || prefix === "1) ") return "ordered";
  return null;
}

function paragraphStylePatch(
  before: TextParagraphStyle,
  after: TextParagraphStyle,
): Partial<TextParagraphStyle> {
  return {
    ...(before.listOptions.type === after.listOptions.type
      ? {}
      : { listOptions: structuredClone(after.listOptions) }),
    ...(before.indentation === after.indentation
      ? {}
      : { indentation: after.indentation }),
    ...(before.listSpacing === after.listSpacing
      ? {}
      : { listSpacing: after.listSpacing }),
    ...(before.paragraphIndent === after.paragraphIndent
      ? {}
      : { paragraphIndent: after.paragraphIndent }),
    ...(before.paragraphSpacing === after.paragraphSpacing
      ? {}
      : { paragraphSpacing: after.paragraphSpacing }),
  };
}

function mergeParagraphRuns(
  runs: readonly TextParagraphRun<TextParagraphStyle>[],
): TextParagraphRun<TextParagraphStyle>[] {
  const result: TextParagraphRun<TextParagraphStyle>[] = [];
  for (const run of runs) {
    const previous = result.at(-1);
    if (
      previous?.end === run.start &&
      sameParagraphStyle(previous.style, run.style)
    ) {
      previous.end = run.end;
    } else {
      result.push(structuredClone(run));
    }
  }
  return result;
}

function sameParagraphStyle(
  left: TextParagraphStyle,
  right: TextParagraphStyle,
): boolean {
  return (
    left.listOptions.type === right.listOptions.type &&
    left.indentation === right.indentation &&
    left.listSpacing === right.listSpacing &&
    left.paragraphIndent === right.paragraphIndent &&
    left.paragraphSpacing === right.paragraphSpacing
  );
}

function validateSelection(
  content: string,
  selection: TextEditingSelection,
): void {
  if (
    !Number.isSafeInteger(selection.start) ||
    !Number.isSafeInteger(selection.end) ||
    selection.start < 0 ||
    selection.end < selection.start ||
    selection.end > content.length ||
    !isUtf16CodePointBoundary(content, selection.start) ||
    !isUtf16CodePointBoundary(content, selection.end)
  ) {
    throw new RangeError(
      "Text editing selection must use bounded UTF-16 code-point boundaries",
    );
  }
}

function cloneNullableStyle(
  value: TextParagraphStyle | null,
): TextParagraphStyle | null {
  return value ? structuredClone(value) : null;
}
