import type {
  DesignDocument,
  DesignNode,
  TextRunStyle,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { LeaferTextRangeSelection } from "@opendesign/leafer-engine";
import {
  canonicalizeTextStyleRuns,
  type TextFontDescriptor,
} from "@opendesign/text-service";
import { useMemo } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { FontInspectorContext } from "./components/properties/TypographySection";
import type { ApplyEditorCommands } from "./features/editor/use-editor-command-controller";
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
}): FontInspectorContext | undefined {
  const { epoch, importFonts, state } = options.fontBinaryRuntime;
  return useMemo(() => {
    const { selectedNode } = options;
    if (!selectedNode || selectedNode.kind !== "text") return undefined;
    const expectedFont: TextFontDescriptor = {
      fontFamily: selectedNode.properties.fontFamily,
      fontStyleName: selectedNode.properties.fontStyleName,
      fontWeight: selectedNode.properties.fontWeight,
      fontSlant: selectedNode.properties.fontSlant,
    };
    const range = resolveInspectorTextRange(
      selectedNode,
      options.textRangeSelection,
      options.document,
    );
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
    return {
      availability: options.runtime.inspectTextFont(expectedFont),
      importState: state,
      matchingNodeCount: matching.length,
      reflowableNodeCount: reflowable.length,
      ...(range
        ? {
            range: {
              ...range,
              onUpdate: (
                style: Parameters<
                  NonNullable<FontInspectorContext["range"]>["onUpdate"]
                >[0],
              ) => {
                options.applyCommands(options.t("history.updateTextRange"), [
                  {
                    commandId: `text_range_${Date.now()}_${++options.transactionCounter.current}`,
                    type: "update_text_range_style",
                    nodeId: selectedNode.id,
                    start: range.start,
                    end: range.end,
                    style,
                  },
                ]);
              },
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
    selection.nodeId !== node.id ||
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
  const overlapping = canonicalizeTextStyleRuns(
    node.properties.content,
    node.properties.runs ?? [],
    baseStyle,
    sameStyle,
  ).filter((run) => run.end > selection.start && run.start < selection.end);
  const style = overlapping[0]?.style ?? baseStyle;
  const fields = [
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
  const mixedFields = fields.filter((field) =>
    overlapping.some(
      (run) =>
        JSON.stringify(run.style[field]) !== JSON.stringify(style[field]),
    ),
  );
  return {
    start: selection.start,
    end: selection.end,
    text: node.properties.content.slice(selection.start, selection.end),
    style,
    mixedFields,
  };
}

function sameStyle(left: TextRunStyle, right: TextRunStyle): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
