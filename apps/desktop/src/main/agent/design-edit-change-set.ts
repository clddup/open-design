import {
  DesignChangeSetSchema,
  type DesignChangeSet,
} from "@opendesign/design-contracts";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import {
  defineContract,
  formatValidationFailure,
} from "@/shared/contract-validation.js";
import { FatalAgentRunError } from "./fatal-agent-run-error.js";

const ChangeSetContract = defineContract<DesignChangeSet>({
  schema: DesignChangeSetSchema,
  code: "design_edit.changes_invalid",
  subject: "Committed edit changes",
  clone: false,
});

export function committedEditChanges(
  context: TrustedToolContext,
  result: TrustedToolResult,
): DesignChangeSet | undefined {
  const revision = result.designRevision;
  if (!revision) return undefined;
  const content = result.content;
  const parsed = ChangeSetContract.parse(
    typeof content === "object" && content !== null && "changes" in content
      ? content.changes
      : undefined,
  );
  if (!parsed.ok) {
    throw new FatalAgentRunError(
      "design_edit_result_invalid",
      formatValidationFailure("Committed edit changes", parsed.issues),
    );
  }
  const changes = parsed.value;
  if (
    changes.documentId !== context.documentId ||
    changes.fromRevision !== revision.previousRevision ||
    changes.toRevision !== revision.revision
  ) {
    throw new FatalAgentRunError(
      "design_edit_result_invalid",
      "Committed edit changes do not match the authorized document and returned revision. Preserve the committed canvas; do not replay the edit.",
    );
  }
  return changes;
}
