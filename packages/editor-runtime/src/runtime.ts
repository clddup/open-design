import {
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import {
  DesignNodeSchema,
  DesignTransactionSchema,
  ViewportStateSchema,
  isDesignTransaction,
  schemaValidationIssues,
  type DesignActor,
  type DesignChangeSet,
  type ComponentSelectionTarget,
  type DesignDocument,
  type DesignError,
  type DesignNode,
  type DesignOperation,
  type DesignTransaction,
  type DesignTransactionFailure,
  type DesignTransactionResult,
  type DesignTransactionSuccess,
  type EditorEvent,
  type EditorState,
  type FidelityWarning,
  type HistoryEntry,
  type HistoryState,
  type Revision,
  type SelectionState,
  type TextRunStyle,
  type ViewportState,
} from "@opendesign/design-contracts";
import {
  validateTextFontAvailabilityResult,
  validateTextLayoutResult,
  validateTextRunLayoutResult,
  type TextFontAvailabilityResult,
  type TextFontDescriptor,
  type TextLayoutProvider,
  type TextLayoutRequest,
  type TextRunLayoutProvider,
  type TextRunLayoutStyle,
} from "@opendesign/text-service";
import {
  canonicalJsonStringify,
  deepFreeze,
  documentContentFingerprint,
  DocumentValidationError,
  normalizeDesignDocument,
} from "./document.js";
import { nodeChangedFields } from "./node-change-fields.js";
import { resolveAutoLayoutUntilStable } from "./auto-layout-operations.js";
import {
  normalizeTextResizeProperties,
  textLayoutAffected,
} from "./text-layout-operations.js";
import { isEffectivelyLocked } from "./layer-operations.js";
import { synchronizeComponentPropertyDefaults } from "./component-property-defaults.js";
import { applySlotStretchOnInsert } from "./component-slot-operations.js";
import { OperationError } from "./operation-error.js";
import { diffVariantSets } from "./variant-set-diff.js";
import { detachStyleReferencesForUpdate } from "./style-runtime.js";
import {
  applyDesignSystemOperation,
  diffDesignSystems,
} from "./design-system-runtime.js";
import { deleteVariantSet, putVariantSet } from "./variant-set-runtime.js";
import {
  commitTextEditingSession,
  normalizeTextNodeRuns,
  prepareTextPropertiesUpdate,
  textRunBaseStyle,
  updateTextRangeStyle,
} from "./rich-text-operations.js";
import { styleDefinition } from "@opendesign/style-service";

export interface EditorSnapshot {
  document: DesignDocument;
  state: EditorState;
}

export type EditorRuntimeListener = (
  event: EditorEvent,
  snapshot: EditorSnapshot,
) => void;

export interface EditorRuntimeOptions {
  now?: () => string;
  createId?: (prefix: string) => string;
  onListenerError?: (error: unknown, event: EditorEvent) => void;
  initialTool?: string;
  initialViewport?: Partial<ViewportState>;
  textLayoutProvider?: TextLayoutProvider;
  textRunLayoutProvider?: TextRunLayoutProvider<RuntimeTextRunStyle>;
}

type RuntimeTextRunStyle = TextRunLayoutStyle & { fill: unknown };

interface OperationContext {
  textLayoutProvider?: TextLayoutProvider;
  textRunLayoutProvider?: TextRunLayoutProvider<RuntimeTextRunStyle>;
  warnings: FidelityWarning[];
}

interface HistoryRecord {
  entry: HistoryEntry;
  before: DesignDocument;
  after: DesignDocument;
  groupId?: string;
}

export interface EditorApplyOptions {
  historyGroupId?: string;
  finalizeHistoryGroup?: boolean;
}

interface StoredTransaction {
  fingerprint: string;
  result: DesignTransactionSuccess;
}

interface QueuedEditorEvent {
  event: EditorEvent;
  snapshot: EditorSnapshot;
}

type EditorEventPayload = EditorEvent extends infer Event
  ? Event extends EditorEvent
    ? Omit<
        Event,
        "eventId" | "sequence" | "occurredAt" | "documentId" | "revision"
      >
    : never
  : never;

const DEFAULT_VIEWPORT: ViewportState = {
  panX: 0,
  panY: 0,
  zoom: 1,
  width: 0,
  height: 0,
};

export class EditorRuntime {
  #document: DesignDocument;
  #snapshot: EditorSnapshot;
  #selection: SelectionState = { nodeIds: [] };
  #tool: string;
  #viewport: ViewportState;
  #checkpointRevision: number;
  #checkpointFingerprint: string;
  #undo: HistoryRecord[] = [];
  #redo: HistoryRecord[] = [];
  #activeHistoryGroupId: string | undefined;
  #listeners = new Set<EditorRuntimeListener>();
  #transactions = new Map<string, StoredTransaction>();
  #eventQueue: QueuedEditorEvent[] = [];
  #dispatchingEvents = false;
  #revision: Revision;
  #sequence = 0;
  #idSequence = 0;
  readonly #now: () => string;
  readonly #createId: (prefix: string) => string;
  readonly #onListenerError: (error: unknown, event: EditorEvent) => void;
  #textLayoutProvider: TextLayoutProvider | undefined;
  #textRunLayoutProvider:
    TextRunLayoutProvider<RuntimeTextRunStyle> | undefined;

  constructor(document: unknown, options: EditorRuntimeOptions = {}) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#createId =
      options.createId ??
      ((prefix) => `${prefix}_${Date.now()}_${++this.#idSequence}`);
    this.#onListenerError = options.onListenerError ?? (() => undefined);
    this.#textLayoutProvider = options.textLayoutProvider;
    this.#textRunLayoutProvider = options.textRunLayoutProvider;
    this.#document = normalizeDesignDocument(document);
    this.#tool = options.initialTool ?? "select";
    this.#viewport = validateViewport({
      ...DEFAULT_VIEWPORT,
      ...options.initialViewport,
    });
    this.#checkpointRevision = this.#document.revision;
    this.#checkpointFingerprint = documentContentFingerprint(this.#document);
    this.#revision = deepFreeze({
      revision: this.#document.revision,
      createdAt: this.#now(),
      label: "Opened document",
    });
    this.#snapshot = this.#createSnapshot();
  }

  getSnapshot(): EditorSnapshot {
    return this.#snapshot;
  }

  setTextLayoutProvider(provider: TextLayoutProvider): void {
    this.#textLayoutProvider = provider;
  }

  setTextRunLayoutProvider(
    provider: TextRunLayoutProvider<RuntimeTextRunStyle>,
  ): void {
    this.#textRunLayoutProvider = provider;
  }

  inspectTextFont(descriptor: TextFontDescriptor): TextFontAvailabilityResult {
    const provider = this.#textLayoutProvider;
    if (!provider?.inspectFont) {
      return {
        status: "unknown",
        provider: provider?.id ?? "editor-runtime",
        providerVersion: provider?.version ?? "unavailable",
        message:
          "Font availability is unavailable until the canvas provider is ready",
      };
    }
    try {
      const result = provider.inspectFont(descriptor);
      if (
        validateTextFontAvailabilityResult(result) ||
        result.provider !== provider.id ||
        result.providerVersion !== provider.version
      ) {
        return {
          status: "unknown",
          provider: provider.id,
          providerVersion: provider.version,
          message: "Font availability provider returned an inconsistent result",
        };
      }
      return structuredClone(result);
    } catch {
      return {
        status: "unknown",
        provider: provider.id,
        providerVersion: provider.version,
        message: "Font availability provider could not inspect this font",
      };
    }
  }

  subscribe(listener: EditorRuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  preview(transaction: unknown): DesignTransactionResult {
    const validation = this.#validateTransaction(transaction, "preview");
    if (validation) return validation;
    const typedTransaction = transaction as DesignTransaction;
    const executed = this.#execute(typedTransaction);
    if (!executed.ok) {
      return this.#failure(typedTransaction, "preview", executed.error);
    }
    return this.#success(
      typedTransaction,
      "preview",
      executed.document,
      executed.changes,
      executed.warnings,
    );
  }

  apply(
    transaction: unknown,
    options: EditorApplyOptions = {},
  ): DesignTransactionResult {
    if (isDesignTransaction(transaction)) {
      const stored = this.#transactions.get(transaction.transactionId);
      if (stored) {
        if (stored.fingerprint === canonicalJsonStringify(transaction)) {
          return stored.result;
        }
        return this.#failure(transaction, "apply", {
          code: "duplicate",
          message: `Transaction ${transaction.transactionId} was already used with different content`,
          retryable: false,
        });
      }
    }

    const validation = this.#validateTransaction(transaction, "apply");
    if (validation) return validation;
    const typedTransaction = transaction as DesignTransaction;
    const historyGroupConflict = this.#historyGroupConflict(
      typedTransaction,
      options,
    );
    if (historyGroupConflict) return historyGroupConflict;
    const executed = this.#execute(typedTransaction);
    if (!executed.ok) {
      return this.#failure(typedTransaction, "apply", executed.error);
    }

    const before = this.#document;
    const result = this.#success(
      typedTransaction,
      "apply",
      executed.document,
      executed.changes,
      executed.warnings,
    );
    const selectionChanged = this.#commitDocument(
      executed.document,
      result.revision,
    );
    const previousHistory = this.#undo.at(-1);
    if (
      options.historyGroupId !== undefined &&
      previousHistory?.groupId === options.historyGroupId
    ) {
      this.#undo[this.#undo.length - 1] = {
        ...previousHistory,
        after: this.#document,
        entry: groupedHistoryEntry(
          previousHistory,
          typedTransaction,
          result,
          options.historyGroupId,
          this.#document,
        ),
      };
    } else {
      this.#undo.push({
        before,
        after: this.#document,
        entry: historyEntry(typedTransaction, result, options.historyGroupId),
        ...(options.historyGroupId === undefined
          ? {}
          : { groupId: options.historyGroupId }),
      });
    }
    this.#redo = [];
    this.#transactions.set(typedTransaction.transactionId, {
      fingerprint: canonicalJsonStringify(typedTransaction),
      result,
    });
    if (options.historyGroupId !== undefined) {
      this.#activeHistoryGroupId = options.finalizeHistoryGroup
        ? undefined
        : options.historyGroupId;
    }
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  rollbackHistoryGroup(
    historyGroupId: string,
    actorId = "opendesign-agent",
  ): DesignTransactionResult {
    const record = this.#undo.at(-1);
    if (!record || record.groupId !== historyGroupId) {
      return this.#historyFailure(
        "undo",
        actorId,
        `History group ${historyGroupId} is not the latest change`,
      );
    }
    if (this.#activeHistoryGroupId === historyGroupId) {
      this.#activeHistoryGroupId = undefined;
    }
    this.#undo.pop();
    this.#redo = [];
    const transactionId = this.#createId("rollback");
    const baseRevision = this.#document.revision;
    const nextRevision = baseRevision + 1;
    const document = withRevision(record.before, nextRevision);
    const actor: DesignActor = { type: "agent", id: actorId };
    const changes = diffDocuments(this.#document, document, nextRevision);
    const revision = this.#newRevision(
      nextRevision,
      `Cancelled ${record.entry.label}`,
      transactionId,
      actor,
    );
    const result = deepFreeze({
      ok: true,
      mode: "undo",
      transactionId,
      documentId: document.documentId,
      baseRevision,
      revision,
      changes,
      warnings: [],
    } satisfies DesignTransactionSuccess);
    const selectionChanged = this.#commitDocument(document, revision);
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  undo(actorId = "local-user"): DesignTransactionResult {
    if (this.#activeHistoryGroupId !== undefined) {
      return this.#historyFailure(
        "undo",
        actorId,
        `Design change ${this.#activeHistoryGroupId} is still being applied`,
      );
    }
    const record = this.#undo.pop();
    if (!record) {
      return this.#historyFailure("undo", actorId, "Nothing to undo");
    }
    const transactionId = this.#createId("undo");
    const baseRevision = this.#document.revision;
    const nextRevision = baseRevision + 1;
    const document = withRevision(record.before, nextRevision);
    const actor: DesignActor = { type: "user", id: actorId };
    const changes = diffDocuments(this.#document, document, nextRevision);
    const revision = this.#newRevision(
      nextRevision,
      `Undo ${record.entry.label}`,
      transactionId,
      actor,
    );
    const result = deepFreeze({
      ok: true,
      mode: "undo",
      transactionId,
      documentId: document.documentId,
      baseRevision,
      revision,
      changes,
      warnings: [],
    } satisfies DesignTransactionSuccess);
    this.#redo.push(record);
    const selectionChanged = this.#commitDocument(document, revision);
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  redo(actorId = "local-user"): DesignTransactionResult {
    if (this.#activeHistoryGroupId !== undefined) {
      return this.#historyFailure(
        "redo",
        actorId,
        `Design change ${this.#activeHistoryGroupId} is still being applied`,
      );
    }
    const record = this.#redo.pop();
    if (!record) {
      return this.#historyFailure("redo", actorId, "Nothing to redo");
    }
    const transactionId = this.#createId("redo");
    const baseRevision = this.#document.revision;
    const nextRevision = baseRevision + 1;
    const document = withRevision(record.after, nextRevision);
    const actor: DesignActor = { type: "user", id: actorId };
    const changes = diffDocuments(this.#document, document, nextRevision);
    const revision = this.#newRevision(
      nextRevision,
      `Redo ${record.entry.label}`,
      transactionId,
      actor,
    );
    const result = deepFreeze({
      ok: true,
      mode: "redo",
      transactionId,
      documentId: document.documentId,
      baseRevision,
      revision,
      changes,
      warnings: [],
    } satisfies DesignTransactionSuccess);
    this.#undo.push(record);
    const selectionChanged = this.#commitDocument(document, revision);
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  checkpoint(label?: string): Revision {
    this.#checkpointRevision = this.#document.revision;
    this.#checkpointFingerprint = documentContentFingerprint(this.#document);
    this.#refreshSnapshot();
    this.#emit({
      type: "checkpoint.created",
      checkpointRevision: this.#checkpointRevision,
      ...(label === undefined ? {} : { label }),
    });
    this.#emit({
      type: "dirty.changed",
      dirty: false,
      checkpointRevision: this.#checkpointRevision,
    });
    return deepFreeze({
      ...this.#revision,
      ...(label === undefined ? {} : { label }),
    });
  }

  setSelection(
    nodeIds: readonly string[],
    anchorNodeId?: string,
    componentTarget?: ComponentSelectionTarget,
  ): void {
    const unique = [...new Set(nodeIds)].filter(
      (nodeId) => this.#document.nodesById[nodeId] !== undefined,
    );
    const anchor =
      anchorNodeId && unique.includes(anchorNodeId) ? anchorNodeId : unique[0];
    const target = validComponentSelectionTarget(
      this.#document,
      unique,
      componentTarget,
    );
    if (
      arraysEqual(unique, this.#selection.nodeIds) &&
      anchor === this.#selection.anchorNodeId &&
      sameComponentSelectionTarget(target, this.#selection.componentTarget)
    ) {
      return;
    }
    this.#selection = deepFreeze({
      nodeIds: unique,
      ...(anchor === undefined ? {} : { anchorNodeId: anchor }),
      ...(target === undefined ? {} : { componentTarget: target }),
    });
    this.#refreshSnapshot();
    this.#emit({ type: "selection.changed", selection: this.#selection });
  }

  setTool(tool: string): void {
    if (tool.length === 0) throw new Error("Tool must be a non-empty string");
    if (tool === this.#tool) return;
    this.#tool = tool;
    this.#refreshSnapshot();
    this.#emit({ type: "tool.changed", tool });
  }

  setViewport(viewport: Partial<ViewportState>): void {
    const next = validateViewport({ ...this.#viewport, ...viewport });
    if (JSON.stringify(next) === JSON.stringify(this.#viewport)) return;
    this.#viewport = deepFreeze(next);
    this.#refreshSnapshot();
    this.#emit({ type: "viewport.changed", viewport: this.#viewport });
  }

  #validateTransaction(
    transaction: unknown,
    mode: "preview" | "apply",
  ): DesignTransactionFailure | null {
    const fallback = transactionEnvelope(transaction, this.#document);
    if (!isDesignTransaction(transaction)) {
      const issues = schemaValidationIssues(
        DesignTransactionSchema,
        transaction,
      );
      return deepFreeze({
        ok: false,
        mode,
        ...fallback,
        revision: this.#revision,
        error: {
          code: "invalid",
          message: "Transaction does not match the design schema",
          retryable: false,
          details: issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
      });
    }
    if (transaction.documentId !== this.#document.documentId) {
      return this.#failure(transaction, mode, {
        code: "invalid",
        message: `Transaction targets document ${transaction.documentId}`,
        retryable: false,
      });
    }
    if (transaction.baseRevision !== this.#document.revision) {
      return this.#failure(transaction, mode, {
        code: "conflict",
        message: `Expected revision ${transaction.baseRevision}, current revision is ${this.#document.revision}`,
        retryable: true,
        details: {
          expectedRevision: transaction.baseRevision,
          currentRevision: this.#document.revision,
        },
      });
    }
    const commandIds = new Set<string>();
    for (const command of transaction.commands) {
      if (commandIds.has(command.commandId)) {
        return this.#failure(transaction, mode, {
          code: "invalid",
          message: `Command id ${command.commandId} is duplicated`,
          commandId: command.commandId,
          retryable: false,
        });
      }
      commandIds.add(command.commandId);
    }
    return null;
  }

  #execute(transaction: DesignTransaction):
    | {
        ok: true;
        document: DesignDocument;
        changes: DesignChangeSet;
        warnings: FidelityWarning[];
      }
    | { ok: false; error: DesignError } {
    const draft = structuredClone(this.#document);
    const context: OperationContext = {
      ...(this.#textLayoutProvider
        ? { textLayoutProvider: this.#textLayoutProvider }
        : {}),
      ...(this.#textRunLayoutProvider
        ? { textRunLayoutProvider: this.#textRunLayoutProvider }
        : {}),
      warnings: [],
    };
    try {
      for (const command of transaction.commands)
        applyOperation(draft, command, context);
      const autoLayoutCommandId =
        transaction.commands.at(-1)?.commandId ?? "auto_layout";
      const autoLayout = resolveAutoLayoutUntilStable(draft, (node) =>
        resolveTextAutoSize(node, autoLayoutCommandId, context),
      );
      if (!autoLayout.ok) {
        throw new OperationError(
          transaction.commands.at(-1)?.commandId ?? "auto_layout",
          autoLayout.message,
          "invalid",
          {
            path: `/nodesById/${escapeJsonPointer(autoLayout.frameId)}/properties/autoLayout`,
            details: {
              nodeId: autoLayout.frameId,
              feature: "linear-auto-layout-v1",
              providerCode: autoLayout.code,
            },
          },
        );
      }
      draft.revision = this.#document.revision + 1;
      const document = normalizeDesignDocument(draft);
      return {
        ok: true,
        document,
        changes: diffDocuments(this.#document, document, document.revision),
        warnings: context.warnings,
      };
    } catch (error) {
      return {
        ok: false,
        error: operationError(error),
      };
    }
  }

  #success(
    transaction: DesignTransaction,
    mode: "preview" | "apply",
    document: DesignDocument,
    changes: DesignChangeSet,
    warnings: FidelityWarning[] = [],
  ): DesignTransactionSuccess {
    return deepFreeze({
      ok: true,
      mode,
      transactionId: transaction.transactionId,
      documentId: transaction.documentId,
      baseRevision: transaction.baseRevision,
      revision: this.#newRevision(
        document.revision,
        transaction.label,
        transaction.transactionId,
        transaction.actor,
      ),
      changes,
      warnings,
    });
  }

  #failure(
    transaction: DesignTransaction,
    mode: "preview" | "apply",
    error: DesignError,
  ): DesignTransactionFailure {
    return deepFreeze({
      ok: false,
      mode,
      transactionId: transaction.transactionId,
      documentId: transaction.documentId,
      baseRevision: transaction.baseRevision,
      revision: this.#revision,
      error,
    });
  }

  #historyFailure(
    mode: "undo" | "redo",
    actorId: string,
    message: string,
  ): DesignTransactionFailure {
    return deepFreeze({
      ok: false,
      mode,
      transactionId: this.#createId(mode),
      documentId: this.#document.documentId,
      baseRevision: this.#document.revision,
      revision: this.#revision,
      error: {
        code: "invalid",
        message,
        retryable: false,
        details: { actorId },
      },
    });
  }

  #historyGroupConflict(
    transaction: DesignTransaction,
    options: EditorApplyOptions,
  ): DesignTransactionFailure | undefined {
    if (
      options.finalizeHistoryGroup === true &&
      options.historyGroupId === undefined
    ) {
      return this.#failure(transaction, "apply", {
        code: "invalid",
        message: "A finalized history group requires a historyGroupId",
        retryable: false,
      });
    }
    if (
      this.#activeHistoryGroupId === undefined ||
      options.historyGroupId === this.#activeHistoryGroupId
    ) {
      return undefined;
    }
    return this.#failure(transaction, "apply", {
      code: "conflict",
      message: `Design change ${this.#activeHistoryGroupId} is still being applied`,
      retryable: true,
    });
  }

  #newRevision(
    revision: number,
    label: string | undefined,
    transactionId: string,
    actor: DesignActor,
  ): Revision {
    return deepFreeze({
      revision,
      createdAt: this.#now(),
      ...(label === undefined ? {} : { label }),
      transactionId,
      actor,
    });
  }

  #commitDocument(document: DesignDocument, revision: Revision): boolean {
    this.#document = document;
    this.#revision = revision;
    const previousSelection = this.#selection;
    const selected = previousSelection.nodeIds.filter(
      (nodeId) => document.nodesById[nodeId] !== undefined,
    );
    const componentTarget = validComponentSelectionTarget(
      document,
      selected,
      previousSelection.componentTarget,
    );
    if (
      !arraysEqual(selected, previousSelection.nodeIds) ||
      !sameComponentSelectionTarget(
        componentTarget,
        previousSelection.componentTarget,
      )
    ) {
      const anchorNodeId =
        previousSelection.anchorNodeId &&
        selected.includes(previousSelection.anchorNodeId)
          ? previousSelection.anchorNodeId
          : selected[0];
      this.#selection = deepFreeze({
        nodeIds: selected,
        ...(anchorNodeId === undefined ? {} : { anchorNodeId }),
        ...(componentTarget === undefined ? {} : { componentTarget }),
      });
    }
    this.#refreshSnapshot();
    return this.#selection !== previousSelection;
  }

  #afterDocumentChange(
    result: DesignTransactionSuccess,
    selectionChanged: boolean,
  ): void {
    this.#refreshSnapshot();
    this.#emit({ type: "document.changed", result });
    if (selectionChanged) {
      this.#emit({ type: "selection.changed", selection: this.#selection });
    }
    this.#emit({ type: "history.changed", history: this.#historyState() });
    this.#emit({
      type: "dirty.changed",
      dirty: this.#isDirty(),
      checkpointRevision: this.#checkpointRevision,
    });
  }

  #emit(payload: EditorEventPayload): void {
    const sequence = ++this.#sequence;
    const event: EditorEvent = deepFreeze({
      ...payload,
      eventId: this.#createId("event"),
      sequence,
      occurredAt: this.#now(),
      documentId: this.#document.documentId,
      revision: this.#document.revision,
    });
    this.#eventQueue.push({ event, snapshot: this.#snapshot });
    if (this.#dispatchingEvents) return;

    this.#dispatchingEvents = true;
    try {
      while (this.#eventQueue.length > 0) {
        const queued = this.#eventQueue.shift();
        if (!queued) continue;
        for (const listener of [...this.#listeners]) {
          try {
            listener(queued.event, queued.snapshot);
          } catch (error) {
            try {
              this.#onListenerError(error, queued.event);
            } catch {
              // Diagnostics must not change committed runtime results.
            }
          }
        }
      }
    } finally {
      this.#dispatchingEvents = false;
    }
  }

  #isDirty(): boolean {
    return (
      documentContentFingerprint(this.#document) !== this.#checkpointFingerprint
    );
  }

  #historyState(): HistoryState {
    return deepFreeze({
      canUndo: this.#undo.length > 0,
      canRedo: this.#redo.length > 0,
      undo: this.#undo.map((record) => record.entry),
      redo: this.#redo.map((record) => record.entry),
    });
  }

  #createSnapshot(): EditorSnapshot {
    return deepFreeze({
      document: this.#document,
      state: {
        documentId: this.#document.documentId,
        revision: this.#document.revision,
        selection: this.#selection,
        tool: this.#tool,
        viewport: this.#viewport,
        dirty: this.#isDirty(),
        checkpointRevision: this.#checkpointRevision,
        history: this.#historyState(),
      },
    });
  }

  #refreshSnapshot(): void {
    this.#snapshot = this.#createSnapshot();
  }
}

