import type {
  DesignDocument,
  DesignTransaction,
  DesignTransactionSuccess,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { diffDocuments } from "./document-diff.js";
import { EditorHistory } from "./editor-history.js";

function transaction(
  id: string,
  baseRevision: number,
  label: string,
): DesignTransaction {
  return {
    transactionId: id,
    documentId: "document_welcome",
    baseRevision,
    actor: { type: "agent", id: "agent_test" },
    label,
    commands: [],
  };
}

function success(
  transaction: DesignTransaction,
  before: DesignDocument,
  after: DesignDocument,
): DesignTransactionSuccess {
  return {
    ok: true,
    mode: "apply",
    transactionId: transaction.transactionId,
    documentId: transaction.documentId,
    baseRevision: transaction.baseRevision,
    revision: {
      revision: after.revision,
      createdAt: `2026-08-23T00:00:0${after.revision}.000Z`,
      transactionId: transaction.transactionId,
      actor: transaction.actor,
      ...(transaction.label === undefined ? {} : { label: transaction.label }),
    },
    changes: diffDocuments(before, after, after.revision),
    warnings: [],
  };
}

function changedDocument(
  source: DesignDocument,
  revision: number,
  name: string,
): DesignDocument {
  const document = structuredClone(source);
  document.revision = revision;
  document.nodesById.title_welcome!.name = name;
  return document;
}

describe("EditorHistory", () => {
  it("owns active group validation and collapses grouped revisions", () => {
    const history = new EditorHistory();
    const before = createWelcomeDocument();
    const first = changedDocument(before, 1, "First");
    const second = changedDocument(first, 2, "Second");
    const firstTransaction = transaction("transaction_1", 0, "First change");
    const secondTransaction = transaction("transaction_2", 1, "Second change");

    history.recordApply({
      before,
      after: first,
      transaction: firstTransaction,
      result: success(firstTransaction, before, first),
      options: { historyGroupId: "group_design" },
    });

    expect(history.validateApply({ historyGroupId: "group_design" })).toBe(
      undefined,
    );
    expect(history.validateApply({ historyGroupId: "other_group" })).toEqual({
      code: "conflict",
      message: "Design change group_design is still being applied",
      retryable: true,
    });

    history.recordApply({
      before: first,
      after: second,
      transaction: secondTransaction,
      result: success(secondTransaction, first, second),
      options: {
        historyGroupId: "group_design",
        finalizeHistoryGroup: true,
      },
    });

    expect(history.state()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undo: [
        {
          transactionId: "group_design",
          label: "First change",
          changes: {
            fromRevision: 0,
            toRevision: 2,
            changedNodeIds: ["title_welcome"],
          },
        },
      ],
    });
    expect(history.validateApply({})).toBe(undefined);
  });

  it("moves one record through undo and redo without copying documents", () => {
    const history = new EditorHistory();
    const before = createWelcomeDocument();
    const after = changedDocument(before, 1, "After");
    const change = transaction("transaction_change", 0, "Change");
    history.recordApply({
      before,
      after,
      transaction: change,
      result: success(change, before, after),
      options: {},
    });

    const undo = history.undo();
    expect(undo).toMatchObject({ ok: true, record: { before, after } });
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: true });

    const redo = history.redo();
    expect(redo).toMatchObject({ ok: true, record: { before, after } });
    expect(history.state()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("rolls back only the latest matching group", () => {
    const history = new EditorHistory();
    const before = createWelcomeDocument();
    const after = changedDocument(before, 1, "Grouped");
    const change = transaction("transaction_group", 0, "Grouped change");
    history.recordApply({
      before,
      after,
      transaction: change,
      result: success(change, before, after),
      options: { historyGroupId: "group_design" },
    });

    expect(history.rollbackGroup("other_group")).toEqual({
      ok: false,
      message: "History group other_group is not the latest change",
    });
    expect(history.rollbackGroup("group_design")).toMatchObject({ ok: true });
    expect(history.state()).toMatchObject({ canUndo: false, canRedo: false });
  });
});
