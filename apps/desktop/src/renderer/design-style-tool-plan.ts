import type { DesignDocument } from "@opendesign/design-contracts";
import {
  planCreateStyleFromNode,
  planDeleteStyle,
  planMoveStyle,
  planSetStyleReference,
  planUpdateStyle,
  planUpdateStyleFromNode,
  type StyleOperationPlan,
} from "@opendesign/editor-runtime";
import type { DesignStyleToolInput } from "../shared/design-agent-tools";

export function planDesignStyleTool(
  document: DesignDocument,
  input: DesignStyleToolInput,
  commandPrefix: string,
): StyleOperationPlan {
  switch (input.action) {
    case "create-from-node":
      return planCreateStyleFromNode(document, {
        nodeId: input.nodeId,
        field: input.field,
        styleId: input.styleId,
        key: input.key,
        name: input.name,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        commandPrefix,
      });
    case "update-from-node":
      return planUpdateStyleFromNode(document, {
        styleId: input.styleId,
        nodeId: input.nodeId,
        field: input.field,
        commandPrefix,
      });
    case "update-metadata": {
      const style = document.stylesById[input.styleId];
      if (!style) return missing(input.styleId);
      return planUpdateStyle(document, {
        style: {
          ...structuredClone(style),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined
            ? {}
            : { description: input.description }),
          ...(input.hiddenFromPublishing === undefined
            ? {}
            : { hiddenFromPublishing: input.hiddenFromPublishing }),
        },
        commandPrefix,
      });
    }
    case "move":
      return planMoveStyle(document, {
        styleId: input.styleId,
        index: input.index,
        commandPrefix,
      });
    case "delete":
      return planDeleteStyle(document, {
        styleId: input.styleId,
        commandPrefix,
      });
    case "set-reference":
      return planSetStyleReference(document, {
        target: { nodeId: input.nodeId, field: input.field },
        styleId: input.styleId,
        commandPrefix,
      });
  }
}

function missing(styleId: string): StyleOperationPlan {
  return {
    ok: false,
    code: "not-found",
    message: `Style ${styleId} does not exist`,
  };
}
