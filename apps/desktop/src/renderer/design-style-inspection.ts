import type { DesignDocument } from "@opendesign/design-contracts";
import { styleConsumers } from "@opendesign/style-service";

export function createScopedStyleInspection(
  document: DesignDocument,
  scopedNodeIds: ReadonlySet<string>,
) {
  const styleConsumersById = Object.fromEntries(
    Object.keys(document.stylesById).map((styleId) => [
      styleId,
      styleConsumers(document, styleId).filter((target) =>
        scopedNodeIds.has(target.nodeId),
      ),
    ]),
  );
  return {
    styleOrderByType: structuredClone(document.styleOrderByType),
    stylesById: structuredClone(document.stylesById),
    styleConsumersById,
    designSystemIds: { styles: Object.keys(document.stylesById) },
  };
}
