import {
  componentSourcePathKey,
  resolveComponentInstance,
} from "@opendesign/component-service";
import {
  DesignTransactionContract,
  ViewportStateSchema,
  schemaValidationIssues,
  type DesignActor,
  type DesignChangeSet,
  type ComponentSelectionTarget,
  type DesignDocument,
  type DesignError,
  type DesignTransaction,
  type DesignTransactionFailure,
  type DesignTransactionResult,
  type DesignTransactionSuccess,
  type EditorEvent,
  type EditorState,
  type FidelityWarning,
  type Revision,
  type SelectionState,
  type ViewportState,
} from "@opendesign/design-contracts";
import {
  type TextFontAvailabilityResult,
  type TextFontDescriptor,
  type TextLayoutProvider,
  type TextRunLayoutProvider,
} from "@opendesign/text-service";
import {
  canonicalJsonStringify,
  deepFreeze,
  documentContentFingerprint,
  DocumentValidationError,
  normalizeDesignDocument,
} from "./document.js";
import { resolveAutoLayoutUntilStable } from "./auto-layout-operations.js";
import { OperationError } from "./operation-error.js";
import { diffDocuments } from "./document-diff.js";
import { EditorHistory, type EditorApplyOptions } from "./editor-history.js";
import { escapeJsonPointer } from "./command-document.js";
import { applyCommand } from "./command-executor.js";
import {
  inspectTextFontAvailability,
  resolveTextAutoSize,
  resolveTextFirstBaseline,
  type RuntimeTextRunStyle,
  type TextCommandContext,
} from "./text-command-executor.js";

export interface EditorSnapshot {
  document: DesignDocument;
  state: EditorState;
}

export type EditorProjectedPreview =
  | {
      ok: true;
      result: DesignTransactionSuccess;
      document: DesignDocument;
    }
  | { ok: false; result: DesignTransactionFailure };

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

interface StoredTransaction {
  fingerprint: string;
  result: DesignTransactionSuccess;
}

interface QueuedEditorEvent {
  event: EditorEvent;
  snapshot: EditorSnapshot;
}

