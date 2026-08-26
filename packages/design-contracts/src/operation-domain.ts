import type { ValidationIssue } from "@opendesign/contract-runtime";
import { isValidLayoutLimits } from "./layout.js";
import type { DesignOperation, DesignTransaction } from "./index.js";

export function designOperationDomainIssues(
  operation: DesignOperation,
  prefix = "",
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  appendLayoutLimitIssues(issues, operation, prefix);

  if (
    operation.type === "insert_element" &&
    operation.node.parentId !== operation.parentId
  ) {
    issues.push(
      issue(
        "design.operation_insert_parent_mismatch",
        `${prefix}/node/parentId`,
        "Inserted node parentId must match the target parentId",
      ),
    );
  }

  if (operation.type === "replace_subtree") {
    const nodeIndexById = new Map<string, number>();
    operation.nodes.forEach((node, index) => {
      const existing = nodeIndexById.get(node.id);
      if (existing !== undefined) {
        issues.push(
          issue(
            "design.operation_replacement_node_duplicate",
            `${prefix}/nodes/${index}/id`,
            `Replacement node ID is already used at nodes/${existing}`,
          ),
        );
      } else {
        nodeIndexById.set(node.id, index);
      }
    });
    if (!nodeIndexById.has(operation.rootNodeId)) {
      issues.push(
        issue(
          "design.operation_replacement_root_missing",
          `${prefix}/rootNodeId`,
          "Replacement nodes must include rootNodeId",
        ),
      );
    }
    operation.nodes.forEach((node, nodeIndex) => {
      node.childIds.forEach((childId, childIndex) => {
        if (nodeIndexById.has(childId)) return;
        issues.push(
          issue(
            "design.operation_replacement_child_missing",
            `${prefix}/nodes/${nodeIndex}/childIds/${childIndex}`,
            `Replacement child ${childId} is not included in nodes`,
          ),
        );
      });
    });
  }

  return issues;
}

export function designTransactionDomainIssues(
  transaction: DesignTransaction,
): ValidationIssue[] {
  return designCommandListDomainIssues(transaction.commands);
}

export function designCommandListDomainIssues(
  commands: readonly DesignOperation[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const commandIndexById = new Map<string, number>();
  commands.forEach((command, index) => {
    const existing = commandIndexById.get(command.commandId);
    if (existing !== undefined) {
      issues.push(
        issue(
          "design.transaction_command_id_duplicate",
          `/commands/${index}/commandId`,
          `Command ID is already used at commands/${existing}`,
        ),
      );
    } else {
      commandIndexById.set(command.commandId, index);
    }
    issues.push(...designOperationDomainIssues(command, `/commands/${index}`));
  });
  return issues;
}

function appendLayoutLimitIssues(
  issues: ValidationIssue[],
  operation: DesignOperation,
  prefix: string,
): void {
  if (
    operation.type === "insert_element" &&
    !isValidLayoutLimits(operation.node.layoutLimits)
  ) {
    issues.push(layoutIssue(`${prefix}/node/layoutLimits`));
    return;
  }
  if (operation.type === "replace_subtree") {
    operation.nodes.forEach((node, index) => {
      if (!isValidLayoutLimits(node.layoutLimits))
        issues.push(layoutIssue(`${prefix}/nodes/${index}/layoutLimits`));
    });
    return;
  }
  if (
    operation.type === "update_properties" &&
    operation.layoutLimits !== null &&
    !isValidLayoutLimits(operation.layoutLimits)
  ) {
    issues.push(layoutIssue(`${prefix}/layoutLimits`));
  }
}

function layoutIssue(path: string): ValidationIssue {
  return issue(
    "design.operation_layout_limits_invalid",
    path,
    "Layout minimums must not exceed their matching maximums",
  );
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path: path || "/",
    message,
    recovery:
      "Correct the reported operation field and submit one revised transaction.",
  };
}
