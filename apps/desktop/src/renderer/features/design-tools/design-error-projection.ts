import {
  AgentToolFailureIssueContract,
  type AgentToolFailureIssue,
} from "@opendesign/agent-contracts";
import type {
  DesignError,
  DesignIssue,
  DesignOperation,
} from "@opendesign/design-contracts";

export function projectDesignFailureIssues(
  error: DesignError,
  commands: readonly DesignOperation[],
): AgentToolFailureIssue[] {
  return error.issues
    .slice(0, 128)
    .map((issue) => projectDesignFailureIssue(issue, commands));
}

function projectDesignFailureIssue(
  issue: DesignIssue,
  commands: readonly DesignOperation[],
): AgentToolFailureIssue {
  const inferredNodeId = issue.nodeId ?? nodeIdFromInvariantPath(issue.path);
  const inferredCommandId =
    issue.commandId ?? commandIdForNode(commands, inferredNodeId);
  let projected: AgentToolFailureIssue = {
    code: issue.code,
    path: issue.path,
    message: issue.message,
    ...(issue.recovery === undefined ? {} : { recovery: issue.recovery }),
  };
  projected = includeSupportedField(projected, "commandId", inferredCommandId);
  projected = includeSupportedField(projected, "nodeId", inferredNodeId);
  projected = includeSupportedField(projected, "expected", issue.expected);
  return includeSupportedField(projected, "actual", issue.actual);
}

function includeSupportedField(
  issue: AgentToolFailureIssue,
  field: "commandId" | "nodeId" | "expected" | "actual",
  value: unknown,
): AgentToolFailureIssue {
  if (value === undefined) return issue;
  const parsed = AgentToolFailureIssueContract.parse({
    ...issue,
    [field]: value,
  });
  return parsed.ok ? parsed.value : issue;
}

function nodeIdFromInvariantPath(path: string): string | undefined {
  const match = /^\/nodesById\/([^/]+)/.exec(path);
  if (!match?.[1]) return undefined;
  return match[1].replaceAll("~1", "/").replaceAll("~0", "~");
}

function commandIdForNode(
  commands: readonly DesignOperation[],
  nodeId: string | undefined,
): string | undefined {
  if (!nodeId) return undefined;
  return [...commands]
    .reverse()
    .find((command) => commandDirectlyTargetsNode(command, nodeId))?.commandId;
}

function commandDirectlyTargetsNode(
  command: DesignOperation,
  nodeId: string,
): boolean {
  switch (command.type) {
    case "insert_element":
      return command.node.id === nodeId;
    case "update_properties":
    case "update_text_range_style":
    case "move_element":
    case "delete_element":
      return command.nodeId === nodeId;
    case "reflow_text":
      return command.nodeIds.includes(nodeId);
    case "replace_subtree":
      return command.nodes.some((node) => node.id === nodeId);
    default:
      return false;
  }
}