type RuntimeDesignErrorInput = Omit<DesignError, "issues"> & {
  issues?: DesignError["issues"];
};

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
    return inspectTextFontAvailability(this.#textLayoutProvider, descriptor);
  }

  subscribe(listener: EditorRuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  preview(transaction: unknown): DesignTransactionResult {
    return this.previewProjectedDocument(transaction).result;
  }

  /**
   * Projects a transaction through the exact Runtime command, text, and
   * Auto Layout pipeline without mutating document, history, selection, or
   * revision state. Multi-intent planners use the projected document as the
   * authoritative input for their next dependent planning step.
   */
  previewProjectedDocument(transaction: unknown): EditorProjectedPreview {
    const parsed = this.#parseTransaction(transaction, "preview");
    if (!parsed.ok) return { ok: false, result: parsed.result };
    const typedTransaction = parsed.value;
    const validation = this.#validateTransactionTarget(
      typedTransaction,
      "preview",
    );
    if (validation) return { ok: false, result: validation };
    const executed = this.#execute(typedTransaction);
    if (!executed.ok) {
      return {
        ok: false,
        result: this.#failure(typedTransaction, "preview", executed.error),
      };
    }
    return {
      ok: true,
      result: this.#success(
        typedTransaction,
        "preview",
        executed.document,
        executed.changes,
        executed.warnings,
      ),
      document: executed.document,
    };
  }

  apply(
    transaction: unknown,
    options: EditorApplyOptions = {},
  ): DesignTransactionResult {
    const parsed = this.#parseTransaction(transaction, "apply");
    if (!parsed.ok) return parsed.result;
    const typedTransaction = parsed.value;
    const stored = this.#transactions.get(typedTransaction.transactionId);
    if (stored) {
      if (stored.fingerprint === canonicalJsonStringify(typedTransaction)) {
        return stored.result;
      }
      return this.#failure(typedTransaction, "apply", {
        code: "duplicate",
        message: `Transaction ${typedTransaction.transactionId} was already used with different content`,
        retryable: false,
      });
    }

    const validation = this.#validateTransactionTarget(
      typedTransaction,
      "apply",
    );
    if (validation) return validation;
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

  #parseTransaction(
    transaction: unknown,
    mode: "preview" | "apply",
  ):
    | { ok: true; value: DesignTransaction }
    | { ok: false; result: DesignTransactionFailure } {
    const fallback = transactionEnvelope(transaction, this.#document);
    const parsed = DesignTransactionContract.parse(transaction);
    if (!parsed.ok) {
      return {
        ok: false,
        result: deepFreeze({
          ok: false,
          mode,
          ...fallback,
          revision: this.#revision,
          error: {
            code: "invalid",
            message: "Transaction does not match the design contract",
            retryable: false,
            issues: parsed.issues.map(
              ({ code, path, message, expected, actual, recovery }) => ({
                code,
                path,
                message,
                ...(expected === undefined ? {} : { expected }),
                ...(actual === undefined ? {} : { actual }),
                ...(recovery === undefined ? {} : { recovery }),
              }),
            ),
          },
        }),
      };
    }
    return { ok: true, value: parsed.value };
  }

  #validateTransactionTarget(
    transaction: DesignTransaction,
    mode: "preview" | "apply",
  ): DesignTransactionFailure | null {
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
        context: {
          expectedRevision: transaction.baseRevision,
          currentRevision: this.#document.revision,
        },
      });
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
    const context: TextCommandContext = {
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
        applyCommand(draft, command, context);
      const autoLayoutCommandId =
        transaction.commands.at(-1)?.commandId ?? "auto_layout";
      const autoLayout = resolveAutoLayoutUntilStable(
        draft,
        (node) => resolveTextAutoSize(node, autoLayoutCommandId, context),
        (node, size) =>
          resolveTextFirstBaseline(node, autoLayoutCommandId, context, size),
      );
      if (!autoLayout.ok) {
        throw new OperationError(
          transaction.commands.at(-1)?.commandId ?? "auto_layout",
          "design.auto_layout.resolution_failed",
          autoLayout.message,
          "invalid",
          {
            path: `/nodesById/${escapeJsonPointer(autoLayout.frameId)}/properties/autoLayout`,
            context: {
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
    error: RuntimeDesignErrorInput,
  ): DesignTransactionFailure {
    const issues = error.issues ?? [
      {
        code: `design.runtime.${error.code}`,
        path: "",
        message: error.message,
        ...(error.context === undefined ? {} : { details: error.context }),
      },
    ];
    return deepFreeze({
      ok: false,
      mode,
      transactionId: transaction.transactionId,
      documentId: transaction.documentId,
      baseRevision: transaction.baseRevision,
      revision: this.#revision,
      error: { ...error, issues },
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
        issues: [
          {
            code: "design.history_invalid",
            path: "",
            message,
            context: { actorId },
          },
        ],
        context: { actorId },
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
      retryable: error.retryable,
      issues: [...error.issues],
      ...(error.context === undefined ? {} : { context: error.context }),
    };
  }
  if (error instanceof DocumentValidationError) {
    return {
      code: "invalid",
      message: "Transaction would violate document invariants",
      retryable: false,
      issues: error.issues.map((issue) => ({
        code: issue.code ?? "design.document_invariant_invalid",
        path: issue.path,
        message: issue.message,
        ...(issue.expected === undefined ? {} : { expected: issue.expected }),
        ...(issue.actual === undefined ? {} : { actual: issue.actual }),
        ...(issue.recovery === undefined ? {} : { recovery: issue.recovery }),
      })),
    };
  }
  return {
    code: "engine-failure",
    message: error instanceof Error ? error.message : "Unknown runtime failure",
    retryable: false,
    issues: [
      {
        code: "design.engine_failure",
        path: "",
        message:
          error instanceof Error ? error.message : "Unknown runtime failure",
      },
    ],
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
