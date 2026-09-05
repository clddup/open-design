import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import type {
  TrustedToolContext,
  TrustedToolResult,
} from "@opendesign/agent-contracts";
import { committedEditChanges } from "./design-edit-change-set";
import { FatalAgentRunError } from "./fatal-agent-run-error";

function committed() {
  const document = createWelcomeDocument();
  const runtime = new EditorRuntime(document);
  const transaction = {
    transactionId: "edit_changes",
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "agent" as const, id: "agent" },
    label: "Change opacity",
    commands: [
      {
        commandId: "opacity",
        type: "update_properties" as const,
        nodeId: "title_welcome",
        opacity: 0.8,
      },
    ],
  };
  const applied = runtime.apply(transaction);
  if (!applied.ok) throw new Error(applied.error.message);
  const context: TrustedToolContext = {
    runId: "run_changes",
    sessionId: "session_changes",
    documentId: document.documentId,
    revision: document.revision,
    scope: { kind: "page", pageId: "page_welcome", selectedNodeIds: [] },
    mutationTarget: { kind: "page", pageId: "page_welcome" },
  };
  const result = {
    content: { changes: structuredClone(applied.changes) },
    designRevision: {
      previousRevision: document.revision,
      revision: applied.revision.revision,
      transactionId: transaction.transactionId,
    },
  } satisfies TrustedToolResult;
  return { context, result };
}

describe("committed edit changes", () => {
  it("consumes the existing EditorRuntime ChangeSet without re-creating it", () => {
    const { context, result } = committed();
    expect(committedEditChanges(context, result)).toBe(result.content.changes);
  });
  it.each(["documentId", "fromRevision", "toRevision"] as const)(
    "rejects mismatched %s after a write rather than replaying it",
    (field) => {
      const { context, result } = committed();
      if (field === "documentId")
        result.content.changes.documentId = "different_document";
      else result.content.changes[field] += 1;
      expect(() => committedEditChanges(context, result)).toThrow(
        FatalAgentRunError,
      );
    },
  );
  it("does not claim progress for a result without a committed revision", () => {
    const { context } = committed();
    expect(
      committedEditChanges(context, { content: { ok: true } }),
    ).toBeUndefined();
  });
  it("rejects missing change evidence on a successful write", () => {
    const { context, result } = committed();
    expect(() =>
      committedEditChanges(context, { ...result, content: {} }),
    ).toThrow(FatalAgentRunError);
  });
});
