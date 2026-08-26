import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_EDIT_TOOL_NAME,
  EditDesignContract,
  type DesignArrangeToolInput,
  type DesignHierarchyToolInput,
  type InternalDesignEditToolInput,
} from "@/shared/design-agent-tools.js";
import { formatValidationFailure } from "@/shared/contract-validation.js";
import type {
  DesignPlanApplyAuthorization,
  GlobalTaskCoordinator,
} from "./global-task-coordinator.js";

export async function handleEditDesignTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName !== DESIGN_EDIT_TOOL_NAME) return null;
  const parsed = EditDesignContract.parse(input.call.input);
  if (!parsed.ok) {
    throw new TypeError(formatValidationFailure("Edit Design", parsed.issues));
  }

  const { context, coordinator } = input;
  coordinator.assertVisualReviewBeforeWrite(context);
  let authorization: DesignPlanApplyAuthorization | undefined;
  let nodeInput:
    | Extract<
        InternalDesignEditToolInput["edits"][number],
        { kind: "node" }
      >["input"]
    | undefined;
  const canonicalEdits: InternalDesignEditToolInput["edits"] = [];
  const materialTargetIds = new Set<string>();
  const createdNodeIds = new Set<string>();

  for (const edit of parsed.value.edits) {
    if (edit.kind === "node") {
      authorization = coordinator.assertDesignPlanForApply(context, edit.input);
      nodeInput = authorization?.input ?? edit.input;
      authorization?.targetIds.forEach((targetId) =>
        materialTargetIds.add(targetId),
      );
      canonicalEdits.push({ kind: edit.kind, input: nodeInput });
      continue;
    }
    if (edit.kind === "hierarchy") {
      const refs = hierarchyTargetRefs(edit.input);
      coordinator
        .resolveMaterialTargetIds(context, refs.nodeIds, refs.parentId)
        .forEach((targetId) => materialTargetIds.add(targetId));
      hierarchyCreatedNodeIds(edit.input).forEach((nodeId) =>
        createdNodeIds.add(nodeId),
      );
      canonicalEdits.push(edit);
      continue;
    }
    coordinator
      .resolveMaterialTargetIds(context, arrangeTargetIds(edit.input))
      .forEach((targetId) => materialTargetIds.add(targetId));
    canonicalEdits.push(edit);
  }

  if (materialTargetIds.size > 1) {
    throw new Error(
      "design_workflow.cross_artboard_edit_invalid: One atomic Edit Design call cannot combine writes across delivery artboards",
    );
  }
  if (authorization?.rebaseGuard && canonicalEdits.length !== 1) {
    throw new Error(
      "design_workflow.edit_rebase_requires_inspection: A planned insert can rebase over a pure Frame translation only when it is the sole Edit Design entry; inspect the current document before combining hierarchy or layout changes",
    );
  }
  const canonicalInput: InternalDesignEditToolInput = {
    label: parsed.value.label,
    edits: canonicalEdits.map((edit) =>
      edit.kind === "node" && authorization?.rebaseGuard
        ? {
            kind: edit.kind,
            input: { ...edit.input, rebaseGuard: authorization.rebaseGuard },
          }
        : edit,
    ),
  };
  const result = await input.execute({
    ...input.call,
    input: canonicalInput,
  });
  coordinator.assertDesignApplyResult(context, authorization, result);
  if (nodeInput !== undefined) {
    coordinator.recordDesignApplyCompleted(
      context.runId,
      nodeInput,
      authorization,
      result.designRevision?.revision,
    );
  }
  coordinator.recordMaterialDesignWriteCompleted(
    context.runId,
    [...materialTargetIds],
    result.designRevision?.revision,
    [...createdNodeIds],
  );
  return input.withDelivery(result, context.runId);
}

function hierarchyTargetRefs(input: DesignHierarchyToolInput): {
  nodeIds: string[];
  parentId?: string | null;
} {
  if ("nodeIds" in input) {
    return {
      nodeIds: [...input.nodeIds],
      ...(input.action === "reparent" ? { parentId: input.parentId } : {}),
    };
  }
  if ("maskNodeId" in input) return { nodeIds: [input.maskNodeId] };
  if ("groupId" in input) return { nodeIds: [input.groupId] };
  return { nodeIds: [input.booleanId] };
}

function hierarchyCreatedNodeIds(input: DesignHierarchyToolInput): string[] {
  if (input.action === "group" || input.action === "create-mask") {
    return [input.groupId];
  }
  return input.action === "create-boolean" ? [input.booleanId] : [];
}

function arrangeTargetIds(input: DesignArrangeToolInput): string[] {
  if ("nodeId" in input) return [input.nodeId];
  if ("frameId" in input) return [input.frameId];
  return [...input.nodeIds];
}
