import type { DesignDocument } from "@opendesign/design-contracts";
import { styleConsumers } from "@opendesign/style-service";

export function createScopedStyleInspection(
  document: DesignDocument,
  scopedNodeIds: ReadonlySet<string>,
) {
  const styleConsumersById = Object.fromEntries(
    [
      ...Object.keys(document.stylesById),
      ...Object.keys(document.libraryStylesById),
    ].map((styleId) => [
      styleId,
      styleConsumers(document, styleId).filter((target) =>
        scopedNodeIds.has(target.nodeId),
      ),
    ]),
  );
  return {
    styleOrderByType: structuredClone(document.styleOrderByType),
    stylesById: structuredClone(document.stylesById),
    libraryStylesById: structuredClone(document.libraryStylesById),
    styleConsumersById,
    designSystemIds: { styles: Object.keys(document.stylesById) },
  };
}