function applyOperation(
  document: DesignDocument,
  command: DesignOperation,
  context: OperationContext,
): void {
  switch (command.type) {
    case "insert_element":
      insertElement(document, command, context);
      return;
    case "update_properties":
      updateProperties(document, command, context);
      return;
    case "move_element":
      moveElement(document, command);
      return;
    case "delete_element":
      deleteElement(document, command);
      return;
    case "replace_subtree":
      replaceSubtree(document, command, context);
      return;
    case "reflow_text":
      reflowText(document, command, context);
      return;
    case "update_text_range_style":
      applyTextRangeStyleOperation(document, command, context);
      return;
    case "commit_text_edit":
      applyTextEditingSessionOperation(document, command, context);
      return;
    case "put_asset":
      putAsset(document, command);
      return;
    case "delete_asset":
      deleteAsset(document, command);
      return;
    case "put_component":
      putComponent(document, command);
      return;
    case "delete_component":
      deleteComponent(document, command);
      return;
    case "put_library_component_source":
      putLibraryComponentSource(document, command);
      return;
    case "delete_library_component_source":
      deleteLibraryComponentSource(document, command);
      return;
    case "put_library_variant_set_source":
      putLibraryVariantSetSource(document, command);
      return;
    case "delete_library_variant_set_source":
      deleteLibraryVariantSetSource(document, command);
      return;
    case "put_variant_set":
      putVariantSet(document, command);
      return;
    case "delete_variant_set":
      deleteVariantSet(document, command);
      return;
    case "insert_page":
      insertPage(document, command);
      return;
    case "update_page":
      updatePage(document, command);
      return;
    case "move_page":
      movePage(document, command);
      return;
    case "delete_page":
      deletePage(document, command);
      return;
    default:
      if (applyDesignSystemOperation(document, command)) return;
  }
}

