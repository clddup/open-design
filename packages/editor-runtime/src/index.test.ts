import type {
  DesignTransaction,
  PathNode,
  RectangleNode,
  VectorNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DocumentValidationError,
  EditorRuntime,
  canonicalJsonStringify,
  createWelcomeDocument,
  documentContentFingerprint,
  documentToScreen,
  getWorldTransform,
  normalizeDesignDocument,
  screenToDocument,
} from "./index.js";

function rectangle(id: string, parentId: string | null = null): RectangleNode {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 16, 20],
    size: { width: 100, height: 80 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#ff0000", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function pathNode(id: string, parentId: string | null = null): PathNode {
  return {
    id,
    kind: "path",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 24, 32],
    size: { width: 160, height: 220 },
    exportSettings: [],
    opacity: 1,
    properties: {
      path: "M 80 4 C 126 4 154 46 148 108 C 143 171 118 214 80 216 C 42 214 17 171 12 108 C 6 46 34 4 80 4 Z",
      fillRule: "nonzero",
      fills: [{ type: "solid", color: "#111827", opacity: 1 }],
      strokes: [{ type: "solid", color: "#ffffff", opacity: 0.8 }],
      strokeWidth: 3,
      strokeAlign: "inside",
      strokeJoin: "round",
    },
    extensions: {},
  };
}

function editableVectorNode(
  id: string,
  parentId: string | null = null,
): VectorNode {
  return {
    id,
    kind: "vector",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 24, 32],
    size: { width: 160, height: 220 },
    exportSettings: [],
    opacity: 1,
    properties: {
      network: {
        vertices: [
          { id: "vertex_a", x: 0, y: 0 },
          { id: "vertex_b", x: 160, y: 0 },
          { id: "vertex_c", x: 80, y: 220 },
        ],
        segments: [
          {
            id: "segment_ab",
            startVertexId: "vertex_a",
            endVertexId: "vertex_b",
          },
          {
            id: "segment_bc",
            startVertexId: "vertex_b",
            endVertexId: "vertex_c",
            tangentStart: { x: 0, y: 60 },
            tangentEnd: { x: 40, y: -40 },
          },
          {
            id: "segment_ca",
            startVertexId: "vertex_c",
            endVertexId: "vertex_a",
          },
        ],
        paths: [
          {
            id: "path_outer",
            closed: true,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
              { segmentId: "segment_ca", reversed: false },
            ],
          },
        ],
        regions: [
          {
            id: "region_outer",
            windingRule: "nonzero",
            loops: [{ pathId: "path_outer", reversed: false }],
          },
        ],
      },
      fillRule: "nonzero",
      fills: [{ type: "solid", color: "#111827", opacity: 1 }],
      strokes: [{ type: "solid", color: "#ffffff", opacity: 0.8 }],
      strokeWidth: 3,
      strokeAlign: "inside",
      strokeJoin: "round",
    },
    extensions: {},
  };
}

function transaction(
  runtime: EditorRuntime,
  transactionId: string,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const snapshot = runtime.getSnapshot();
  return {
    transactionId,
    documentId: snapshot.document.documentId,
    baseRevision: snapshot.document.revision,
    actor: { type: "user", id: "user_1" },
    label: transactionId,
    commands,
  };
}

