import type { ValidationIssue } from "@opendesign/contract-runtime";
import type { DesignTransactionResult } from "./index.js";

export function designTransactionResultDomainIssues(
  result: DesignTransactionResult,
): ValidationIssue[] {
  if (!result.ok) return [];
  const issues: ValidationIssue[] = [];
  const expectedRevision = result.baseRevision + 1;
  if (result.revision.revision !== expectedRevision) {
    issues.push(
      issue(
        "design.result_revision_invalid",
        "/revision/revision",
        "Successful transactions must advance exactly one revision",
      ),
    );
  }
  if (result.revision.transactionId !== result.transactionId) {
    issues.push(
      issue(
        "design.result_revision_transaction_mismatch",
        "/revision/transactionId",
        "Successful revision identity must match transactionId",
      ),
    );
  }
  if (result.changes.documentId !== result.documentId) {
    issues.push(
      issue(
        "design.result_changes_document_mismatch",
        "/changes/documentId",
        "ChangeSet documentId must match the result documentId",
      ),
    );
  }
  if (result.changes.fromRevision !== result.baseRevision) {
    issues.push(
      issue(
        "design.result_changes_base_revision_mismatch",
        "/changes/fromRevision",
        "ChangeSet fromRevision must match baseRevision",
      ),
    );
  }
  if (result.changes.toRevision !== result.revision.revision) {
    issues.push(
      issue(
        "design.result_changes_revision_mismatch",
        "/changes/toRevision",
        "ChangeSet toRevision must match the successful revision",
      ),
    );
  }
  appendDisjointIdentityIssues(issues, result);
  return issues;
}

function appendDisjointIdentityIssues(
  issues: ValidationIssue[],
  result: Extract<DesignTransactionResult, { ok: true }>,
): void {
  const categories = [
    [
      "Node",
      result.changes.addedNodeIds,
      result.changes.changedNodeIds,
      result.changes.removedNodeIds,
    ],
    [
      "Page",
      result.changes.addedPageIds ?? [],
      result.changes.changedPageIds ?? [],
      result.changes.removedPageIds ?? [],
    ],
    [
      "Asset",
      result.changes.addedAssetIds ?? [],
      result.changes.changedAssetIds ?? [],
      result.changes.removedAssetIds ?? [],
    ],
    [
      "Component",
      result.changes.addedComponentIds ?? [],
      result.changes.changedComponentIds ?? [],
      result.changes.removedComponentIds ?? [],
    ],
  ] as const;
  for (const [label, added, changed, removed] of categories) {
    const owner = new Map<string, string>();
    for (const [field, values] of [
      ["added", added],
      ["changed", changed],
      ["removed", removed],
    ] as const) {
      values.forEach((id, index) => {
        const previous = owner.get(id);
        if (previous === undefined) {
          owner.set(id, field);
          return;
        }
        issues.push(
          issue(
            "design.result_change_identity_overlap",
            `/changes/${field}${label}Ids/${index}`,
            `${label} ID is already classified as ${previous}`,
          ),
        );
      });
    }
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return {
    code,
    path,
    message,
    recovery:
      "Reject the result at the process boundary and preserve the last authoritative document revision.",
  };
}
