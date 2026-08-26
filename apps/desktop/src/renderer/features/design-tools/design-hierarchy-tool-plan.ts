import type { DesignDocument } from "@opendesign/design-contracts";
import {
  planCreateBooleanGroup,
  planCreateMaskGroup,
  planGroupNodes,
  planRemoveMask,
  planReparentNodes,
  planReorderNodes,
  planSetBooleanOperation,
  planSetMaskType,
  planUngroupBooleanGroup,
  planUngroupNode,
} from "@opendesign/editor-runtime";
import type { DesignHierarchyToolInput } from "@/shared/design-agent-tools";

export function planDesignHierarchyTool(
  document: DesignDocument,
  input: DesignHierarchyToolInput,
  commandPrefix: string,
) {
  switch (input.action) {
    case "group":
      return planGroupNodes(document, input.pageId, input.nodeIds, {
        groupId: input.groupId,
        name: input.name,
        commandPrefix,
      });
    case "ungroup":
      return planUngroupNode(
        document,
        input.pageId,
        input.groupId,
        commandPrefix,
      );
    case "create-mask":
      return planCreateMaskGroup(document, input.pageId, input.nodeIds, {
        groupId: input.groupId,
        name: input.name,
        maskType: input.maskType,
        commandPrefix,
      });
    case "set-mask-type":
      return planSetMaskType(
        document,
        input.pageId,
        input.maskNodeId,
        input.maskType,
        commandPrefix,
      );
    case "remove-mask":
      return planRemoveMask(
        document,
        input.pageId,
        input.maskNodeId,
        commandPrefix,
      );
    case "create-boolean":
      return planCreateBooleanGroup(
        document,
        input.pageId,
        input.nodeIds,
        input.operation,
        {
          booleanId: input.booleanId,
          name: input.name,
          commandPrefix,
        },
      );
    case "set-boolean-operation":
      return planSetBooleanOperation(
        document,
        input.pageId,
        input.booleanId,
        input.operation,
        commandPrefix,
      );
    case "ungroup-boolean":
      return planUngroupBooleanGroup(
        document,
        input.pageId,
        input.booleanId,
        commandPrefix,
      );
    case "reorder":
      return planReorderNodes(
        document,
        input.pageId,
        input.nodeIds,
        input.order,
        commandPrefix,
      );
    case "reparent":
      return planReparentNodes(document, input.pageId, input.nodeIds, {
        parentId: input.parentId,
        index: input.index,
        commandPrefix,
      });
  }
}
