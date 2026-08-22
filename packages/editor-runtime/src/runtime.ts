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
import { resolveAutoLayoutUntilStable } from "./auto-layout-operations.js";
import {
  normalizeTextResizeProperties,
  textLayoutAffected,
} from "./text-layout-operations.js";
import { isEffectivelyLocked } from "./layer-operations.js";
import { synchronizeComponentPropertyDefaults } from "./component-property-defaults.js";
import { applySlotStretchOnInsert } from "./component-slot-operations.js";
import { OperationError } from "./operation-error.js";
import { detachStyleReferencesForUpdate } from "./style-runtime.js";
import { applyDesignSystemOperation } from "./design-system-runtime.js";
import { deleteVariantSet, putVariantSet } from "./variant-set-runtime.js";
import {
  commitTextEditingSession,
  normalizeTextNodeRuns,
  prepareTextPropertiesUpdate,
  textRunBaseStyle,
  updateTextRangeStyle,
} from "./rich-text-operations.js";
import { styleDefinition } from "@opendesign/style-service";
import { diffDocuments } from "./document-diff.js";
import { EditorHistory, type EditorApplyOptions } from "./editor-history.js";
import {
  assertComponentSourcesRemain,
  assertIndex,
  assertPage,
  collectSubtreeIds,
  escapeJsonPointer,
  locateNode,
  nodeNotFound as notFound,
  targetChildren,
} from "./command-document.js";
import { applyPageCommand } from "./page-command-executor.js";
import { applyAssetCommand } from "./asset-command-executor.js";
import { applyComponentSourceCommand } from "./component-source-command-executor.js";

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
  #history = new EditorHistory();
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
    const historyRejection = this.#history.validateApply(options);
    if (historyRejection) {
      return this.#failure(typedTransaction, "apply", historyRejection);
    }
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
    this.#history.recordApply({
      before,
      after: this.#document,
      transaction: typedTransaction,
      result,
      options,
    });
    this.#transactions.set(typedTransaction.transactionId, {
      fingerprint: canonicalJsonStringify(typedTransaction),
      result,
    });
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  rollbackHistoryGroup(
    historyGroupId: string,
    actorId = "opendesign-agent",
  ): DesignTransactionResult {
    const step = this.#history.rollbackGroup(historyGroupId);
    if (!step.ok) return this.#historyFailure("undo", actorId, step.message);
    const { record } = step;
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
    const step = this.#history.undo();
    if (!step.ok) return this.#historyFailure("undo", actorId, step.message);
    const { record } = step;
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
    const selectionChanged = this.#commitDocument(document, revision);
    this.#afterDocumentChange(result, selectionChanged);
    return result;
  }

  redo(actorId = "local-user"): DesignTransactionResult {
    const step = this.#history.redo();
    if (!step.ok) return this.#historyFailure("redo", actorId, step.message);
    const { record } = step;
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
    this.#emit({ type: "history.changed", history: this.#history.state() });
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
        history: this.#history.state(),
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
    case "put_variant_set":
      putVariantSet(document, command);
      return;
    case "delete_variant_set":
      deleteVariantSet(document, command);
      return;
    default:
      if (applyAssetCommand(document, command)) return;
      if (applyComponentSourceCommand(document, command)) return;
      if (applyPageCommand(document, command)) return;
      if (applyDesignSystemOperation(document, command)) return;
  }
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
