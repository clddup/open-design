import { DESIGN_FORMAT, DESIGN_SCHEMA_VERSION } from "./index.js";

export const actor = { type: "user" as const, id: "user_1" };

export function textDocumentFixture() {
  return {
    format: DESIGN_FORMAT,
    schemaVersion: DESIGN_SCHEMA_VERSION,
    documentId: "document_text_current",
    revision: 0,
    pageOrder: ["page_1"],
    pagesById: {
      page_1: {
        id: "page_1",
        name: "Page 1",
        rootNodeIds: ["text_1"],
        extensions: {},
      },
    },
    nodesById: {
      text_1: {
        id: "text_1",
        name: "Text",
        parentId: null,
        childIds: [],
        visible: true,
        locked: false,
        transform: [1, 0, 0, 1, 0, 0] as const,
        size: { width: 240, height: 64 },
        exportSettings: [],
        opacity: 1,
        extensions: {},
        kind: "text" as const,
        properties: {
          content: "Text",
          runs: [],
          fontFamily: "Inter",
          fontStyleName: null,
          fontSize: 20,
          fontWeight: 500,
          fontSlant: "normal",
          lineHeight: 28,
          letterSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 0,
          listSpacing: 0,
          hangingList: false,
          paragraphRuns: [],
          textCase: "original" as const,
          textDecoration: "none" as const,
          textAlignHorizontal: "left" as const,
          textAlignVertical: "top" as const,
          textResize: "fixed" as const,
          textWrap: "word" as const,
          textOverflow: "clip" as const,
          textTruncation: "disabled" as const,
          maxLines: null,
          fills: [{ type: "solid" as const, color: "#111827", opacity: 1 }],
          strokes: [],
          strokeWidth: 0,
        },
      },
    },
    componentsById: {},
    variantSetsById: {},
    libraryComponentsById: {},
    libraryVariantSetsById: {},
    libraryStylesById: {},
    libraryVariableCollectionsById: {},
    libraryVariablesById: {},
    variableCollectionOrder: [],
    variableCollectionsById: {},
    variablesById: {},
    styleOrderByType: { PAINT: [], TEXT: [], EFFECT: [], GRID: [] },
    stylesById: {},
    interactionsById: {},
    assetsById: {},
    imageAssetDerivationOrder: [],
    imageAssetDerivationsById: {},
    extensions: {},
  };
}

export function operation() {
  return {
    commandId: "command_1",
    type: "delete_element" as const,
    nodeId: "node_1",
  };
}