function insertPage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "insert_page" }>,
): void {
  if (document.pagesById[command.page.id]) {
    throw new OperationError(
      command.commandId,
      `Page ${command.page.id} already exists`,
      "duplicate",
    );
  }
  assertPageName(command.page.name, command.commandId);
  assertIndex(document.pageOrder, command.index, command.commandId);
  const insertedNodeIds = new Set<string>();
  for (const node of command.nodes) {
    if (insertedNodeIds.has(node.id)) {
      throw new OperationError(
        command.commandId,
        `Page contains duplicate node ${node.id}`,
        "duplicate",
      );
    }
    if (document.nodesById[node.id]) {
      throw new OperationError(
        command.commandId,
        `Node ${node.id} already exists`,
        "duplicate",
      );
    }
    insertedNodeIds.add(node.id);
  }
  document.pagesById[command.page.id] = structuredClone(command.page);
  document.pageOrder.splice(command.index, 0, command.page.id);
  for (const node of command.nodes) {
    document.nodesById[node.id] = structuredClone(node);
  }
}

function updatePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_page" }>,
): void {
  const page = assertPage(document, command.pageId, command.commandId);
  assertPageName(command.name, command.commandId);
  if (page.name === command.name) {
    throw new OperationError(command.commandId, "Page name is unchanged");
  }
  page.name = command.name;
}

function movePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "move_page" }>,
): void {
  assertPage(document, command.pageId, command.commandId);
  const previousIndex = document.pageOrder.indexOf(command.pageId);
  if (previousIndex < 0) throw notFound(command.commandId, command.pageId);
  if (previousIndex === command.index) {
    throw new OperationError(command.commandId, "Page position is unchanged");
  }
  document.pageOrder.splice(previousIndex, 1);
  assertIndex(document.pageOrder, command.index, command.commandId);
  document.pageOrder.splice(command.index, 0, command.pageId);
}