describe("document normalization", () => {
  it("rejects invalid parent and reachability invariants", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.title_welcome!.parentId = null;
    expect(() => normalizeDesignDocument(document)).toThrow(
      DocumentValidationError,
    );
  });

  it("rejects cyclic extension values without leaking validation errors", () => {
    const document = structuredClone(createWelcomeDocument()) as unknown as {
      extensions: Record<string, unknown>;
    };
    document.extensions.self = document.extensions;

    expect(() => normalizeDesignDocument(document)).toThrow(
      DocumentValidationError,
    );
  });

  it("preserves structured document-contract issues", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.title_welcome!.layoutLimits = {
      minWidth: 480,
      maxWidth: 120,
    };

    try {
      normalizeDesignDocument(document);
      throw new Error("Expected document normalization to fail");
    } catch (error) {
      if (!(error instanceof DocumentValidationError)) throw error;
      expect(error.issues).toContainEqual(
        expect.objectContaining({
          code: "design.document_layout_limits_invalid",
          path: "/nodesById/title_welcome/layoutLimits",
        }),
      );
    }
  });

  it("rejects inherited map keys and mismatched asset identities", () => {
    const inheritedPage = structuredClone(createWelcomeDocument());
    inheritedPage.pageOrder = ["toString"];
    inheritedPage.pagesById = {};
    expect(() => normalizeDesignDocument(inheritedPage)).toThrow(
      DocumentValidationError,
    );

    const mismatchedAsset = structuredClone(createWelcomeDocument());
    mismatchedAsset.assetsById.asset_map_key = {
      id: "asset_internal_id",
      kind: "image",
      name: "Preview",
      mimeType: "image/png",
      source: { type: "data", value: "" },
      extensions: {},
    };
    expect(() => normalizeDesignDocument(mismatchedAsset)).toThrow(
      DocumentValidationError,
    );
  });

  it("rejects editable vector topology that passes the structural schema", () => {
    const document = structuredClone(createWelcomeDocument());
    const vector = editableVectorNode("vector_invalid", "frame_welcome");
    if (!("network" in vector.properties)) {
      throw new Error("Expected editable vector properties");
    }
    vector.properties.network.paths[0]!.segments = [
      { segmentId: "segment_ab", reversed: false },
      { segmentId: "segment_ca", reversed: false },
      { segmentId: "segment_bc", reversed: false },
    ];
    document.nodesById.vector_invalid = vector;
    document.nodesById.frame_welcome!.childIds.push(vector.id);

    expect(() => normalizeDesignDocument(document)).toThrow(
      DocumentValidationError,
    );
    try {
      normalizeDesignDocument(document);
    } catch (error) {
      if (!(error instanceof DocumentValidationError)) throw error;
      expect(
        error.issues.some(
          (issue) =>
            issue.path.includes(
              "/nodesById/vector_invalid/properties/network/paths/0/segments",
            ) && issue.message.includes("not contiguous"),
        ),
      ).toBe(true);
    }
  });

  it("canonicalizes JSON object keys for document fingerprints", () => {
    const left = structuredClone(createWelcomeDocument());
    const right = structuredClone(createWelcomeDocument());
    left.extensions = { first: 1, second: { alpha: true, beta: false } };
    right.extensions = { second: { beta: false, alpha: true }, first: 1 };

    expect(canonicalJsonStringify(left.extensions)).toBe(
      canonicalJsonStringify(right.extensions),
    );
    expect(documentContentFingerprint(left)).toBe(
      documentContentFingerprint(right),
    );
  });
});

