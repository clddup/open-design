import type {
  ToolCallRequest,
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  DESIGN_EDIT_TOOL_NAME,
  EditDesignContract,
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

  for (const edit of parsedInput.edits) {
    if (edit.kind === "node") {
      authorization =
        parsedInput.edits.length === 1
          ? coordinator.authorizeIndependentDesignEdit(context, edit.input)
          : coordinator.assertDesignPlanForApply(context, edit.input);
      nodeInput = authorization?.input ?? edit.input;
      canonicalEdits.push({ kind: edit.kind, input: nodeInput });
      continue;
    }
    canonicalEdits.push(edit);
  }

  const rebaseGuard = canRebasePlannedInsert(
    authorization,
    canonicalEdits,
    nodeInput,
  );
  const canonicalInput: InternalDesignEditToolInput = {
    label: parsedInput.label,
    edits: canonicalEdits.map((edit) => {
      if (edit.kind !== "node") return edit;
      const { rebaseGuard: _unused, ...node } = edit.input;
      void _unused;
      return {
        kind: edit.kind,
        input: { ...node, ...(rebaseGuard ? { rebaseGuard } : {}) },
      };
    }),
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
  const executionAuthorization = authorizedRebase(authorization, rebaseGuard);
  coordinator.assertDesignApplyResult(context, executionAuthorization, result);
  coordinator.recordDesignEditCompleted(
    context,
    executionAuthorization,
    result,
  );
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

function authorizedRebase(
  authorization: DesignPlanApplyAuthorization | undefined,
  rebaseGuard: DesignPlanApplyAuthorization["rebaseGuard"],
): DesignPlanApplyAuthorization | undefined {
  if (!authorization) return undefined;
  const { rebaseGuard: _unused, ...rest } = authorization;
  void _unused;
  return { ...rest, ...(rebaseGuard ? { rebaseGuard } : {}) };
}