function deletePage(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_page" }>,
): void {
  const page = assertPage(document, command.pageId, command.commandId);
  if (document.pageOrder.length <= 1) {
    throw new OperationError(
      command.commandId,
      "A Design File must contain at least one Page",
    );
  }
  const nodeIds = page.rootNodeIds.flatMap((nodeId) =>
    collectSubtreeIds(document, nodeId),
  );
  assertComponentSourcesRemain(document, new Set(nodeIds), command.commandId);
  document.pageOrder.splice(document.pageOrder.indexOf(command.pageId), 1);
  delete document.pagesById[command.pageId];
  for (const nodeId of nodeIds) delete document.nodesById[nodeId];
}

function assertPageName(name: string, commandId: string): void {
  if (name !== name.trim()) {
    throw new OperationError(
      commandId,
      "Page name must not start or end with whitespace",
    );
  }
  if (name.length === 0 || name.length > 256) {
    throw new OperationError(
      commandId,
      "Page name must contain from 1 to 256 characters",
    );
  }
  if (/\p{Cc}/u.test(name)) {
    throw new OperationError(commandId, "Page name cannot contain controls");
  }
}

function putAsset(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_asset" }>,
): void {
  document.assetsById[command.asset.id] = structuredClone(command.asset);
}

function deleteAsset(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_asset" }>,
): void {
  if (!document.assetsById[command.assetId]) {
    throw notFound(command.commandId, command.assetId);
  }
  const referencingNode = Object.values(document.nodesById).find((node) =>
    nodeAssetIds(node).includes(command.assetId),
  );
  if (referencingNode) {
    throw new OperationError(
      command.commandId,
      `Asset ${command.assetId} is still referenced by node ${referencingNode.id}`,
    );
  }
  delete document.assetsById[command.assetId];
}

function putComponent(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_component" }>,
): void {
  const existing = document.componentsById[command.component.id];
  if (existing && existing.rootNodeId !== command.component.rootNodeId) {
    throw new OperationError(
      command.commandId,
      `Component ${command.component.id} is already bound to ${existing.rootNodeId}`,
      "duplicate",
    );
  }
  document.componentsById[command.component.id] = structuredClone(
    command.component,
  );
}

function deleteComponent(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_component" }>,
): void {
  if (!document.componentsById[command.componentId]) {
    throw notFound(command.commandId, command.componentId);
  }
  const referencingInstance = Object.values(document.nodesById).find(
    (node) =>
      node.kind === "instance" &&
      node.properties.componentId === command.componentId,
  );
  if (referencingInstance) {
    throw new OperationError(
      command.commandId,
      `Component ${command.componentId} is still referenced by instance ${referencingInstance.id}`,
    );
  }
  delete document.componentsById[command.componentId];
}

function putLibraryComponentSource(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_library_component_source" }>,
): void {
  const componentId = command.source.component.id;
  if (document.componentsById[componentId]) {
    throw new OperationError(
      command.commandId,
      `Library component ${componentId} conflicts with a local component`,
      "duplicate",
    );
  }
  const existing = document.libraryComponentsById[componentId];
  if (existing) {
    assertStableLibraryIdentity(
      command.commandId,
      existing.source,
      command.source.source,
      "sourceComponentId",
      componentId,
    );
  }
  document.libraryComponentsById[componentId] = structuredClone(command.source);
}

function deleteLibraryComponentSource(
  document: DesignDocument,
  command: Extract<
    DesignOperation,
    { type: "delete_library_component_source" }
  >,
): void {
  if (!document.libraryComponentsById[command.componentId]) {
    throw notFound(command.commandId, command.componentId);
  }
  const persistentInstance = Object.values(document.nodesById).find(
    (node) =>
      node.kind === "instance" &&
      node.properties.componentId === command.componentId,
  );
  if (persistentInstance) {
    throw new OperationError(
      command.commandId,
      `Library component ${command.componentId} is still referenced by instance ${persistentInstance.id}`,
    );
  }
  const dependentSource = Object.values(document.libraryComponentsById).find(
    (source) =>
      source.component.id !== command.componentId &&
      source.dependencyComponentIds.includes(command.componentId),
  );
  if (dependentSource) {
    throw new OperationError(
      command.commandId,
      `Library component ${command.componentId} is still required by ${dependentSource.component.id}`,
    );
  }
  const definitionReference = allComponentDefinitions(document).find(
    (component) =>
      component.id !== command.componentId &&
      Object.values(component.componentPropertyDefinitions).some(
        (definition) =>
          (definition.type === "INSTANCE_SWAP" &&
            definition.defaultValue === command.componentId) ||
          ((definition.type === "INSTANCE_SWAP" ||
            definition.type === "SLOT") &&
            definition.preferredValues?.some(
              (preferred) =>
                preferred.type === "COMPONENT" &&
                preferred.key === command.componentId,
            )),
      ),
  );
  if (definitionReference) {
    throw new OperationError(
      command.commandId,
      `Library component ${command.componentId} is still referenced by component ${definitionReference.id}`,
    );
  }
  const variantSet = Object.values(document.libraryVariantSetsById).find(
    (source) =>
      document.libraryComponentsById[command.componentId]?.component
        .variantSetId === source.variantSet.id,
  );
  if (variantSet) {
    throw new OperationError(
      command.commandId,
      `Library component ${command.componentId} is still a member of variant set ${variantSet.variantSet.id}`,
    );
  }
  delete document.libraryComponentsById[command.componentId];
}

function putLibraryVariantSetSource(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "put_library_variant_set_source" }>,
): void {
  const variantSetId = command.source.variantSet.id;
  if (document.variantSetsById[variantSetId]) {
    throw new OperationError(
      command.commandId,
      `Library variant set ${variantSetId} conflicts with a local variant set`,
      "duplicate",
    );
  }
  const existing = document.libraryVariantSetsById[variantSetId];
  if (existing) {
    assertStableLibraryIdentity(
      command.commandId,
      existing.source,
      command.source.source,
      "sourceVariantSetId",
      variantSetId,
    );
  }
  document.libraryVariantSetsById[variantSetId] = structuredClone(
    command.source,
  );
}

function deleteLibraryVariantSetSource(
  document: DesignDocument,
  command: Extract<
    DesignOperation,
    { type: "delete_library_variant_set_source" }
  >,
): void {
  if (!document.libraryVariantSetsById[command.variantSetId]) {
    throw notFound(command.commandId, command.variantSetId);
  }
  const member = allComponentDefinitions(document).find(
    (component) => component.variantSetId === command.variantSetId,
  );
  if (member) {
    throw new OperationError(
      command.commandId,
      `Library variant set ${command.variantSetId} is still referenced by component ${member.id}`,
    );
  }
  const preferredBy = allComponentDefinitions(document).find((component) =>
    Object.values(component.componentPropertyDefinitions).some(
      (definition) =>
        (definition.type === "INSTANCE_SWAP" || definition.type === "SLOT") &&
        definition.preferredValues?.some(
          (preferred) =>
            preferred.type === "COMPONENT_SET" &&
            preferred.key === command.variantSetId,
        ),
    ),
  );
  if (preferredBy) {
    throw new OperationError(
      command.commandId,
      `Library variant set ${command.variantSetId} is still preferred by component ${preferredBy.id}`,
    );
  }
  delete document.libraryVariantSetsById[command.variantSetId];
}

function assertStableLibraryIdentity(
  commandId: string,
  existing: Record<string, string>,
  replacement: Record<string, string>,
  sourceEntityField: "sourceComponentId" | "sourceVariantSetId",
  entityId: string,
): void {
  const stableFields = [
    "libraryId",
    "sourceProjectId",
    "sourceDesignFileId",
    "sourceDocumentId",
    sourceEntityField,
  ] as const;
  const changed = stableFields.find(
    (field) => existing[field] !== replacement[field],
  );
  if (!changed) return;
  throw new OperationError(
    commandId,
    `Library source identity for ${entityId} cannot change ${changed}; import it under a new stable id`,
    "invalid",
  );
}

function allComponentDefinitions(document: DesignDocument) {
  return [
    ...Object.values(document.componentsById),
    ...Object.values(document.libraryComponentsById).map(
      (source) => source.component,
    ),
  ];
}

function insertElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "insert_element" }>,
  context: OperationContext,
): void {
  if (document.nodesById[command.node.id]) {
    throw new OperationError(
      command.commandId,
      `Node ${command.node.id} already exists`,
      "duplicate",
    );
  }
  assertPage(document, command.pageId, command.commandId);
  if (command.node.parentId !== command.parentId) {
    throw new OperationError(
      command.commandId,
      "Inserted node parentId does not match the target parent",
    );
  }
  const target = targetChildren(
    document,
    command.pageId,
    command.parentId,
    command.commandId,
  );
  assertIndex(target, command.index, command.commandId);
  document.nodesById[command.node.id] = structuredClone(command.node);
  const inserted = document.nodesById[command.node.id];
  if (inserted && command.parentId) {
    applySlotStretchOnInsert(document, command.parentId, inserted);
  }
  if (inserted?.kind === "text") {
    normalizeTextNodeRuns(inserted, command.commandId);
    normalizeTextResizeProperties(inserted.properties);
    resolveTextAutoSize(inserted, command.commandId, context);
  }
  target.splice(command.index, 0, command.node.id);
}

