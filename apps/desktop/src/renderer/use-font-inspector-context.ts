import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { TextFontDescriptor } from "@opendesign/text-service";
import { useMemo } from "react";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import type { FontInspectorContext } from "./components/properties/TypographySection";
import type { ApplyEditorCommands } from "./features/editor/use-editor-command-controller";
import { useFontBinaryRuntime } from "./use-font-binary-runtime";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useFontInspectorContext(options: {
  applyCommands: ApplyEditorCommands;
  document: DesignDocument;
  runtime: EditorRuntime;
  selectedNode: DesignNode | undefined;
  t: Translate;
  textLayoutProviderEpoch: number;
  transactionCounter: { current: number };
}): FontInspectorContext | undefined {
  const { epoch, importFonts, state } = useFontBinaryRuntime();
  return useMemo(() => {
    const { selectedNode } = options;
    if (!selectedNode || selectedNode.kind !== "text") return undefined;
    const expectedFont: TextFontDescriptor = {
      fontFamily: selectedNode.properties.fontFamily,
      fontStyleName: selectedNode.properties.fontStyleName,
      fontWeight: selectedNode.properties.fontWeight,
      fontSlant: selectedNode.properties.fontSlant,
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
    return {
      availability: options.runtime.inspectTextFont(expectedFont),
      importState: state,
      matchingNodeCount: matching.length,
      reflowableNodeCount: reflowable.length,
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
