import { designWorkflowError } from "@/shared/design-workflow-failure-classification.js";
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
import type {
  DesignPlanApplyAuthorization,
  GlobalTaskCoordinator,
} from "./global-task-coordinator.js";
import { contractValidationError } from "./contract-validation-error.js";

export async function handleEditDesignTool(input: {
  call: ToolCallRequest;
  context: TrustedToolContext;
  coordinator: GlobalTaskCoordinator;
  execute: (call: ToolCallRequest) => Promise<TrustedToolResult>;
  withDelivery: (result: TrustedToolResult, runId: string) => TrustedToolResult;
}): Promise<TrustedToolResult | null> {
  if (input.call.toolName !== DESIGN_EDIT_TOOL_NAME) return null;
  const parsedInput = input.call.input as InternalDesignEditToolInput;

  const { context, coordinator } = input;
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

  for (const edit of parsedInput.edits) {
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
        .resolveMaterialTargetIdsIfPlanned(context, refs.nodeIds, refs.parentId)
        .forEach((targetId) => materialTargetIds.add(targetId));
      hierarchyCreatedNodeIds(edit.input).forEach((nodeId) =>
        createdNodeIds.add(nodeId),
      );
      canonicalEdits.push(edit);
      continue;
    }
    coordinator
      .resolveMaterialTargetIdsIfPlanned(context, arrangeTargetIds(edit.input))
      .forEach((targetId) => materialTargetIds.add(targetId));
    canonicalEdits.push(edit);
  }

  if (authorization?.rebaseGuard && canonicalEdits.length !== 1) {
    throw designWorkflowError(
      "edit_rebase_requires_inspection",
      "A planned insert can rebase over a pure Frame translation only when it is the sole Edit Design entry; inspect the current document before combining hierarchy or layout changes",
    );
  }
  const rebaseGuard = canRebasePlannedInsert(
    authorization,
    canonicalEdits,
    nodeInput,
  );
  const canonicalInput: InternalDesignEditToolInput = {
    label: parsedInput.label,
    edits: canonicalEdits.map((edit) =>
      edit.kind === "node" && rebaseGuard
        ? {
            kind: edit.kind,
            input: { ...edit.input, rebaseGuard },
          }
        : edit,
    ),
  };
  const parsedCanonical = EditDesignContract.parse(canonicalInput, {
    internal: true,
  });
  if (!parsedCanonical.ok) {
    throw contractValidationError(
      "host-bound Edit Design",
      parsedCanonical.issues,
    );
  }
  const result = await input.execute({
    ...input.call,
    input: parsedCanonical.value,
  });
  coordinator.assertDesignApplyResult(context, authorization, result);
  if (nodeInput !== undefined) {
    coordinator.recordDesignApplyCompleted(
      context.runId,
      authorization,
      result.designRevision?.revision,
      result.content,
      [...createdNodeIds],
    );
  } else {
    coordinator.recordMaterialDesignWriteCompleted(
      context.runId,
      [...materialTargetIds],
      result.designRevision?.revision,
      [...createdNodeIds],
    );
  }
  return input.withDelivery(result, context.runId);
}

function canRebasePlannedInsert(
  authorization: DesignPlanApplyAuthorization | undefined,
  edits: readonly InternalDesignEditToolInput["edits"][number][],
  nodeInput:
    | Extract<
        InternalDesignEditToolInput["edits"][number],
        { kind: "node" }
      >["input"]
    | undefined,
): NonNullable<DesignPlanApplyAuthorization["rebaseGuard"]> | undefined {
  return authorization?.rebaseGuard !== undefined &&
    edits.length === 1 &&
    edits[0]?.kind === "node" &&
    nodeInput?.commands.every(
      (command) => command.type === "insert_element",
    ) === true
    ? authorization.rebaseGuard
    : undefined;
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
  return "nodeIds" in input ? [...input.nodeIds] : [];
}