function updateProperties(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_properties" }>,
  context: OperationContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw notFound(command.commandId, command.nodeId);
  detachStyleReferencesForUpdate(document, node, command);
  if (node.kind === "instance" && command.size !== undefined) {
    throw new OperationError(
      command.commandId,
      "Instance size follows its main component; resize the main component or detach the instance",
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/size` },
    );
  }
  assertBooleanOperandUpdateAllowed(document, node, command);
  if (node.kind === "text") {
    if (
      command.properties &&
      (Object.hasOwn(command.properties, "runs") ||
        Object.hasOwn(command.properties, "paragraphRuns"))
    ) {
      throw new OperationError(
        command.commandId,
        "Text character and paragraph runs cannot be replaced through update_properties; use update_text_range_style or replace the complete Text node",
        "invalid",
        {
          path: `/nodesById/${escapeJsonPointer(node.id)}/properties/${
            Object.hasOwn(command.properties, "paragraphRuns")
              ? "paragraphRuns"
              : "runs"
          }`,
        },
      );
    }
    prepareTextPropertiesUpdate(node, command.properties, command.commandId);
  }
  const fields = [
    "name",
    "visible",
    "locked",
    "transform",
    "size",
    "opacity",
    "constraints",
    "layoutPositioning",
    "layoutSizing",
    "layoutLimits",
    "gridPlacement",
    "componentPropertyReferences",
    "blendMode",
    "effects",
    "maskMode",
    "exportSettings",
    "properties",
    "extensions",
  ] as const;
  if (!fields.some((field) => command[field] !== undefined)) {
    throw new OperationError(
      command.commandId,
      "Update must change at least one field",
    );
  }
  for (const field of fields) {
    const value = command[field];
    if (value === undefined) continue;
    if (
      (field === "constraints" ||
        field === "layoutPositioning" ||
        field === "layoutSizing" ||
        field === "layoutLimits" ||
        field === "gridPlacement" ||
        field === "componentPropertyReferences") &&
      value === null
    ) {
      delete node[field];
      continue;
    }
    if (field === "properties" || field === "extensions") {
      Object.assign(node[field], structuredClone(value));
    } else {
      Object.assign(node, { [field]: structuredClone(value) });
    }
  }
  synchronizeComponentPropertyDefaults(document, node, command);
  if (node.kind === "text") {
    const requestedResize = command.properties?.textResize;
    if (command.size !== undefined && requestedResize === undefined) {
      node.properties.textResize = "fixed";
      if (node.properties.textWrap === "none")
        node.properties.textWrap = "word";
    }
    normalizeTextResizeProperties(node.properties);
    if (textLayoutAffected(command, requestedResize)) {
      resolveTextAutoSize(node, command.commandId, context);
    }
  }
  const schemaIssues = schemaValidationIssues(DesignNodeSchema, node);
  if (schemaIssues.length > 0) {
    const details = schemaIssues.slice(0, 128).map((issue) => ({
      path: `/nodesById/${escapeJsonPointer(node.id)}${issue.path}`,
      message: issue.message,
    }));
    const firstIssue = details[0];
    throw new OperationError(
      command.commandId,
      `Properties are invalid for ${node.kind} node ${node.id}: ${firstIssue?.message ?? "node does not match its kind"}`,
      "invalid",
      {
        ...(firstIssue ? { path: firstIssue.path } : {}),
        details,
      },
    );
  }
}

function reflowText(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "reflow_text" }>,
  context: OperationContext,
): void {
  const font = command.replacementFont ?? command.expectedFont;
  const fontAvailability = inspectReflowFont(context, font, command.commandId);
  let changed = false;
  for (const nodeId of command.nodeIds) {
    const node = document.nodesById[nodeId];
    if (!node) throw notFound(command.commandId, nodeId);
    if (node.kind !== "text") {
      throw new OperationError(
        command.commandId,
        `Node ${nodeId} is not a Text layer`,
        "invalid",
        { path: `/nodesById/${escapeJsonPointer(nodeId)}` },
      );
    }
    if (isEffectivelyLocked(document, nodeId)) {
      throw new OperationError(
        command.commandId,
        `Text layer ${nodeId} is locked`,
        "permission-denied",
        { path: `/nodesById/${escapeJsonPointer(nodeId)}/locked` },
      );
    }
    if (
      node.properties.fontFamily !== command.expectedFont.fontFamily ||
      node.properties.fontStyleName !== command.expectedFont.fontStyleName ||
      node.properties.fontWeight !== command.expectedFont.fontWeight ||
      node.properties.fontSlant !== command.expectedFont.fontSlant
    ) {
      throw new OperationError(
        command.commandId,
        `Text layer ${nodeId} no longer uses the expected font`,
        "conflict",
        {
          path: `/nodesById/${escapeJsonPointer(nodeId)}/properties/fontFamily`,
          retryable: true,
          details: {
            nodeId,
            expectedFont: command.expectedFont,
            currentFont: {
              fontFamily: node.properties.fontFamily,
              fontStyleName: node.properties.fontStyleName,
              fontWeight: node.properties.fontWeight,
              fontSlant: node.properties.fontSlant,
            },
          },
        },
      );
    }
    const before = {
      fontFamily: node.properties.fontFamily,
      fontStyleName: node.properties.fontStyleName,
      fontWeight: node.properties.fontWeight,
      fontSlant: node.properties.fontSlant,
      size: structuredClone(node.size),
      runs: JSON.stringify(node.properties.runs ?? []),
    };
    if (command.replacementFont) {
      node.properties.fontFamily = command.replacementFont.fontFamily;
      node.properties.fontStyleName = command.replacementFont.fontStyleName;
      node.properties.fontWeight = command.replacementFont.fontWeight;
      node.properties.fontSlant = command.replacementFont.fontSlant;
      node.properties.runs = (node.properties.runs ?? []).map((run) =>
        run.style.fontFamily === command.expectedFont.fontFamily &&
        run.style.fontStyleName === command.expectedFont.fontStyleName &&
        run.style.fontWeight === command.expectedFont.fontWeight &&
        run.style.fontSlant === command.expectedFont.fontSlant
          ? {
              ...run,
              style: { ...run.style, ...command.replacementFont },
            }
          : run,
      );
    }
    if (fontAvailability.status === "unknown") {
      context.warnings.push({
        nodeId,
        feature: "text-layout.font-availability-unknown",
        fallback:
          "Applied the requested font and retained provider-measured bounds",
        message: fontAvailability.message,
      });
    }
    resolveTextAutoSize(node, command.commandId, context);
    changed ||=
      before.fontFamily !== node.properties.fontFamily ||
      before.fontStyleName !== node.properties.fontStyleName ||
      before.fontWeight !== node.properties.fontWeight ||
      before.fontSlant !== node.properties.fontSlant ||
      before.runs !== JSON.stringify(node.properties.runs ?? []) ||
      before.size.width !== node.size.width ||
      before.size.height !== node.size.height;
  }
  if (!changed) {
    throw new OperationError(
      command.commandId,
      "Text layout is already up to date",
      "invalid",
      { details: { code: "no-op", nodeIds: command.nodeIds } },
    );
  }
}

function applyTextRangeStyleOperation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "update_text_range_style" }>,
  context: OperationContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw notFound(command.commandId, command.nodeId);
  if (node.kind !== "text") {
    throw new OperationError(
      command.commandId,
      `Node ${node.id} is not a Text layer`,
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}` },
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    throw new OperationError(
      command.commandId,
      `Text layer ${node.id} is locked`,
      "permission-denied",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/locked` },
    );
  }
  let style = command.style;
  if (typeof command.style.textStyleId === "string") {
    const reference = styleDefinition(document, command.style.textStyleId);
    if (!reference)
      throw notFound(command.commandId, command.style.textStyleId);
    if (reference.styleType !== "TEXT") {
      throw new OperationError(
        command.commandId,
        `Style ${reference.id} is not a Text Style`,
        "invalid",
      );
    }
    style = {
      ...style,
      fontFamily: reference.textStyle.fontFamily,
      fontStyleName: reference.textStyle.fontStyleName,
      fontSize: reference.textStyle.fontSize,
      fontWeight: reference.textStyle.fontWeight,
      fontSlant: reference.textStyle.fontSlant,
      letterSpacing: reference.textStyle.letterSpacing,
      lineHeight: reference.textStyle.lineHeight,
      textCase: reference.textStyle.textCase,
      textDecoration: reference.textStyle.textDecoration,
      paragraphIndent: reference.textStyle.paragraphIndent,
      paragraphSpacing: reference.textStyle.paragraphSpacing,
      listSpacing: reference.textStyle.listSpacing,
    };
  }
  if (typeof command.style.fillStyleId === "string") {
    const reference = styleDefinition(document, command.style.fillStyleId);
    if (!reference)
      throw notFound(command.commandId, command.style.fillStyleId);
    if (reference.styleType !== "PAINT") {
      throw new OperationError(
        command.commandId,
        `Style ${reference.id} is not a Paint Style`,
        "invalid",
      );
    }
    style = { ...style, fills: structuredClone(reference.paints) };
  }
  updateTextRangeStyle(node, { ...command, style });
  resolveTextAutoSize(node, command.commandId, context);
}

function applyTextEditingSessionOperation(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "commit_text_edit" }>,
  context: OperationContext,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw notFound(command.commandId, command.nodeId);
  if (node.kind !== "text") {
    throw new OperationError(
      command.commandId,
      `Node ${node.id} is not a Text layer`,
      "invalid",
      { path: `/nodesById/${escapeJsonPointer(node.id)}` },
    );
  }
  if (isEffectivelyLocked(document, node.id)) {
    throw new OperationError(
      command.commandId,
      `Text layer ${node.id} is locked`,
      "permission-denied",
      { path: `/nodesById/${escapeJsonPointer(node.id)}/locked` },
    );
  }
  commitTextEditingSession(node, command);
  normalizeTextResizeProperties(node.properties);
  resolveTextAutoSize(node, command.commandId, context);
}

function inspectReflowFont(
  context: OperationContext,
  descriptor: TextFontDescriptor,
  commandId: string,
): TextFontAvailabilityResult {
  const provider = context.textLayoutProvider;
  if (!provider?.inspectFont) {
    throw new OperationError(
      commandId,
      "Font availability is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        retryable: true,
        details: {
          feature: "text-font-availability",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  let result: TextFontAvailabilityResult;
  try {
    result = provider.inspectFont(descriptor);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Font availability provider failed: ${error.message}`
        : "Font availability provider failed",
      "engine-failure",
      { retryable: true, details: { provider: provider.id } },
    );
  }
  const issue = validateTextFontAvailabilityResult(result);
  if (
    issue ||
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      issue ?? "Font availability provider returned inconsistent identity",
      "engine-failure",
      {
        retryable: true,
        details: {
          provider: provider.id,
          providerVersion: provider.version,
          resultProvider: result.provider,
          resultProviderVersion: result.providerVersion,
        },
      },
    );
  }
  if (result.status === "missing") {
    throw new OperationError(
      commandId,
      `Font ${descriptor.fontFamily} is not available to the current canvas`,
      "invalid",
      {
        details: {
          code: "font-missing",
          font: {
            fontFamily: descriptor.fontFamily,
            fontStyleName: descriptor.fontStyleName,
            fontWeight: descriptor.fontWeight,
            fontSlant: descriptor.fontSlant,
          },
          provider: provider.id,
        },
      },
    );
  }
  return result;
}

function moveElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "move_element" }>,
): void {
  const node = document.nodesById[command.nodeId];
  if (!node) throw notFound(command.commandId, command.nodeId);
  assertPage(document, command.pageId, command.commandId);
  const oldLocation = locateNode(document, command.nodeId);
  if (!oldLocation) throw notFound(command.commandId, command.nodeId);
  const oldChildren = targetChildren(
    document,
    oldLocation.pageId,
    oldLocation.parentId,
    command.commandId,
  );
  oldChildren.splice(oldLocation.index, 1);
  const target = targetChildren(
    document,
    command.pageId,
    command.parentId,
    command.commandId,
  );
  assertIndex(target, command.index, command.commandId);
  target.splice(command.index, 0, command.nodeId);

  node.parentId = command.parentId;
}

function deleteElement(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "delete_element" }>,
): void {
  const node = document.nodesById[command.nodeId];
  const location = locateNode(document, command.nodeId);
  if (!node || !location) throw notFound(command.commandId, command.nodeId);
  const deletedIds = new Set(collectSubtreeIds(document, command.nodeId));
  assertComponentSourcesRemain(document, deletedIds, command.commandId);
  const source = targetChildren(
    document,
    location.pageId,
    location.parentId,
    command.commandId,
  );
  source.splice(location.index, 1);
  for (const nodeId of deletedIds) {
    delete document.nodesById[nodeId];
  }
}

function replaceSubtree(
  document: DesignDocument,
  command: Extract<DesignOperation, { type: "replace_subtree" }>,
  context: OperationContext,
): void {
  const current = document.nodesById[command.rootNodeId];
  if (!current) throw notFound(command.commandId, command.rootNodeId);
  const replacement = new Map(command.nodes.map((node) => [node.id, node]));
  if (replacement.size !== command.nodes.length) {
    throw new OperationError(
      command.commandId,
      "Replacement subtree contains duplicate node ids",
    );
  }
  const root = replacement.get(command.rootNodeId);
  if (!root) {
    throw new OperationError(
      command.commandId,
      "Replacement nodes must include rootNodeId",
    );
  }
  if (root.parentId !== current.parentId) {
    throw new OperationError(
      command.commandId,
      "Replacement root must preserve its parent",
    );
  }
  const oldIds = new Set(collectSubtreeIds(document, command.rootNodeId));
  const removedIds = new Set(
    [...oldIds].filter((nodeId) => !replacement.has(nodeId)),
  );
  assertComponentSourcesRemain(document, removedIds, command.commandId);
  for (const node of command.nodes) {
    if (!oldIds.has(node.id) && document.nodesById[node.id]) {
      throw new OperationError(
        command.commandId,
        `Node ${node.id} already exists outside the replaced subtree`,
        "duplicate",
      );
    }
    for (const childId of node.childIds) {
      if (!replacement.has(childId)) {
        throw new OperationError(
          command.commandId,
          `Replacement child ${childId} is missing`,
        );
      }
    }
  }
  for (const nodeId of oldIds) delete document.nodesById[nodeId];
  for (const node of command.nodes) {
    document.nodesById[node.id] = structuredClone(node);
  }
  for (const node of command.nodes) {
    const replacementNode = document.nodesById[node.id];
    if (replacementNode?.kind !== "text") continue;
    normalizeTextNodeRuns(replacementNode, command.commandId);
    normalizeTextResizeProperties(replacementNode.properties);
    resolveTextAutoSize(replacementNode, command.commandId, context);
  }
}

type TextNode = Extract<DesignNode, { kind: "text" }>;

function resolveTextAutoSize(
  node: TextNode,
  commandId: string,
  context: OperationContext,
): void {
  if (node.properties.textResize === "fixed") return;
  if (
    (node.properties.runs?.length ?? 0) > 0 ||
    (node.properties.paragraphRuns?.length ?? 0) > 0
  ) {
    resolveRichTextAutoSize(node, commandId, context);
    return;
  }
  const provider = context.textLayoutProvider;
  if (!provider) {
    throw new OperationError(
      commandId,
      "Text Auto Size is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        details: {
          nodeId: node.id,
          feature: "text-auto-size",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  const request: TextLayoutRequest = {
    content: node.properties.content,
    fontFamily: node.properties.fontFamily,
    fontStyleName: node.properties.fontStyleName,
    fontSize: node.properties.fontSize,
    fontWeight: node.properties.fontWeight,
    fontSlant: node.properties.fontSlant,
    letterSpacing: node.properties.letterSpacing,
    lineHeight: node.properties.lineHeight,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    textCase: node.properties.textCase,
    textDecoration: node.properties.textDecoration,
    textTruncation: node.properties.textTruncation,
    maxLines: node.properties.maxLines,
    mode: node.properties.textResize,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-height"
      ? { width: node.size.width }
      : {}),
  };
  let result: ReturnType<TextLayoutProvider["measure"]>;
  try {
    result = provider.measure(request);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Text layout provider failed: ${error.message}`
        : "Text layout provider failed",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        details: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
          providerCode: "provider-threw",
        },
      },
    );
  }
  const resultIssue = validateTextLayoutResult(result);
  if (resultIssue) {
    throw new OperationError(
      commandId,
      `Text layout provider returned an invalid result: ${resultIssue}`,
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        retryable: true,
        details: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
        },
      },
    );
  }
  if (!result.ok) {
    throw new OperationError(commandId, result.message, "engine-failure", {
      path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
      retryable: result.retryable,
      details: {
        nodeId: node.id,
        provider: provider.id,
        providerVersion: provider.version,
        providerCode: result.code,
      },
    });
  }
  if (
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      "Text layout provider returned inconsistent identity",
      "engine-failure",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/size`,
        details: {
          nodeId: node.id,
          provider: provider.id,
          providerVersion: provider.version,
          resultProvider: result.provider,
          resultProviderVersion: result.providerVersion,
        },
      },
    );
  }
  node.size = structuredClone(result.size);
  context.warnings.push(
    ...result.warnings.map((warning) => ({
      nodeId: node.id,
      feature: `text-layout.${warning.code}`,
      fallback: warning.fallback,
      message: warning.message,
    })),
  );
}

