import type {
  DesignDocument,
  DesignNode,
  TextParagraphStyle,
  TextRunStyle,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { LeaferTextRangeSelection } from "@opendesign/leafer-engine";
import {
  canonicalizeTextStyleRuns,
  canonicalizeTextParagraphRuns,
  type TextFontDescriptor,
} from "@opendesign/text-service";
import { useMemo } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { FontInspectorContext } from "../components/properties/TypographySection";
import type { ApplyEditorCommands } from "../../editor";
import type { FontBinaryRuntime } from "./use-font-binary-runtime";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useFontInspectorContext(options: {
  applyCommands: ApplyEditorCommands;
  document: DesignDocument;
  fontBinaryRuntime: FontBinaryRuntime;
  runtime: EditorRuntime;
  selectedNode: DesignNode | undefined;
  t: Translate;
  textLayoutProviderEpoch: number;
  textRangeSelection: LeaferTextRangeSelection | null;
  transactionCounter: { current: number };
  updateTextEditingStyle: (
    style: Parameters<
      NonNullable<FontInspectorContext["range"]>["onUpdate"]
    >[0],
  ) => boolean;
}): FontInspectorContext | undefined {
  const { epoch, importFonts, state } = options.fontBinaryRuntime;
  return useMemo(() => {
    const { selectedNode } = options;
    if (!selectedNode || selectedNode.kind !== "text") return undefined;
    const range = resolveInspectorTextRange(
      selectedNode,
      options.textRangeSelection,
      options.document,
    );
    const paragraph = resolveInspectorParagraphRange(
      selectedNode,
      range?.start ?? 0,
      range?.end ?? selectedNode.properties.content.length,
      options.textRangeSelection,
    );
    const expectedFont: TextFontDescriptor = {
      fontFamily: range?.style.fontFamily ?? selectedNode.properties.fontFamily,
      fontStyleName:
        range?.style.fontStyleName ?? selectedNode.properties.fontStyleName,
      fontWeight: range?.style.fontWeight ?? selectedNode.properties.fontWeight,
      fontSlant: range?.style.fontSlant ?? selectedNode.properties.fontSlant,
    };
    const matching = Object.values(options.document.nodesById).filter(
      (node) =>
        node.kind === "text" &&
        node.properties.fontFamily === expectedFont.fontFamily &&
        node.properties.fontStyleName === expectedFont.fontStyleName &&
        node.properties.fontWeight === expectedFont.fontWeight &&
        node.properties.fontSlant === expectedFont.fontSlant,
    );
    const reflowable = matching.filter(
      (node) => node.kind === "text" && node.properties.textResize !== "fixed",
    );
    const applyFont = (
      nodeIds: readonly string[],
      replacementFont?: TextFontDescriptor,
    ) => {
      if (nodeIds.length === 0) return;
      options.applyCommands(
        options.t(
          replacementFont ? "history.replaceFont" : "history.reflowFont",
        ),
        [
          {
            commandId: `font_reflow_${Date.now()}_${++options.transactionCounter.current}`,
            type: "reflow_text",
            nodeIds: [...nodeIds],
            expectedFont,
            ...(replacementFont ? { replacementFont } : {}),
          },
        ],
      );
    };
    const updateRange = (
      start: number,
      end: number,
      style: Parameters<
        NonNullable<FontInspectorContext["range"]>["onUpdate"]
      >[0],
    ) => {
      if (options.textRangeSelection?.editing) {
        options.updateTextEditingStyle(style);
        return;
      }
      options.applyCommands(options.t("history.updateTextRange"), [
        {
          commandId: `text_range_${Date.now()}_${++options.transactionCounter.current}`,
          type: "update_text_range_style",
          nodeId: selectedNode.id,
          start,
          end,
          style,
        },
      ]);
    };
    return {
      availability: options.runtime.inspectTextFont(expectedFont),
      importState: state,
      matchingNodeCount: matching.length,
      reflowableNodeCount: reflowable.length,
      ...(range
        ? {
            range: {
              ...range,
              onUpdate: (style) => updateRange(range.start, range.end, style),
            },
          }
        : {}),
      ...(paragraph
        ? {
            paragraph: {
              ...paragraph,
              onUpdate: (style) =>
                updateRange(paragraph.start, paragraph.end, style),
            },
          }
        : {}),
      onImport: async () => {
        const faces = await importFonts();
        if (
          faces.some(
            (face) =>
              face.family === expectedFont.fontFamily &&
              face.styleName === (expectedFont.fontStyleName ?? "Regular") &&
              face.weight === expectedFont.fontWeight &&
              face.slant === expectedFont.fontSlant,
          )
        ) {
          applyFont(reflowable.map((node) => node.id));
        }
      },
      onReflow: () => applyFont(reflowable.map((node) => node.id)),
      onReplace: (replacementFont) =>
        applyFont(
          matching.map((node) => node.id),
          replacementFont,
        ),
    };
  }, [epoch, importFonts, options, options.textLayoutProviderEpoch, state]);
}

function resolveInspectorTextRange(
  node: Extract<DesignNode, { kind: "text" }>,
  selection: LeaferTextRangeSelection | null,
  document: DesignDocument,
) {
  if (
    !selection ||
    selection.documentId !== document.documentId ||
    selection.revision !== document.revision ||
    selection.nodeId !== node.id
  ) {
    return undefined;
  }
  if (selection.editing) {
    if (
      selection.start < 0 ||
      selection.end < selection.start ||
      selection.end > selection.editing.content.length
    ) {
      return undefined;
    }
    return {
      collapsed: selection.start === selection.end,
      start: selection.start,
      end: selection.end,
      text: selection.editing.content.slice(selection.start, selection.end),
      style: {
        ...selection.editing.characterStyle,
        ...selection.editing.paragraphStyle,
      },
      mixedFields: [
        ...selection.editing.characterMixedFields,
        ...selection.editing.paragraphMixedFields,
      ],
    };
  }
  if (
    selection.start >= selection.end ||
    selection.end > node.properties.content.length
  ) {
    return undefined;
  }
  const baseStyle: TextRunStyle = {
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    fills: node.properties.fills,
    ...(node.textStyleId ? { textStyleId: node.textStyleId } : {}),
    ...(node.fillStyleId ? { fillStyleId: node.fillStyleId } : {}),
  };
  const baseParagraphStyle: TextParagraphStyle = {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: node.properties.listSpacing,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
  };
  const overlapping = canonicalizeTextStyleRuns(
    node.properties.content,
    node.properties.runs ?? [],
    baseStyle,
    sameStyle,
  ).filter((run) => run.end > selection.start && run.start < selection.end);
  const overlappingParagraphs = canonicalizeTextParagraphRuns(
    node.properties.content,
    node.properties.paragraphRuns ?? [],
    baseParagraphStyle,
    sameStyle,
  ).filter((run) => run.end > selection.start && run.start < selection.end);
  const characterStyle = overlapping[0]?.style ?? baseStyle;
  const paragraphStyle = overlappingParagraphs[0]?.style ?? baseParagraphStyle;
  const style = { ...characterStyle, ...paragraphStyle };
  const characterFields = [
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
  const paragraphFields = [
    "listOptions",
    "indentation",
    "listSpacing",
    "paragraphIndent",
    "paragraphSpacing",
  ] as const;
  const mixedFields = [
    ...characterFields.filter((field) =>
      overlapping.some(
        (run) =>
          JSON.stringify(run.style[field]) !==
          JSON.stringify(characterStyle[field]),
      ),
    ),
    ...paragraphFields.filter((field) =>
      overlappingParagraphs.some(
        (run) =>
          JSON.stringify(run.style[field]) !==
          JSON.stringify(paragraphStyle[field]),
      ),
    ),
  ];
  return {
    collapsed: false,
    start: selection.start,
    end: selection.end,
    text: node.properties.content.slice(selection.start, selection.end),
    style,
    mixedFields,
  };
}

function resolveInspectorParagraphRange(
  node: Extract<DesignNode, { kind: "text" }>,
  start: number,
  end: number,
  selection: LeaferTextRangeSelection | null,
) {
  if (
    selection?.editing &&
    selection.nodeId === node.id &&
    selection.start === start &&
    selection.end === end
  ) {
    return {
      start,
      end,
      style: selection.editing.paragraphStyle,
      mixedFields: selection.editing.paragraphMixedFields,
    };
  }
  if (start < 0 || end <= start || end > node.properties.content.length) {
    return undefined;
  }
  const base: TextParagraphStyle = {
    listOptions: { type: "none" },
    indentation: 0,
    listSpacing: node.properties.listSpacing,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
  };
  const overlapping = canonicalizeTextParagraphRuns(
    node.properties.content,
    node.properties.paragraphRuns ?? [],
    base,
    sameStyle,
  ).filter((run) => run.end > start && run.start < end);
  const style = overlapping[0]?.style ?? base;
  const fields = [
    "listOptions",
    "indentation",
    "listSpacing",
    "paragraphIndent",
    "paragraphSpacing",
  ] as const;
  return {
    start,
    end,
    style,
    mixedFields: fields.filter((field) =>
      overlapping.some(
        (run) =>
          JSON.stringify(run.style[field]) !== JSON.stringify(style[field]),
      ),
    ),
  };
}

function sameStyle<Style>(left: Style, right: Style): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
