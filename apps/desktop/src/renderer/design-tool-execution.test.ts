import {
  createWelcomeDocument,
  EditorRuntime,
  getWorldTransform,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { DESIGN_HIERARCHY_TOOL_NAME } from "../shared/design-agent-tools";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";
import { executeDesignToolRequest } from "./design-tool-execution";

const selectionContext = {
  runId: "run_1",
  sessionId: "conversation_1",
  documentId: "document_welcome",
  revision: 0,
  scope: {
    kind: "selection" as const,
    pageId: "page_welcome",
    selectedNodeIds: ["feature_one"],
    primaryNodeId: "feature_one",
  },
  mutationTarget: { kind: "page" as const, pageId: "page_welcome" },
};

const pageContext = {
  ...selectionContext,
  scope: {
    kind: "page" as const,
    pageId: "page_welcome",
    selectedNodeIds: [],
  },
};

describe("Renderer design tool scope", () => {
  it("refreshes a stale read context but still rejects a stale write", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const applied = runtime.apply({
      transactionId: "transaction_user_1",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      label: "User edit while the Agent is thinking",
      commands: [
        {
          commandId: "rename_feature",
          type: "update_properties",
          nodeId: "feature_one",
          name: "New live state",
        },
      ],
    });
    expect(applied.ok).toBe(true);

    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_refresh",
        call: {
          toolCallId: "tool_inspect_refresh",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );
    expect(inspection.ok).toBe(true);
    if (inspection.ok) expect(inspection.result.observedRevision).toBe(1);

    await expect(
      executeDesignToolRequest(
        {
          requestId: "apply_stale",
          call: {
            toolCallId: "tool_apply_stale",
            toolName: "opendesign_apply_transaction",
            input: {
              label: "Stale write",
              commands: [
                {
                  commandId: "stale_rename",
                  type: "update_properties",
                  nodeId: "feature_one",
                  name: "Should not apply",
                },
              ],
            },
          },
          context: selectionContext,
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");
  });

  it("returns the immutable target page plus the send-time selection context", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "inspect_1",
        call: {
          toolCallId: "tool_1",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const serialized = JSON.stringify(response.result.content);
    expect(serialized).toContain('"feature_one"');
    expect(serialized).toContain('"title_welcome"');
    expect(serialized).toContain('"feature_two"');
    expect(response.result.content).toMatchObject({
      mutationTarget: { kind: "page", pageId: "page_welcome" },
      diagnostics: {
        version: 1,
        pageIds: ["page_welcome"],
        errorCount: 0,
        warningCount: 0,
        features: {
          gradients: 0,
          images: 0,
          paths: 0,
          text: 2,
        },
      },
      selection: {
        nodeIds: ["feature_one"],
        anchorNodeId: "feature_one",
      },
    });
  });

  it("returns a bounded multimodal canvas preview without editing the document", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const attachment = {
      attachmentId: `image_${"a".repeat(64)}`,
      name: "OpenDesign canvas r0.jpg",
      mimeType: "image/jpeg" as const,
      byteSize: 2_048,
    };
    const response = await executeDesignToolRequest(
      {
        requestId: "capture_canvas",
        call: {
          toolCallId: "tool_capture_canvas",
          toolName: "opendesign_capture_canvas",
          input: {},
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
      {
        captureCanvas: () =>
          Promise.resolve({
            attachment,
            height: 768,
            width: 1_024,
          }),
      },
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        observedRevision: 0,
        content: {
          revision: 0,
          width: 1_024,
          height: 768,
          attachment,
          attachments: [attachment],
        },
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("allows a page-targeted write outside the contextual selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const request: RendererDesignToolRequest = {
      requestId: "apply_1",
      call: {
        toolCallId: "tool_1",
        toolName: "opendesign_apply_transaction",
        input: {
          label: "Rename an unrelated node",
          commands: [
            {
              commandId: "rename_title",
              type: "update_properties",
              nodeId: "title_welcome",
              name: "Out of scope",
            },
          ],
        },
      },
      context: selectionContext,
    };

    await expect(
      executeDesignToolRequest(request, runtime, "page_changed_after_send"),
    ).resolves.toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.title_welcome?.name).toBe(
      "Out of scope",
    );
  });

  it("allows later commands to target a container inserted earlier in the same page transaction", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "apply_composite",
        call: {
          toolCallId: "tool_apply_composite",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Create a grouped mascot",
            commands: [
              {
                commandId: "insert_mascot_frame",
                type: "insert_element",
                pageId: "page_welcome",
                parentId: null,
                index: 1,
                node: {
                  id: "mascot_frame",
                  kind: "frame",
                  name: "Mascot",
                  parentId: null,
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, 900, 80],
                  size: { width: 280, height: 320 },
                  opacity: 1,
                  extensions: {},
                  properties: {
                    fills: [],
                    strokes: [],
                    strokeWidth: 0,
                    cornerRadius: 0,
                    clipsContent: false,
                  },
                },
              },
              {
                commandId: "insert_mascot_body",
                type: "insert_element",
                pageId: "page_welcome",
                parentId: "mascot_frame",
                index: 0,
                node: {
                  id: "mascot_body",
                  kind: "ellipse",
                  name: "Mascot body",
                  parentId: "mascot_frame",
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, 40, 30],
                  size: { width: 200, height: 260 },
                  opacity: 1,
                  extensions: {},
                  properties: {
                    fills: [{ type: "solid", color: "#111827", opacity: 1 }],
                    strokes: [],
                    strokeWidth: 0,
                  },
                },
              },
            ],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
      { stageDelayMs: 0 },
    );

    expect(response).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.mascot_frame?.childIds,
    ).toEqual(["mascot_body"]);
    expect(runtime.getSnapshot().document.nodesById.mascot_body?.parentId).toBe(
      "mascot_frame",
    );
  });

  it("still rejects a parent that was not on the target page or created earlier", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());

    await expect(
      executeDesignToolRequest(
        {
          requestId: "apply_missing_parent",
          call: {
            toolCallId: "tool_apply_missing_parent",
            toolName: "opendesign_apply_transaction",
            input: {
              label: "Invalid composite",
              commands: [
                {
                  commandId: "insert_child_before_parent",
                  type: "insert_element",
                  pageId: "page_welcome",
                  parentId: "future_parent",
                  index: 0,
                  node: {
                    id: "early_child",
                    kind: "ellipse",
                    name: "Early child",
                    parentId: "future_parent",
                    childIds: [],
                    visible: true,
                    locked: false,
                    transform: [1, 0, 0, 1, 0, 0],
                    size: { width: 20, height: 20 },
                    opacity: 1,
                    extensions: {},
                    properties: { fills: [], strokes: [], strokeWidth: 0 },
                  },
                },
              ],
            },
          },
          context: pageContext,
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("parent outside the registered page mutation target");
  });

  it("applies a write inside the registered selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "apply_1",
        call: {
          toolCallId: "tool_1",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Rename selected card",
            commands: [
              {
                commandId: "rename_card",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Selected card",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Selected card",
    );
  });

  it("places an image asset and node as one page-scoped undoable transaction", async () => {
    const commands = [
      {
        commandId: "put_reference_asset",
        type: "put_asset" as const,
        asset: {
          id: "asset_reference",
          kind: "image" as const,
          name: "Reference",
          mimeType: "image/png",
          source: { type: "data" as const, value: "aW1hZ2U=" },
          size: { width: 640, height: 480 },
          extensions: {},
        },
      },
      {
        commandId: "insert_reference_image",
        type: "insert_element" as const,
        pageId: "page_welcome",
        parentId: null,
        index: 1,
        node: {
          id: "image_reference",
          kind: "image" as const,
          name: "Reference",
          parentId: null,
          childIds: [],
          visible: true,
          locked: false,
          transform: [1, 0, 0, 1, 120, 160] as const,
          size: { width: 320, height: 240 },
          opacity: 1,
          properties: {
            assetId: "asset_reference",
            fit: "cover" as const,
            altText: "Reference",
            cornerRadius: 0,
          },
          extensions: {},
        },
      },
    ];
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "place_image",
        call: {
          toolCallId: "tool_place_image",
          toolName: "opendesign_internal_apply_transaction",
          input: { label: "Place reference image", commands },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: { revision: 1, stages: 1 },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const placed = runtime.getSnapshot();
    expect(placed.document.assetsById.asset_reference).toMatchObject({
      kind: "image",
      mimeType: "image/png",
    });
    expect(placed.document.nodesById.image_reference).toMatchObject({
      kind: "image",
      properties: { assetId: "asset_reference" },
    });
    expect(placed.state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    const undone = runtime.getSnapshot();
    expect(undone.document.assetsById.asset_reference).toBeUndefined();
    expect(undone.document.nodesById.image_reference).toBeUndefined();
    expect(undone.document.pagesById.page_welcome?.rootNodeIds).toEqual([
      "frame_welcome",
    ]);

    const selectedRuntime = new EditorRuntime(createWelcomeDocument());
    await expect(
      executeDesignToolRequest(
        {
          requestId: "place_image_with_selection_context",
          call: {
            toolCallId: "tool_place_image_with_selection_context",
            toolName: "opendesign_internal_apply_transaction",
            input: { label: "Place reference image", commands },
          },
          context: selectionContext,
        },
        selectedRuntime,
        "page_changed_after_send",
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(
      selectedRuntime.getSnapshot().document.assetsById.asset_reference,
    ).toBeDefined();
  });

  it("returns bounded image asset metadata without copying source bytes into model context", async () => {
    const sourceValue = `data:image/png;base64,${"A".repeat(1_000_000)}`;
    const runtime = new EditorRuntime(createWelcomeDocument());
    const placed = runtime.apply({
      transactionId: "transaction_large_image",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "system", id: "test" },
      commands: [
        {
          commandId: "put_large_image",
          type: "put_asset",
          asset: {
            id: "asset_large_image",
            kind: "image",
            name: "Large image",
            mimeType: "image/png",
            source: { type: "data", value: sourceValue },
            size: { width: 1_024, height: 1_024 },
            extensions: { attachmentId: `image_${"a".repeat(64)}` },
          },
        },
        {
          commandId: "insert_large_image",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: null,
          index: 1,
          node: {
            id: "image_large",
            kind: "image",
            name: "Large image",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 120, 160],
            size: { width: 320, height: 240 },
            opacity: 1,
            properties: {
              assetId: "asset_large_image",
              fit: "cover",
              altText: "Large image",
              cornerRadius: 0,
            },
            extensions: {},
          },
        },
      ],
    });
    expect(placed.ok).toBe(true);

    const response = await executeDesignToolRequest(
      {
        requestId: "inspect_large_image",
        call: {
          toolCallId: "tool_inspect_large_image",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    if (!response.ok) return;
    const serialized = JSON.stringify(response.result.content);
    expect(serialized).not.toContain(sourceValue);
    expect(serialized.length).toBeLessThan(20_000);
    expect(response.result.content).toMatchObject({
      document: {
        assetsById: {
          asset_large_image: {
            id: "asset_large_image",
            kind: "image",
            mimeType: "image/png",
            sourceType: "data",
            size: { width: 1_024, height: 1_024 },
            extensionKeys: ["attachmentId"],
          },
        },
      },
    });
  });

  it("renders a large tool transaction in visible stages with one undo entry", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = executeDesignToolRequest(
      {
        requestId: "apply_progressive",
        call: {
          toolCallId: "tool_progressive",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Refine selected card progressively",
            commands: [
              {
                commandId: "progressive_name_first",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Visible first stage",
              },
              {
                commandId: "progressive_opacity",
                type: "update_properties",
                nodeId: "feature_one",
                opacity: 0.85,
              },
              {
                commandId: "progressive_size",
                type: "update_properties",
                nodeId: "feature_one",
                size: { width: 260, height: 128 },
              },
              {
                commandId: "progressive_name_final",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Finished card",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
      { stageDelayMs: 0 },
    );

    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Visible first stage",
    );

    const completed = await response;
    expect(completed).toMatchObject({
      ok: true,
      result: {
        content: { revision: 2, stages: 2 },
        designRevision: { previousRevision: 0, revision: 2 },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Finished card",
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
  });

  it("rolls back every visible stage when generation is cancelled", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const controller = new AbortController();
    const response = executeDesignToolRequest(
      {
        requestId: "apply_cancelled",
        call: {
          toolCallId: "tool_cancelled",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Cancelled card refinement",
            commands: [
              {
                commandId: "cancelled_name_first",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Temporary stage",
              },
              {
                commandId: "cancelled_opacity",
                type: "update_properties",
                nodeId: "feature_one",
                opacity: 0.75,
              },
              {
                commandId: "cancelled_size",
                type: "update_properties",
                nodeId: "feature_one",
                size: { width: 280, height: 144 },
              },
              {
                commandId: "cancelled_name_final",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Must not remain",
              },
            ],
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
      { signal: controller.signal },
    );

    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Temporary stage",
    );
    controller.abort();
    await expect(response).rejects.toMatchObject({ name: "AbortError" });

    const snapshot = runtime.getSnapshot();
    expect(snapshot.document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
    expect(snapshot.state.history.canUndo).toBe(false);
    expect(snapshot.state.dirty).toBe(false);
  });
});

describe("Renderer semantic hierarchy tool", () => {
  it("groups explicit sibling IDs atomically without using or changing the live selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["feature_three"], "feature_three");
    const before = runtime.getSnapshot().document;
    const titleWorld = getWorldTransform(before, "title_welcome");
    const subtitleWorld = getWorldTransform(before, "subtitle_welcome");

    const response = await executeDesignToolRequest(
      {
        requestId: "hierarchy_group",
        call: {
          toolCallId: "tool_hierarchy_group",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "group",
            label: "Group welcome copy",
            pageId: "page_welcome",
            nodeIds: ["subtitle_welcome", "title_welcome"],
            groupId: "welcome_copy_group",
            name: "Welcome copy",
          },
        },
        // This send-time selection points somewhere else. It is context, not
        // an implicit hierarchy target.
        context: selectionContext,
      },
      runtime,
      "page_changed_after_send",
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "group",
          atomic: true,
          groupId: "welcome_copy_group",
          childNodeIds: ["title_welcome", "subtitle_welcome"],
          revision: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const grouped = runtime.getSnapshot();
    expect(grouped.document.nodesById.welcome_copy_group).toMatchObject({
      kind: "group",
      parentId: "frame_welcome",
      childIds: ["title_welcome", "subtitle_welcome"],
    });
    expect(getWorldTransform(grouped.document, "title_welcome")).toEqual(
      titleWorld,
    );
    expect(getWorldTransform(grouped.document, "subtitle_welcome")).toEqual(
      subtitleWorld,
    );
    expect(grouped.state.selection).toEqual({
      nodeIds: ["feature_three"],
      anchorNodeId: "feature_three",
    });
    expect(grouped.state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    const undone = runtime.getSnapshot();
    expect(undone.document.nodesById.welcome_copy_group).toBeUndefined();
    expect(undone.document.nodesById.title_welcome?.parentId).toBe(
      "frame_welcome",
    );
    expect(undone.document.nodesById.subtitle_welcome?.parentId).toBe(
      "frame_welcome",
    );
  });

  it("ungroups an explicit neutral Group in one revision and preserves child world transforms", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    const before = runtime.getSnapshot().document;
    const childIds = ["feature_one", "feature_two", "feature_three"];
    const worldTransforms = Object.fromEntries(
      childIds.map((nodeId) => [nodeId, getWorldTransform(before, nodeId)]),
    );

    const response = await executeDesignToolRequest(
      {
        requestId: "hierarchy_ungroup",
        call: {
          toolCallId: "tool_hierarchy_ungroup",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "ungroup",
            label: "Ungroup capability cards",
            pageId: "page_welcome",
            groupId: "feature_group",
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "ungroup",
          atomic: true,
          childNodeIds: childIds,
          revision: 1,
        },
      },
    });
    const ungrouped = runtime.getSnapshot();
    expect(ungrouped.document.nodesById.feature_group).toBeUndefined();
    for (const nodeId of childIds) {
      expect(ungrouped.document.nodesById[nodeId]?.parentId).toBe(
        "frame_welcome",
      );
      expect(getWorldTransform(ungrouped.document, nodeId)).toEqual(
        worldTransforms[nodeId],
      );
    }
    expect(ungrouped.state.selection).toEqual({
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    });
    expect(ungrouped.state.history.undo).toHaveLength(1);
  });

  it("returns scoped planner failures without partially changing the document", async () => {
    const mixedRuntime = new EditorRuntime(createWelcomeDocument());
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_mixed_parent",
          call: {
            toolCallId: "tool_hierarchy_mixed_parent",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: {
              action: "group",
              label: "Invalid mixed parent group",
              pageId: "page_welcome",
              nodeIds: ["title_welcome", "feature_one"],
              groupId: "invalid_group",
              name: "Invalid group",
            },
          },
          context: pageContext,
        },
        mixedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("hierarchy.mixed-parent");
    expect(mixedRuntime.getSnapshot().document.revision).toBe(0);
    expect(mixedRuntime.getSnapshot().state.history.canUndo).toBe(false);

    const lockedDocument = structuredClone(createWelcomeDocument());
    lockedDocument.nodesById.frame_welcome.locked = true;
    const lockedRuntime = new EditorRuntime(lockedDocument);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_locked",
          call: {
            toolCallId: "tool_hierarchy_locked",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: {
              action: "group",
              label: "Group locked copy",
              pageId: "page_welcome",
              nodeIds: ["title_welcome", "subtitle_welcome"],
              groupId: "locked_group",
              name: "Locked group",
            },
          },
          context: pageContext,
        },
        lockedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("hierarchy.locked");
    expect(lockedRuntime.getSnapshot().document.revision).toBe(0);

    const lossyDocument = structuredClone(createWelcomeDocument());
    lossyDocument.nodesById.feature_group.opacity = 0.5;
    const lossyRuntime = new EditorRuntime(lossyDocument);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_lossy",
          call: {
            toolCallId: "tool_hierarchy_lossy",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: {
              action: "ungroup",
              label: "Ungroup styled container",
              pageId: "page_welcome",
              groupId: "feature_group",
            },
          },
          context: pageContext,
        },
        lossyRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("hierarchy.visual-fidelity");
    expect(lossyRuntime.getSnapshot().document.revision).toBe(0);
  });

  it("rejects stale, out-of-target, and already-cancelled hierarchy writes", async () => {
    const staleRuntime = new EditorRuntime(createWelcomeDocument());
    expect(
      staleRuntime.apply({
        transactionId: "user_changed_before_hierarchy",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Rename before Agent write",
        commands: [
          {
            commandId: "rename_before_hierarchy",
            type: "update_properties",
            nodeId: "title_welcome",
            name: "New title",
          },
        ],
      }).ok,
    ).toBe(true);
    const groupInput = {
      action: "group" as const,
      label: "Group welcome copy",
      pageId: "page_welcome",
      nodeIds: ["title_welcome", "subtitle_welcome"],
      groupId: "welcome_copy_group",
      name: "Welcome copy",
    };
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_stale",
          call: {
            toolCallId: "tool_hierarchy_stale",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: groupInput,
          },
          context: pageContext,
        },
        staleRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");

    const scopedRuntime = new EditorRuntime(createWelcomeDocument());
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_wrong_page",
          call: {
            toolCallId: "tool_hierarchy_wrong_page",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: { ...groupInput, pageId: "page_other" },
          },
          context: pageContext,
        },
        scopedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("outside the registered page mutation target");

    const controller = new AbortController();
    controller.abort();
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_cancelled",
          call: {
            toolCallId: "tool_hierarchy_cancelled",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: groupInput,
          },
          context: pageContext,
        },
        scopedRuntime,
        "page_welcome",
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(scopedRuntime.getSnapshot().document.revision).toBe(0);
    expect(scopedRuntime.getSnapshot().state.history.canUndo).toBe(false);
  });
});