function resolveRichTextAutoSize(
  node: TextNode,
  commandId: string,
  context: OperationContext,
): void {
  const provider = context.textRunLayoutProvider;
  const path = `/nodesById/${escapeJsonPointer(node.id)}/size`;
  if (!provider) {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size is still initializing; retry after the canvas is ready",
      "engine-failure",
      {
        path,
        retryable: true,
        details: {
          nodeId: node.id,
          feature: "rich-text-auto-size",
          recovery: "retry-after-canvas-ready",
        },
      },
    );
  }
  if (node.properties.textAlignHorizontal === "justify") {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size does not support justified alignment yet",
      "unsupported",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/properties/textAlignHorizontal`,
      },
    );
  }
  if (node.properties.textTruncation !== "disabled") {
    throw new OperationError(
      commandId,
      "Rich Text Auto Size does not support ending truncation yet",
      "unsupported",
      {
        path: `/nodesById/${escapeJsonPointer(node.id)}/properties/textTruncation`,
      },
    );
  }
  const request = {
    baseStyle: runtimeTextRunStyle(textRunBaseStyle(node)),
    content: node.properties.content,
    mode: node.properties.textResize,
    paragraphIndent: node.properties.paragraphIndent,
    paragraphSpacing: node.properties.paragraphSpacing,
    listSpacing: node.properties.listSpacing,
    hangingList: node.properties.hangingList,
    paragraphRuns: node.properties.paragraphRuns ?? [],
    runs: (node.properties.runs ?? []).map((run) => ({
      ...run,
      style: runtimeTextRunStyle(run.style),
    })),
    textAlignHorizontal: node.properties.textAlignHorizontal,
    textAlignVertical: node.properties.textAlignVertical,
    textWrap: node.properties.textWrap,
    ...(node.properties.textResize === "auto-height"
      ? { width: node.size.width }
      : {}),
  } as const;
  let result: ReturnType<typeof provider.layout>;
  try {
    result = provider.layout(request);
  } catch (error) {
    throw new OperationError(
      commandId,
      error instanceof Error && error.message
        ? `Rich text layout provider failed: ${error.message}`
        : "Rich text layout provider failed",
      "engine-failure",
      { path, retryable: true, details: { provider: provider.id } },
    );
  }
  const issue = validateTextRunLayoutResult(result, request);
  if (issue) {
    throw new OperationError(commandId, issue, "engine-failure", {
      path,
      retryable: true,
      details: { provider: provider.id, providerVersion: provider.version },
    });
  }
  if (!result.ok) {
    throw new OperationError(
      commandId,
      result.message,
      result.code === "unsupported" ? "unsupported" : "engine-failure",
      {
        path,
        retryable: result.retryable,
        details: { provider: provider.id, providerVersion: provider.version },
      },
    );
  }
  if (
    result.provider !== provider.id ||
    result.providerVersion !== provider.version
  ) {
    throw new OperationError(
      commandId,
      "Rich text layout provider returned inconsistent identity",
      "engine-failure",
      { path, retryable: true },
    );
  }
  node.size = structuredClone(result.size);
  for (const warning of result.warnings) {
    context.warnings.push({
      nodeId: node.id,
      feature: `text-layout.${warning.code}`,
      fallback: warning.fallback,
      message: warning.message,
    });
  }
}

function runtimeTextRunStyle(style: TextRunStyle): RuntimeTextRunStyle {
  return { ...style, fill: structuredClone(style.fills) };
}

function targetChildren(
  document: DesignDocument,
  pageId: string,
  parentId: string | null,
  commandId: string,
): string[] {
  if (parentId === null) {
    return assertPage(document, pageId, commandId).rootNodeIds;
  }
  const parent = document.nodesById[parentId];
  if (!parent) throw notFound(commandId, parentId);
  if (
    parent.kind !== "frame" &&
    parent.kind !== "slot" &&
    parent.kind !== "group" &&
    parent.kind !== "boolean" &&
    parent.kind !== "instance"
  ) {
    throw new OperationError(
      commandId,
      `${parent.kind} nodes cannot contain children`,
    );
  }
  const location = locateNode(document, parentId);
  if (!location || location.pageId !== pageId) {
    throw new OperationError(
      commandId,
      `Parent ${parentId} is not on ${pageId}`,
    );
  }
  return parent.childIds;
}

function assertPage(
  document: DesignDocument,
  pageId: string,
  commandId: string,
) {
  const page = document.pagesById[pageId];
  if (!page) {
    throw new OperationError(
      commandId,
      `Page ${pageId} does not exist`,
      "not-found",
    );
  }
  return page;
}

function assertIndex(
  children: readonly string[],
  index: number,
  commandId: string,
): void {
  if (index > children.length) {
    throw new OperationError(
      commandId,
      `Index ${index} exceeds child count ${children.length}`,
    );
  }
}

function locateNode(document: DesignDocument, nodeId: string) {
  const visit = (
    pageId: string,
    parentId: string | null,
    childIds: readonly string[],
  ): { pageId: string; parentId: string | null; index: number } | undefined => {
    const index = childIds.indexOf(nodeId);
    if (index >= 0) return { pageId, parentId, index };
    for (const childId of childIds) {
      const child = document.nodesById[childId];
      if (!child) continue;
      const found = visit(pageId, childId, child.childIds);
      if (found) return found;
    }
    return undefined;
  };
  for (const pageId of document.pageOrder) {
    const page = document.pagesById[pageId];
    if (!page) continue;
    const found = visit(pageId, null, page.rootNodeIds);
    if (found) return found;
  }
  return undefined;
}

function collectSubtreeIds(
  document: DesignDocument,
  rootNodeId: string,
): string[] {
  const ids: string[] = [];
  const visit = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    ids.push(nodeId);
    for (const childId of node.childIds) visit(childId);
  };
  visit(rootNodeId);
  return ids;
}

function assertComponentSourcesRemain(
  document: DesignDocument,
  removedNodeIds: ReadonlySet<string>,
  commandId: string,
): void {
  if (removedNodeIds.size === 0) return;
  for (const component of Object.values(document.componentsById)) {
    if (!removedNodeIds.has(component.rootNodeId)) continue;
    throw new OperationError(
      commandId,
      `Component ${component.id} must be deleted or detached from its instances before removing main ${component.rootNodeId}`,
      "invalid",
      { path: `/componentsById/${escapeJsonPointer(component.id)}/rootNodeId` },
    );
  }
}

function diffDocuments(
  before: DesignDocument,
  after: DesignDocument,
  toRevision: number,
): DesignChangeSet {
  const changes: DesignChangeSet["changes"] = [];
  const addedNodeIds: string[] = [];
  const changedNodeIds: string[] = [];
  const removedNodeIds: string[] = [];
  const addedAssetIds: string[] = [];
  const changedAssetIds: string[] = [];
  const removedAssetIds: string[] = [];
  const addedPageIds: string[] = [];
  const changedPageIds: string[] = [];
  const removedPageIds: string[] = [];
  const pageChanges: NonNullable<DesignChangeSet["pageChanges"]> = [];
  const addedComponentIds: string[] = [];
  const changedComponentIds: string[] = [];
  const removedComponentIds: string[] = [];
  const componentChanges: NonNullable<DesignChangeSet["componentChanges"]> = [];
  const addedLibraryComponentIds: string[] = [];
  const changedLibraryComponentIds: string[] = [];
  const removedLibraryComponentIds: string[] = [];
  const libraryComponentChanges: NonNullable<
    DesignChangeSet["libraryComponentChanges"]
  > = [];
  const addedLibraryVariantSetIds: string[] = [];
  const changedLibraryVariantSetIds: string[] = [];
  const removedLibraryVariantSetIds: string[] = [];
  const libraryVariantSetChanges: NonNullable<
    DesignChangeSet["libraryVariantSetChanges"]
  > = [];
  const addedLibraryStyleIds: string[] = [];
  const changedLibraryStyleIds: string[] = [];
  const removedLibraryStyleIds: string[] = [];
  const libraryStyleChanges: NonNullable<
    DesignChangeSet["libraryStyleChanges"]
  > = [];
  const ids = new Set([
    ...Object.keys(before.nodesById),
    ...Object.keys(after.nodesById),
  ]);

  for (const nodeId of ids) {
    const oldNode = before.nodesById[nodeId];
    const newNode = after.nodesById[nodeId];
    if (!oldNode && newNode) {
      addedNodeIds.push(nodeId);
      changes.push({
        type: "added",
        nodeId,
        after: newNode,
        changedFields: ["node"],
      });
      continue;
    }
    if (oldNode && !newNode) {
      removedNodeIds.push(nodeId);
      changes.push({
        type: "removed",
        nodeId,
        before: oldNode,
        changedFields: ["node"],
      });
      continue;
    }
    if (!oldNode || !newNode) continue;
    if (JSON.stringify(oldNode) === JSON.stringify(newNode)) {
      if (siblingIndexChanged(before, after, nodeId)) {
        changedNodeIds.push(nodeId);
        changes.push({
          type: "moved",
          nodeId,
          before: oldNode,
          after: newNode,
          changedFields: ["zOrder"],
        });
      }
      continue;
    }
    changedNodeIds.push(nodeId);
    const changedFields = nodeChangedFields(oldNode, newNode);
    changes.push({
      type:
        changedFields.includes("parentId") ||
        siblingIndexChanged(before, after, nodeId)
          ? "moved"
          : "updated",
      nodeId,
      before: oldNode,
      after: newNode,
      changedFields,
    });
  }

  const assetIds = new Set([
    ...Object.keys(before.assetsById),
    ...Object.keys(after.assetsById),
  ]);
  for (const assetId of assetIds) {
    const oldAsset = before.assetsById[assetId];
    const newAsset = after.assetsById[assetId];
    if (!oldAsset && newAsset) addedAssetIds.push(assetId);
    else if (oldAsset && !newAsset) removedAssetIds.push(assetId);
    else if (JSON.stringify(oldAsset) !== JSON.stringify(newAsset)) {
      changedAssetIds.push(assetId);
    }
  }

  const pageIds = new Set([
    ...Object.keys(before.pagesById),
    ...Object.keys(after.pagesById),
  ]);
  for (const pageId of pageIds) {
    const oldPage = before.pagesById[pageId];
    const newPage = after.pagesById[pageId];
    if (!oldPage && newPage) {
      addedPageIds.push(pageId);
      pageChanges.push({
        type: "added",
        pageId,
        after: newPage,
        changedFields: ["page"],
      });
      continue;
    }
    if (oldPage && !newPage) {
      removedPageIds.push(pageId);
      pageChanges.push({
        type: "removed",
        pageId,
        before: oldPage,
        changedFields: ["page"],
      });
      continue;
    }
    if (!oldPage || !newPage) continue;
    const changedFields = pageChangedFields(oldPage, newPage);
    const moved = pageIndexChanged(before, after, pageId);
    if (changedFields.length === 0 && !moved) continue;
    changedPageIds.push(pageId);
    pageChanges.push({
      type: moved ? "moved" : "updated",
      pageId,
      before: oldPage,
      after: newPage,
      changedFields: moved
        ? [...new Set([...changedFields, "pageOrder"])]
        : changedFields,
    });
  }

  const componentIds = new Set([
    ...Object.keys(before.componentsById),
    ...Object.keys(after.componentsById),
  ]);
  for (const componentId of componentIds) {
    const oldComponent = before.componentsById[componentId];
    const newComponent = after.componentsById[componentId];
    if (!oldComponent && newComponent) {
      addedComponentIds.push(componentId);
      componentChanges.push({
        type: "added",
        componentId,
        after: newComponent,
        changedFields: ["component"],
      });
      continue;
    }
    if (oldComponent && !newComponent) {
      removedComponentIds.push(componentId);
      componentChanges.push({
        type: "removed",
        componentId,
        before: oldComponent,
        changedFields: ["component"],
      });
      continue;
    }
    if (!oldComponent || !newComponent) continue;
    const changedFields = [
      "name",
      "rootNodeId",
      "description",
      "componentPropertyOrder",
      "componentPropertyDefinitions",
      "variantSetId",
      "variantProperties",
      "extensions",
    ].filter(
      (field) =>
        JSON.stringify(oldComponent[field as keyof typeof oldComponent]) !==
        JSON.stringify(newComponent[field as keyof typeof newComponent]),
    );
    if (changedFields.length === 0) continue;
    changedComponentIds.push(componentId);
    componentChanges.push({
      type: "updated",
      componentId,
      before: oldComponent,
      after: newComponent,
      changedFields,
    });
  }

  diffLibrarySources(
    before.libraryComponentsById,
    after.libraryComponentsById,
    "componentId",
    [
      "source",
      "component",
      "nodesById",
      "assetsById",
      "dependencyComponentIds",
    ],
    addedLibraryComponentIds,
    changedLibraryComponentIds,
    removedLibraryComponentIds,
    libraryComponentChanges,
  );
  diffLibrarySources(
    before.libraryVariantSetsById,
    after.libraryVariantSetsById,
    "variantSetId",
    ["source", "variantSet"],
    addedLibraryVariantSetIds,
    changedLibraryVariantSetIds,
    removedLibraryVariantSetIds,
    libraryVariantSetChanges,
  );
  diffLibrarySources(
    before.libraryStylesById,
    after.libraryStylesById,
    "styleId",
    ["source", "style"],
    addedLibraryStyleIds,
    changedLibraryStyleIds,
    removedLibraryStyleIds,
    libraryStyleChanges,
  );

  return deepFreeze({
    documentId: before.documentId,
    fromRevision: before.revision,
    toRevision,
    addedNodeIds,
    changedNodeIds,
    removedNodeIds,
    addedAssetIds,
    changedAssetIds,
    removedAssetIds,
    addedPageIds,
    changedPageIds,
    removedPageIds,
    pageChanges,
    addedComponentIds,
    changedComponentIds,
    removedComponentIds,
    componentChanges,
    addedLibraryComponentIds,
    changedLibraryComponentIds,
    removedLibraryComponentIds,
    libraryComponentChanges,
    addedLibraryVariantSetIds,
    changedLibraryVariantSetIds,
    removedLibraryVariantSetIds,
    libraryVariantSetChanges,
    addedLibraryStyleIds,
    changedLibraryStyleIds,
    removedLibraryStyleIds,
    libraryStyleChanges,
    ...diffVariantSets(before, after),
    ...diffDesignSystems(before, after),
    changes,
  });
}

function diffLibrarySources<
  Source extends object,
  IdField extends "componentId" | "variantSetId" | "styleId",
  Change extends {
    type: "added" | "updated" | "removed";
    changedFields: string[];
  } & Record<IdField, string>,
>(
  before: Record<string, Source>,
  after: Record<string, Source>,
  idField: IdField,
  fields: readonly string[],
  addedIds: string[],
  changedIds: string[],
  removedIds: string[],
  changes: Change[],
): void {
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    const previous = before[id];
    const next = after[id];
    if (!previous && next) {
      addedIds.push(id);
      changes.push({
        type: "added",
        [idField]: id,
        after: next,
        changedFields: ["source"],
      } as unknown as Change);
      continue;
    }
    if (previous && !next) {
      removedIds.push(id);
      changes.push({
        type: "removed",
        [idField]: id,
        before: previous,
        changedFields: ["source"],
      } as unknown as Change);
      continue;
    }
    if (
      !previous ||
      !next ||
      JSON.stringify(previous) === JSON.stringify(next)
    ) {
      continue;
    }
    changedIds.push(id);
    changes.push({
      type: "updated",
      [idField]: id,
      before: previous,
      after: next,
      changedFields: fields.filter(
        (field) =>
          JSON.stringify(previous[field as keyof Source]) !==
          JSON.stringify(next[field as keyof Source]),
      ),
    } as unknown as Change);
  }
}

function pageIndexChanged(
  before: DesignDocument,
  after: DesignDocument,
  pageId: string,
): boolean {
  return before.pageOrder.indexOf(pageId) !== after.pageOrder.indexOf(pageId);
}

function pageChangedFields(
  before: DesignDocument["pagesById"][string],
  after: DesignDocument["pagesById"][string],
): string[] {
  const fields = [
    "name",
    "rootNodeIds",
    "explicitVariableModes",
    "extensions",
  ] as const;
  return fields.filter(
    (field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]),
  );
}

function nodeAssetIds(node: DesignNode): string[] {
  const ids: string[] = [];
  if (node.kind === "image") ids.push(node.properties.assetId);
  if (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  ) {
    for (const paint of [
      ...node.properties.fills,
      ...node.properties.strokes,
    ]) {
      if (paint.type === "image") ids.push(paint.assetId);
    }
  }
  return ids;
}

function assertBooleanOperandUpdateAllowed(
  document: DesignDocument,
  node: DesignNode,
  command: Extract<DesignOperation, { type: "update_properties" }>,
): void {
  const parent = node.parentId ? document.nodesById[node.parentId] : undefined;
  if (parent?.kind !== "boolean") return;
  if (
    command.opacity !== undefined ||
    command.blendMode !== undefined ||
    command.effects !== undefined ||
    command.maskMode !== undefined
  ) {
    throw new OperationError(
      command.commandId,
      "Boolean operand appearance is controlled by its Boolean parent",
    );
  }
  const properties = command.properties;
  if (!properties) return;
  const appearanceFields = [
    "fills",
    "strokes",
    "strokeWidth",
    "strokeAlign",
    "strokeCap",
    "strokeJoin",
    "dashPattern",
  ];
  if (appearanceFields.some((field) => Object.hasOwn(properties, field))) {
    throw new OperationError(
      command.commandId,
      "Boolean operand fill and stroke are controlled by its Boolean parent",
    );
  }
}

function siblingIndexChanged(
  before: DesignDocument,
  after: DesignDocument,
  nodeId: string,
): boolean {
  const oldLocation = locateNode(before, nodeId);
  const newLocation = locateNode(after, nodeId);
  return (
    oldLocation?.pageId !== newLocation?.pageId ||
    oldLocation?.index !== newLocation?.index
  );
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

function withRevision(
  document: DesignDocument,
  revision: number,
): DesignDocument {
  const clone = structuredClone(document);
  clone.revision = revision;
  return normalizeDesignDocument(clone);
}

function operationError(error: unknown): DesignError {
  if (error instanceof OperationError) {
    return {
      code: error.code,
      message: error.message,
      commandId: error.commandId,
      ...(error.path === undefined ? {} : { path: error.path }),
      retryable: error.retryable,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (error instanceof DocumentValidationError) {
    return {
      code: "invalid",
      message: "Transaction would violate document invariants",
      retryable: false,
      details: error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
    };
  }
  return {
    code: "engine-failure",
    message: error instanceof Error ? error.message : "Unknown runtime failure",
    retryable: false,
  };
}

function escapeJsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function notFound(commandId: string, nodeId: string): OperationError {
  return new OperationError(
    commandId,
    `Node ${nodeId} does not exist`,
    "not-found",
  );
}

function validateViewport(value: ViewportState): ViewportState {
  const issues = schemaValidationIssues(ViewportStateSchema, value);
  if (issues.length > 0) {
    throw new Error(
      `Invalid viewport: ${issues[0]?.message ?? "unknown error"}`,
    );
  }
  return deepFreeze(value);
}

function transactionEnvelope(
  value: unknown,
  document: DesignDocument,
): {
  transactionId: string;
  documentId: string;
  baseRevision: number;
} {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return {
    transactionId:
      typeof record.transactionId === "string" &&
      record.transactionId.length > 0
        ? record.transactionId
        : "invalid_transaction",
    documentId:
      typeof record.documentId === "string" && record.documentId.length > 0
        ? record.documentId
        : document.documentId,
    baseRevision:
      typeof record.baseRevision === "number" &&
      Number.isInteger(record.baseRevision) &&
      record.baseRevision >= 0
        ? record.baseRevision
        : document.revision,
  };
}

function arraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function validComponentSelectionTarget(
  document: DesignDocument,
  selectedNodeIds: readonly string[],
  target: ComponentSelectionTarget | undefined,
): ComponentSelectionTarget | undefined {
  if (!target || !selectedNodeIds.includes(target.instanceId)) return undefined;
  const instance = document.nodesById[target.instanceId];
  if (instance?.kind !== "instance") return undefined;
  const resolution = resolveComponentInstance(document, instance.id);
  if (!resolution.ok) return undefined;
  const key = componentSourcePathKey(target.sourcePath);
  const resolved = resolution.nodes.find(
    (candidate) =>
      !candidate.root &&
      candidate.editableNodeId === undefined &&
      candidate.selectionInstanceId === instance.id &&
      componentSourcePathKey(candidate.selectionSourcePath) === key,
  );
  return resolved
    ? deepFreeze({
        instanceId: instance.id,
        sourcePath: [...resolved.selectionSourcePath],
      })
    : undefined;
}

function sameComponentSelectionTarget(
  left: ComponentSelectionTarget | undefined,
  right: ComponentSelectionTarget | undefined,
): boolean {
  return (
    left?.instanceId === right?.instanceId &&
    arraysEqual(left?.sourcePath ?? [], right?.sourcePath ?? [])
  );
}

export { diffDocuments };