describe("EditorRuntime transactions", () => {
  it("treats oversized element insert and move indices as front-most", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const inserted = runtime.apply(
      transaction(runtime, "transaction_append_element", [
        {
          commandId: "append_element",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 20,
          node: rectangle("appended", "frame_welcome"),
        },
      ]),
    );
    expect(inserted).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds.at(-1),
    ).toBe("appended");

    const moved = runtime.apply(
      transaction(runtime, "transaction_move_to_front", [
        {
          commandId: "move_to_front",
          type: "move_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          nodeId: "title_welcome",
          index: 10,
        },
      ]),
    );
    expect(moved).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds.at(-1),
    ).toBe("title_welcome");
  });

  it("rejects kind-incompatible property patches at the responsible command", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const result = runtime.preview(
      transaction(runtime, "transaction_invalid_group_paint", [
        {
          commandId: "paint_group",
          type: "update_properties",
          nodeId: "feature_group",
          properties: {
            fills: [{ type: "solid", color: "#000000", opacity: 1 }],
          },
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        issues: [
          {
            code: "design.node.schema_invalid",
            commandId: "paint_group",
            path: "/nodesById/feature_group/properties/fills",
            message: "Unexpected property",
          },
        ],
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("previews, persists, undoes, and redoes text wrapping and overflow", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const change = transaction(runtime, "transaction_text_layout", [
      {
        commandId: "update_text_layout",
        type: "update_properties",
        nodeId: "title_welcome",
        properties: {
          textWrap: "none",
          textOverflow: "clip",
          textTruncation: "ending",
        },
      },
    ]);

    expect(runtime.preview(change)).toMatchObject({
      ok: true,
      mode: "preview",
      changes: { changedNodeIds: ["title_welcome"] },
    });
    expect(runtime.apply(change)).toMatchObject({ ok: true, mode: "apply" });
    const applied = runtime.getSnapshot().document.nodesById.title_welcome;
    expect(applied).toMatchObject({
      kind: "text",
      properties: {
        textWrap: "none",
        textOverflow: "clip",
        textTruncation: "ending",
      },
    });

    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.nodesById.title_welcome).toEqual(applied);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        textWrap: "word",
        textOverflow: "clip",
        textTruncation: "disabled",
      },
    });
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        textWrap: "none",
        textOverflow: "clip",
        textTruncation: "ending",
      },
    });
  });

  it("previews, persists, undoes, and redoes formal path nodes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const change = transaction(runtime, "transaction_path", [
      {
        commandId: "insert_path",
        type: "insert_element",
        pageId: "page_welcome",
        parentId: "frame_welcome",
        index: 4,
        node: pathNode("mascot_path", "frame_welcome"),
      },
    ]);

    expect(runtime.preview(change)).toMatchObject({
      ok: true,
      mode: "preview",
      changes: { addedNodeIds: ["mascot_path"] },
    });
    expect(
      runtime.getSnapshot().document.nodesById.mascot_path,
    ).toBeUndefined();
    expect(runtime.apply(change)).toMatchObject({
      ok: true,
      mode: "apply",
      changes: { addedNodeIds: ["mascot_path"] },
    });

    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.nodesById.mascot_path).toEqual(
      runtime.getSnapshot().document.nodesById.mascot_path,
    );
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.mascot_path,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(runtime.getSnapshot().document.nodesById.mascot_path).toMatchObject({
      kind: "path",
      properties: { fillRule: "nonzero", strokeWidth: 3 },
    });
  });

  it("persists, reopens, undoes, and redoes editable vector networks", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const change = transaction(runtime, "transaction_editable_vector", [
      {
        commandId: "insert_editable_vector",
        type: "insert_element",
        pageId: "page_welcome",
        parentId: "frame_welcome",
        index: 4,
        node: editableVectorNode("editable_vector", "frame_welcome"),
      },
    ]);

    expect(runtime.apply(change)).toMatchObject({
      ok: true,
      changes: { addedNodeIds: ["editable_vector"] },
    });
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.nodesById.editable_vector).toEqual(
      runtime.getSnapshot().document.nodesById.editable_vector,
    );
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById.editable_vector).toBe(
      undefined,
    );
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const redone = runtime.getSnapshot().document.nodesById.editable_vector;
    expect(redone).toMatchObject({ kind: "vector" });
    if (
      !redone ||
      redone.kind !== "vector" ||
      !("network" in redone.properties)
    ) {
      throw new Error("Missing redone editable vector");
    }
    expect(redone.properties.network.vertices.map(({ id }) => id)).toContain(
      "vertex_a",
    );
  });

  it("rolls back every command when an atomic apply fails", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot();
    const result = runtime.apply(
      transaction(runtime, "transaction_atomic", [
        {
          commandId: "insert_ok",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: null,
          index: 1,
          node: rectangle("temporary"),
        },
        {
          commandId: "delete_missing",
          type: "delete_element",
          nodeId: "missing",
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "not-found",
        issues: [
          {
            code: "design.node.not_found",
            commandId: "delete_missing",
          },
        ],
      },
    });
    expect(runtime.getSnapshot()).toBe(before);
    expect(runtime.getSnapshot().document.nodesById.temporary).toBeUndefined();
  });

  it("rejects stale revisions and treats duplicate transaction ids idempotently", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const change = transaction(runtime, "transaction_once", [
      {
        commandId: "update_title",
        type: "update_properties",
        nodeId: "title_welcome",
        opacity: 0.8,
      },
    ]);
    const first = runtime.apply(change);
    const duplicate = runtime.apply(change);
    const stale = runtime.apply({
      ...change,
      transactionId: "transaction_stale",
    });

    expect(first.ok).toBe(true);
    expect(duplicate).toBe(first);
    expect(stale).toMatchObject({ ok: false, error: { code: "conflict" } });
    expect(runtime.getSnapshot().document.revision).toBe(1);
  });

  it("returns invalid for cyclic transaction extensions without events", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const events: string[] = [];
    runtime.subscribe((event) => events.push(event.type));
    const extensions: Record<string, unknown> = {};
    extensions.self = extensions;
    const value = {
      ...transaction(runtime, "transaction_cyclic", [
        {
          commandId: "update_title",
          type: "update_properties" as const,
          nodeId: "title_welcome",
          opacity: 0.8,
        },
      ]),
      extensions,
    };

    expect(() => runtime.apply(value)).not.toThrow();
    expect(runtime.apply(value)).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(events).toEqual([]);
  });

  it("treats reordered JSON object keys as an idempotent retry", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const first = {
      ...transaction(runtime, "transaction_canonical", [
        {
          commandId: "update_title",
          type: "update_properties" as const,
          nodeId: "title_welcome",
          extensions: { first: 1, second: 2 },
        },
      ]),
      extensions: { alpha: 1, beta: 2 },
    };
    const retry = {
      transactionId: first.transactionId,
      documentId: first.documentId,
      baseRevision: first.baseRevision,
      actor: { id: first.actor.id, type: first.actor.type },
      label: first.label,
      commands: [
        {
          commandId: "update_title",
          type: "update_properties" as const,
          nodeId: "title_welcome",
          extensions: { second: 2, first: 1 },
        },
      ],
      extensions: { beta: 2, alpha: 1 },
    };

    const result = runtime.apply(first);
    expect(runtime.apply(retry)).toBe(result);
    expect(runtime.getSnapshot().document.revision).toBe(1);
  });

  it("produces equivalent preview and apply changes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const change = transaction(runtime, "transaction_preview", [
      {
        commandId: "move_accent",
        type: "move_element",
        nodeId: "shape_accent",
        pageId: "page_welcome",
        parentId: "frame_welcome",
        index: 3,
      },
    ]);
    const preview = runtime.preview(change);
    expect(runtime.getSnapshot().document.revision).toBe(0);
    const applied = runtime.apply(change);
    expect(preview.ok && applied.ok && preview.changes).toEqual(
      applied.ok ? applied.changes : undefined,
    );
    expect(applied.ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
      "shape_accent",
    ]);
    if (applied.ok) {
      expect(
        applied.changes.changes.some(
          (item) =>
            item.type === "moved" &&
            item.nodeId === "shape_accent" &&
            item.changedFields.includes("zOrder"),
        ),
      ).toBe(true);
    }
  });

  it("groups progressive Agent stages into one undoable history entry", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const groupId = "agent_group_1";
    const first = runtime.apply(
      transaction(runtime, "agent_stage_1", [
        {
          commandId: "rename_title_progressive",
          type: "update_properties",
          nodeId: "title_welcome",
          name: "Progressive title",
        },
      ]),
      { historyGroupId: groupId },
    );
    expect(first.ok).toBe(true);
    const second = runtime.apply(
      transaction(runtime, "agent_stage_2", [
        {
          commandId: "rename_subtitle_progressive",
          type: "update_properties",
          nodeId: "subtitle_welcome",
          name: "Progressive subtitle",
        },
      ]),
      { historyGroupId: groupId, finalizeHistoryGroup: true },
    );
    expect(second.ok).toBe(true);

    const staged = runtime.getSnapshot();
    expect(staged.document.revision).toBe(2);
    expect(staged.state.history.undo).toHaveLength(1);
    expect(staged.state.history.undo[0]?.transactionId).toBe(groupId);
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.title_welcome?.name).toBe(
      "Title",
    );
    expect(
      runtime.getSnapshot().document.nodesById.subtitle_welcome?.name,
    ).toBe("Subtitle");
  });

  it("rolls back an interrupted progressive history group", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const groupId = "agent_group_cancelled";
    const applied = runtime.apply(
      transaction(runtime, "agent_cancelled_stage", [
        {
          commandId: "rename_before_cancel",
          type: "update_properties",
          nodeId: "title_welcome",
          name: "Temporary title",
        },
      ]),
      { historyGroupId: groupId },
    );
    expect(applied.ok).toBe(true);

    expect(runtime.rollbackHistoryGroup(groupId).ok).toBe(true);
    const rolledBack = runtime.getSnapshot();
    expect(rolledBack.document.nodesById.title_welcome?.name).toBe("Title");
    expect(rolledBack.state.history.canUndo).toBe(false);
    expect(rolledBack.state.dirty).toBe(false);
  });

  it("rejects interleaved writes and history navigation while a group is active", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const groupId = "agent_group_active";
    expect(
      runtime.apply(
        transaction(runtime, "agent_active_stage", [
          {
            commandId: "rename_during_progress",
            type: "update_properties",
            nodeId: "title_welcome",
            name: "Visible first stage",
          },
        ]),
        { historyGroupId: groupId },
      ).ok,
    ).toBe(true);

    const interleaved = runtime.apply(
      transaction(runtime, "user_interleaved_change", [
        {
          commandId: "user_rename_during_progress",
          type: "update_properties",
          nodeId: "subtitle_welcome",
          name: "Must not interleave",
        },
      ]),
    );
    expect(interleaved).toMatchObject({
      ok: false,
      error: { code: "conflict", retryable: true },
    });
    expect(runtime.undo()).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });

    expect(runtime.rollbackHistoryGroup(groupId).ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.title_welcome?.name).toBe(
      "Title",
    );
    expect(runtime.getSnapshot().state.history.canUndo).toBe(false);
  });

  it("uses final-position indexes for backward and forward moves", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.apply(
      transaction(runtime, "transaction_move_backward", [
        {
          commandId: "move_feature_group",
          type: "move_element",
          nodeId: "feature_group",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 1,
        },
      ]),
    );
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "feature_group",
      "title_welcome",
      "subtitle_welcome",
    ]);

    runtime.apply(
      transaction(runtime, "transaction_move_forward", [
        {
          commandId: "move_feature_group_again",
          type: "move_element",
          nodeId: "feature_group",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 3,
        },
      ]),
    );
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
    ]);
  });

  it("keeps revisions monotonic through undo and redo and clears redo branches", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (() => {
        let id = 0;
        return (prefix) => `${prefix}_${++id}`;
      })(),
    });
    runtime.apply(
      transaction(runtime, "transaction_edit", [
        {
          commandId: "update_title",
          type: "update_properties",
          nodeId: "title_welcome",
          opacity: 0.5,
        },
      ]),
    );
    const undo = runtime.undo();
    const redo = runtime.redo();

    expect(undo.ok && undo.revision.revision).toBe(2);
    expect(redo.ok && redo.revision.revision).toBe(3);
    expect(runtime.getSnapshot().document.revision).toBe(3);

    runtime.undo();
    runtime.apply(
      transaction(runtime, "transaction_branch", [
        {
          commandId: "update_subtitle",
          type: "update_properties",
          nodeId: "subtitle_welcome",
          visible: false,
        },
      ]),
    );
    expect(runtime.getSnapshot().state.history.canRedo).toBe(false);
    expect(runtime.redo()).toMatchObject({ ok: false });
  });

  it("updates selection, tool, and viewport without changing revision", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot();
    runtime.setSelection(["title_welcome"]);
    runtime.setTool("rectangle");
    runtime.setViewport({ panX: 30, panY: 20, zoom: 2 });

    const after = runtime.getSnapshot();
    expect(after).not.toBe(before);
    expect(after.document).toBe(before.document);
    expect(after.document.revision).toBe(0);
    expect(after.state).toMatchObject({
      selection: { nodeIds: ["title_welcome"] },
      tool: "rectangle",
      viewport: { panX: 30, panY: 20, zoom: 2 },
    });
  });

  it("isolates listener failures from committed transactions and other listeners", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const received: string[] = [];
    runtime.subscribe(() => {
      throw new Error("listener failed");
    });
    runtime.subscribe((event) => received.push(event.type));

    const result = runtime.apply(
      transaction(runtime, "transaction_listener_failure", [
        {
          commandId: "hide_accent",
          type: "update_properties",
          nodeId: "shape_accent",
          visible: false,
        },
      ]),
    );

    expect(result.ok).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(received).toEqual([
      "document.changed",
      "history.changed",
      "dirty.changed",
    ]);
  });

  it("queues reentrant events with their original snapshots", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const firstListener: Array<[string, number, number]> = [];
    const secondListener: Array<[string, number, number]> = [];
    let changedTool = false;
    runtime.subscribe((event, snapshot) => {
      firstListener.push([
        event.type,
        event.sequence,
        snapshot.document.revision,
      ]);
      if (event.type === "document.changed" && !changedTool) {
        changedTool = true;
        runtime.setTool("rectangle");
      }
    });
    runtime.subscribe((event, snapshot) => {
      secondListener.push([
        event.type,
        event.sequence,
        snapshot.document.revision,
      ]);
    });

    runtime.apply(
      transaction(runtime, "transaction_reentrant_event", [
        {
          commandId: "hide_accent",
          type: "update_properties",
          nodeId: "shape_accent",
          visible: false,
        },
      ]),
    );

    expect(firstListener.map(([type]) => type)).toEqual([
      "document.changed",
      "tool.changed",
      "history.changed",
      "dirty.changed",
    ]);
    expect(secondListener).toEqual(firstListener);
    expect(firstListener.map(([, sequence]) => sequence)).toEqual([1, 2, 3, 4]);
    expect(firstListener.map(([, , revision]) => revision)).toEqual([
      1, 1, 1, 1,
    ]);
  });

  it("reports listener failures without allowing diagnostics to disrupt events", () => {
    const reported: Array<[string, string]> = [];
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      onListenerError: (error, event) => {
        reported.push([
          event.type,
          error instanceof Error ? error.message : "unknown",
        ]);
        throw new Error("diagnostic failed");
      },
    });
    const received: string[] = [];
    runtime.subscribe(() => {
      throw new Error("listener failed");
    });
    runtime.subscribe((event) => received.push(event.type));

    runtime.setTool("rectangle");

    expect(received).toEqual(["tool.changed"]);
    expect(reported).toEqual([["tool.changed", "listener failed"]]);
  });

  it("preserves a surviving selection anchor and emits its filtered selection", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const selections: string[][] = [];
    runtime.setSelection(
      ["shape_accent", "title_welcome", "subtitle_welcome"],
      "subtitle_welcome",
    );
    runtime.subscribe((event) => {
      if (event.type === "selection.changed") {
        selections.push([...event.selection.nodeIds]);
      }
    });

    runtime.apply(
      transaction(runtime, "transaction_delete_selected", [
        {
          commandId: "delete_title",
          type: "delete_element",
          nodeId: "title_welcome",
        },
      ]),
    );

    expect(runtime.getSnapshot().state.selection).toEqual({
      nodeIds: ["shape_accent", "subtitle_welcome"],
      anchorNodeId: "subtitle_welcome",
    });
    expect(selections).toEqual([["shape_accent", "subtitle_welcome"]]);
  });

  it("publishes ordered events with stable snapshots and supports unsubscribe", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      now: () => "2026-08-07T00:00:00.000Z",
    });
    const events: string[] = [];
    const revisions: number[] = [];
    const unsubscribe = runtime.subscribe((event, snapshot) => {
      events.push(event.type);
      revisions.push(snapshot.document.revision);
    });
    runtime.setSelection(["title_welcome"]);
    runtime.apply(
      transaction(runtime, "transaction_event", [
        {
          commandId: "hide_accent",
          type: "update_properties",
          nodeId: "shape_accent",
          visible: false,
        },
      ]),
    );
    unsubscribe();
    runtime.setTool("text");

    expect(events).toEqual([
      "selection.changed",
      "document.changed",
      "history.changed",
      "dirty.changed",
    ]);
    expect(revisions).toEqual([0, 1, 1, 1]);
  });

  it("imports image assets and image nodes atomically with undo and reference safety", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const result = runtime.apply(
      transaction(runtime, "transaction_place_image", [
        {
          commandId: "put_image_asset",
          type: "put_asset",
          asset: {
            id: "asset_photo",
            kind: "image",
            name: "Photo",
            mimeType: "image/png",
            source: { type: "data", value: "aW1hZ2U=" },
            size: { width: 640, height: 480 },
            extensions: {},
          },
        },
        {
          commandId: "insert_image_node",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 4,
          node: {
            id: "photo",
            kind: "image",
            name: "Photo",
            parentId: "frame_welcome",
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 400, 260],
            size: { width: 320, height: 240 },
            exportSettings: [],
            opacity: 1,
            properties: {
              assetId: "asset_photo",
              placement: {
                mode: "fill",
                focalPoint: { x: 0.5, y: 0.5 },
              },
              altText: "Photo",
              cornerRadius: 0,
            },
            extensions: {},
          },
        },
      ]),
    );
    expect(result.ok && result.changes.addedAssetIds).toEqual(["asset_photo"]);
    expect(runtime.getSnapshot().document.nodesById.photo?.kind).toBe("image");

    const rejected = runtime.apply(
      transaction(runtime, "transaction_delete_used_asset", [
        {
          commandId: "delete_used_asset",
          type: "delete_asset",
          assetId: "asset_photo",
        },
      ]),
    );
    expect(rejected).toMatchObject({ ok: false, error: { code: "invalid" } });

    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.assetsById.asset_photo,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById.photo).toBeUndefined();
    expect(runtime.redo().ok).toBe(true);
    expect(runtime.getSnapshot().document.assetsById.asset_photo?.kind).toBe(
      "image",
    );
  });

  it.each(["path", "vector"] as const)(
    "prevents deleting an image asset referenced by a %s paint",
    (kind) => {
      const runtime = new EditorRuntime(createWelcomeDocument());
      const imagePaint = {
        type: "image" as const,
        assetId: "asset_path_paint",
        fit: "cover" as const,
        opacity: 1,
      };
      const node =
        kind === "path"
          ? {
              ...pathNode("path_image_paint", "frame_welcome"),
              properties: {
                ...pathNode("template").properties,
                fills: [imagePaint],
              },
            }
          : (() => {
              const vector = editableVectorNode(
                "vector_image_paint",
                "frame_welcome",
              );
              if (!("network" in vector.properties)) {
                throw new Error("Missing editable Vector network");
              }
              vector.properties.network.regions[0]!.fills = [imagePaint];
              return vector;
            })();
      const inserted = runtime.apply(
        transaction(runtime, `transaction_${kind}_image_paint`, [
          {
            commandId: "put_path_paint_asset",
            type: "put_asset",
            asset: {
              id: "asset_path_paint",
              kind: "image",
              name: "Path paint",
              mimeType: "image/png",
              source: { type: "data", value: "aW1hZ2U=" },
              size: { width: 640, height: 480 },
              extensions: {},
            },
          },
          {
            commandId: `insert_${kind}_image_paint`,
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 4,
            node,
          },
        ]),
      );
      expect(inserted.ok).toBe(true);

      const deleted = runtime.apply(
        transaction(runtime, `delete_${kind}_paint_asset`, [
          {
            commandId: "delete_path_paint_asset",
            type: "delete_asset",
            assetId: "asset_path_paint",
          },
        ]),
      );
      expect(deleted).toMatchObject({
        ok: false,
        error: {
          code: "invalid",
          issues: [
            {
              code: "design.asset.in_use_by_node",
              commandId: "delete_path_paint_asset",
            },
          ],
        },
      });
      expect(
        runtime.getSnapshot().document.assetsById.asset_path_paint,
      ).toBeDefined();
    },
  );
});

describe("document geometry", () => {
  it("composes transforms through the full ancestor chain", () => {
    const document = createWelcomeDocument();

    expect(getWorldTransform(document, "feature_one")).toEqual([
      1, 0, 0, 1, 144, 404,
    ]);
  });

  it("round trips document and screen coordinates", () => {
    const viewport = {
      panX: 60,
      panY: -20,
      zoom: 2,
      width: 1200,
      height: 800,
    };
    const screen = documentToScreen({ x: 25, y: 40 }, viewport);
    expect(screen).toEqual({ x: 110, y: 60 });
    expect(screenToDocument(screen, viewport)).toEqual({ x: 25, y: 40 });
  });
});
