import type {
  DesignDocument,
  DesignTransaction,
  DesignTransactionSuccess,
  HistoryEntry,
  HistoryState,
} from "@opendesign/design-contracts";
import { deepFreeze } from "./document.js";
import { diffDocuments } from "./document-diff.js";

export interface EditorApplyOptions {
  historyGroupId?: string;
  finalizeHistoryGroup?: boolean;
}

export interface HistoryRecord {
  entry: HistoryEntry;
  before: DesignDocument;
  after: DesignDocument;
  groupId?: string;
}

export type HistoryApplyRejection = {
  code: "invalid" | "conflict";
  message: string;
  retryable: boolean;
};

export type HistoryStep =
  { ok: true; record: HistoryRecord } | { ok: false; message: string };

export class EditorHistory {
  #undo: HistoryRecord[] = [];
  #redo: HistoryRecord[] = [];
  #activeGroupId: string | undefined;

  validateApply(
    options: EditorApplyOptions,
  ): HistoryApplyRejection | undefined {
    if (
      options.finalizeHistoryGroup === true &&
      options.historyGroupId === undefined
    ) {
      return {
        code: "invalid",
        message: "A finalized history group requires a historyGroupId",
        retryable: false,
      };
    }
    if (
      this.#activeGroupId === undefined ||
      options.historyGroupId === this.#activeGroupId
    ) {
      return undefined;
    }
    return {
      code: "conflict",
      message: `Design change ${this.#activeGroupId} is still being applied`,
      retryable: true,
    };
  }

  recordApply(input: {
    before: DesignDocument;
    after: DesignDocument;
    transaction: DesignTransaction;
    result: DesignTransactionSuccess;
    options: EditorApplyOptions;
  }): void {
    const { before, after, transaction, result, options } = input;
    const previous = this.#undo.at(-1);
    if (
      options.historyGroupId !== undefined &&
      previous?.groupId === options.historyGroupId
    ) {
      this.#undo[this.#undo.length - 1] = {
        ...previous,
        after,
        entry: groupedHistoryEntry(
          previous,
          transaction,
          result,
          options.historyGroupId,
          after,
        ),
      };
    } else {
      this.#undo.push({
        before,
        after,
        entry: historyEntry(transaction, result, options.historyGroupId),
        ...(options.historyGroupId === undefined
          ? {}
          : { groupId: options.historyGroupId }),
      });
    }
    this.#redo = [];
    if (options.historyGroupId !== undefined) {
      this.#activeGroupId = options.finalizeHistoryGroup
        ? undefined
        : options.historyGroupId;
    }
  }

  rollbackGroup(historyGroupId: string): HistoryStep {
    const record = this.#undo.at(-1);
    if (!record || record.groupId !== historyGroupId) {
      return {
        ok: false,
        message: `History group ${historyGroupId} is not the latest change`,
      };
    }
    if (this.#activeGroupId === historyGroupId) {
      this.#activeGroupId = undefined;
    }
    this.#undo.pop();
    this.#redo = [];
    return { ok: true, record };
  }

  undo(): HistoryStep {
    if (this.#activeGroupId !== undefined) {
      return {
        ok: false,
        message: `Design change ${this.#activeGroupId} is still being applied`,
      };
    }
    const record = this.#undo.pop();
    if (!record) return { ok: false, message: "Nothing to undo" };
    this.#redo.push(record);
    return { ok: true, record };
  }

  redo(): HistoryStep {
    if (this.#activeGroupId !== undefined) {
      return {
        ok: false,
        message: `Design change ${this.#activeGroupId} is still being applied`,
      };
    }
    const record = this.#redo.pop();
    if (!record) return { ok: false, message: "Nothing to redo" };
    this.#undo.push(record);
    return { ok: true, record };
  }

  state(): HistoryState {
    return deepFreeze({
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undo: this.#undo.map((record) => record.entry),
      redo: this.#redo.map((record) => record.entry),
    });
  }
}

function historyEntry(
  transaction: DesignTransaction,
  result: DesignTransactionSuccess,
  transactionId = transaction.transactionId,
): HistoryEntry {
  return deepFreeze({
    transactionId,
    label: transaction.label ?? transaction.summary ?? "Design change",
    actor: transaction.actor,
    revision: result.revision,
    changes: result.changes,
  });
}

function groupedHistoryEntry(
  record: HistoryRecord,
  transaction: DesignTransaction,
  result: DesignTransactionSuccess,
  historyGroupId: string,
  after: DesignDocument,
): HistoryEntry {
  return deepFreeze({
    transactionId: historyGroupId,
    label: record.entry.label,
    actor: transaction.actor,
    revision: result.revision,
    changes: diffDocuments(record.before, after, result.revision.revision),
  });
}
