import type { DesignNode } from "@opendesign/design-contracts";
import {
  createWelcomeDocument,
  EditorRuntime,
  getNodeBounds,
  getWorldTransform,
  planCreateBooleanGroup,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";
import { executeDesignToolRequest } from "./design-tool-execution";
import type {
  runSvgExportInWorker,
  runSvgImportInWorker,
} from "./svg-interchange";

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

function plannedInsertRequest(nodeId: string): RendererDesignToolRequest {
  return {
    requestId: `apply_${nodeId}`,
    call: {
      toolCallId: `tool_${nodeId}`,
      toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
      input: {
        label: "Continue the planned target",
        rebaseGuard: {
          fromRevision: 0,
          targets: [
            {
              frameId: "frame_welcome",
              pageId: "page_welcome",
              width: 1_120,
              height: 720,
            },
          ],
        },
        commands: [
          {
            commandId: `insert_${nodeId}`,
            type: "insert_element",
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 4,
            node: {
              id: nodeId,
              kind: "rectangle",
              name: "Continued content",
              parentId: "frame_welcome",
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 720, 620],
              size: { width: 240, height: 64 },
              opacity: 1,
              properties: {
                fills: [{ type: "solid", color: "#7c6ee6", opacity: 1 }],
                strokes: [],
                strokeWidth: 0,
                cornerRadius: 12,
              },
              extensions: {},
            },
          },
        ],
      },
    },
    context: pageContext,
  };
}

describe("Renderer design tool scope", () => {
  it("applies host-ID Page lifecycle operations only within their explicit mutation scope", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    const documentContext = {
      ...pageContext,
      mutationTarget: { kind: "document" as const },
    };
    const created = await executeDesignToolRequest(
      {
        requestId: "page_create",
        call: {
          toolCallId: "tool_page_create",
          toolName: DESIGN_PAGE_TOOL_NAME,
          input: {
            action: "create",
            label: "Create research Page",
            name: " Research ",
            index: 1,
          },
        },
        context: documentContext,
      },
      runtime,
      "page_welcome",
    );
    expect(created).toMatchObject({
      ok: true,
      result: {
        content: {
          kind: "page-operation-result",
          action: "create",
          name: "Research",
          pageOrder: ["page_welcome", expect.stringContaining("agent_page_")],
          revision: 1,
          atomic: true,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    if (!created.ok || typeof created.result.content !== "object") return;
    const createdPageId = (created.result.content as { pageId: string }).pageId;
    expect(createdPageId).toContain("tool_page_create");
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);

    const renamed = await executeDesignToolRequest(
      {
        requestId: "page_rename_current",
        call: {
          toolCallId: "tool_page_rename_current",
          toolName: DESIGN_PAGE_TOOL_NAME,
          input: {
            action: "rename",
            label: "Rename current Page",
            pageId: "page_welcome",
            name: "Homepage",
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(renamed).toMatchObject({
      ok: true,
      result: { content: { action: "rename", name: "Homepage", revision: 2 } },
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(2);
  });

  it("rejects document-level Page changes from a Current Page Run", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    await expect(
      executeDesignToolRequest(
        {
          requestId: "page_create_outside_scope",
          call: {
            toolCallId: "tool_page_create_outside_scope",
            toolName: DESIGN_PAGE_TOOL_NAME,
            input: {
              action: "create",
              label: "Create another Page",
              name: "Another",
            },
          },
          context: pageContext,
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("requires the Design File mutation scope");
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("keeps viewport zoom outside document concurrency control", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setViewport({
      panX: -120,
      panY: -80,
      zoom: 1.25,
      width: 1_920,
      height: 1_140,
    });

    const response = await executeDesignToolRequest(
      {
        requestId: "apply_after_zoom",
        call: {
          toolCallId: "tool_apply_after_zoom",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Refine after viewport zoom",
            commands: [
              {
                commandId: "rename_after_zoom",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Refined feature",
              },
            ],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response.ok).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().state.viewport.zoom).toBe(1.25);
  });

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

  it("rebases planned insert-only work onto a user-translated stable Frame", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const moved = runtime.apply({
      transactionId: "transaction_user_moves_target",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      label: "Move the target Frame while the Agent is working",
      commands: [
        {
          commandId: "move_target_frame",
          type: "update_properties",
          nodeId: "frame_welcome",
          transform: [1, 0, 0, 1, 400, 280],
        },
      ],
    });
    expect(moved.ok).toBe(true);

    const response = await executeDesignToolRequest(
      plannedInsertRequest("continued_content"),
      runtime,
      "page_welcome",
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        designRevision: {
          previousRevision: 1,
          rebasedFromRevision: 0,
          revision: 2,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.transform,
    ).toEqual([1, 0, 0, 1, 400, 280]);
    expect(
      runtime.getSnapshot().document.nodesById.continued_content?.transform,
    ).toEqual([1, 0, 0, 1, 720, 620]);
  });

  it("requires a fresh inspection when the planned Frame is resized", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const resized = runtime.apply({
      transactionId: "transaction_user_resizes_target",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      label: "Resize the target Frame while the Agent is working",
      commands: [
        {
          commandId: "resize_target_frame",
          type: "update_properties",
          nodeId: "frame_welcome",
          size: { width: 1_200, height: 720 },
        },
      ],
    });
    expect(resized.ok).toBe(true);

    await expect(
      executeDesignToolRequest(
        plannedInsertRequest("stale_layout_content"),
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");
    expect(
      runtime.getSnapshot().document.nodesById.stale_layout_content,
    ).toBeUndefined();
  });

  it("requires a fresh inspection when the planned Frame is deleted or reparented", async () => {
    const deletedRuntime = new EditorRuntime(createWelcomeDocument());
    expect(
      deletedRuntime.apply({
        transactionId: "transaction_user_deletes_target",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Delete the target Frame while the Agent is working",
        commands: [
          {
            commandId: "delete_target_frame",
            type: "delete_element",
            nodeId: "frame_welcome",
          },
        ],
      }).ok,
    ).toBe(true);
    await expect(
      executeDesignToolRequest(
        plannedInsertRequest("content_after_delete"),
        deletedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");

    const reparentedRuntime = new EditorRuntime(createWelcomeDocument());
    expect(
      reparentedRuntime.apply({
        transactionId: "transaction_user_reparents_target",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Reparent the target Frame while the Agent is working",
        commands: [
          {
            commandId: "insert_outer_frame",
            type: "insert_element",
            pageId: "page_welcome",
            parentId: null,
            index: 1,
            node: {
              id: "outer_frame",
              kind: "frame",
              name: "Outer frame",
              parentId: null,
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 20, 20],
              size: { width: 1_400, height: 1_000 },
              opacity: 1,
              properties: {
                fills: [],
                strokes: [],
                strokeWidth: 0,
                cornerRadius: 0,
                clipsContent: false,
              },
              extensions: {},
            },
          },
          {
            commandId: "reparent_target_frame",
            type: "move_element",
            nodeId: "frame_welcome",
            pageId: "page_welcome",
            parentId: "outer_frame",
            index: 0,
          },
        ],
      }).ok,
    ).toBe(true);
    await expect(
      executeDesignToolRequest(
        plannedInsertRequest("content_after_reparent"),
        reparentedRuntime,
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
        captureTarget: {
          kind: "frame",
          pageId: "page_welcome",
          nodeId: "frame_welcome",
        },
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
          layoutQuality: {
            version: 1,
            documentId: "document_welcome",
            revision: 0,
            pageId: "page_welcome",
            artboardFrameId: "frame_welcome",
          },
        },
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("prepares an explicit SVG export in a cancellable worker without changing revision", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    let workerInput: Parameters<typeof runSvgExportInWorker>[0] | undefined;
    const response = await executeDesignToolRequest(
      {
        requestId: "export_svg",
        call: {
          toolCallId: "tool_export_svg",
          toolName: EXPORT_SVG_TOOL_NAME,
          input: {
            pageId: "page_welcome",
            rootNodeIds: ["feature_one"],
            suggestedName: "Structured editing",
            includeLayerIds: true,
            padding: 16,
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
      {
        exportSvg: (input) => {
          workerInput = input;
          return Promise.resolve({
            svg: '<svg viewBox="0 0 336 252"><rect /></svg>',
            issues: [
              {
                code: "effect-omitted",
                message: "One effect was omitted",
                severity: "warning",
              },
            ],
            exportedNodeIds: ["feature_one"],
            revision: 0,
            sourceBounds: { x: 0, y: 0, width: 336, height: 252 },
          });
        },
      },
    );

    expect(workerInput).toMatchObject({
      pageId: "page_welcome",
      rootNodeIds: ["feature_one"],
      settings: { includeLayerIds: true, padding: 16 },
      document: { documentId: "document_welcome", revision: 0 },
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        observedRevision: 0,
        content: {
          kind: "svg-export-preparation",
          version: 1,
          suggestedName: "Structured editing",
          revision: 0,
          exportedNodeIds: ["feature_one"],
          issues: [{ code: "effect-omitted" }],
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("filePath");
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(runtime.getSnapshot().state.history.canUndo).toBe(false);
  });

  it("prepares one explicit delivery raster without reading selection or changing revision", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    let rasterRequest: unknown;
    const response = await executeDesignToolRequest(
      {
        requestId: "export_raster",
        call: {
          toolCallId: "tool_export_raster",
          toolName: EXPORT_RASTER_TOOL_NAME,
          input: {
            pageId: "page_welcome",
            rootNodeId: "feature_one",
            suggestedName: "Structured editing",
            format: "webp",
            size: { mode: "height", value: 900 },
            background: { mode: "color", color: "#ffffff" },
            quality: 0.84,
            resampling: "smooth",
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
      {
        exportRaster: (_document, request) => {
          rasterRequest = request;
          return Promise.resolve({
            bytes: new Uint8Array([7, 8, 9]),
            width: 1200,
            height: 900,
            mimeType: "image/webp",
          });
        },
      },
    );

    expect(rasterRequest).toEqual({
      version: 1,
      pageId: "page_welcome",
      rootNodeId: "feature_one",
      format: "webp",
      size: { mode: "height", value: 900 },
      background: { mode: "color", color: "#ffffff" },
      quality: 0.84,
      resampling: "smooth",
    });
    expect(response).toMatchObject({
      ok: true,
      result: {
        observedRevision: 0,
        content: {
          kind: "raster-export-preparation",
          version: 1,
          rootNodeId: "feature_one",
          width: 1200,
          height: 900,
          mimeType: "image/webp",
          revision: 0,
        },
      },
    });
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(runtime.getSnapshot().state.history.canUndo).toBe(false);
  });

  it("imports one authorized SVG preparation as editable layers in one undo step", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const idPrefix = "agent_svg_import_test";
    const root: DesignNode = {
      id: `${idPrefix}_0001_svg`,
      kind: "group",
      name: "Brand mark",
      parentId: null,
      childIds: [`${idPrefix}_0002_path`],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 120, height: 80 },
      opacity: 1,
      properties: {},
      extensions: {},
    };
    const path: DesignNode = {
      id: `${idPrefix}_0002_path`,
      kind: "path",
      name: "Editable contour",
      parentId: root.id,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 120, height: 80 },
      opacity: 1,
      properties: {
        path: "M0 0H120V80H0Z",
        fills: [{ type: "solid", color: "#6d5dfc", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
      },
      extensions: {},
    };
    const svg = '<svg viewBox="0 0 120 80"><path d="M0 0H120V80H0Z"/></svg>';
    let workerInput: Parameters<typeof runSvgImportInWorker>[0] | undefined;
    const response = await executeDesignToolRequest(
      {
        requestId: "import_svg",
        call: {
          toolCallId: "tool_import_svg",
          toolName: INTERNAL_IMPORT_SVG_TOOL_NAME,
          input: {
            attachmentId: `svg_${"a".repeat(64)}`,
            pageId: "page_welcome",
            parentId: null,
            index: 1,
            x: 920,
            y: 140,
            name: "Brand mark.svg",
            svg,
            idPrefix,
          },
        },
        context: pageContext,
      },
      runtime,
      "page_changed_after_send",
      {
        importSvg: (input) => {
          workerInput = input;
          return Promise.resolve({
            ok: true,
            version: 1,
            rootNodeId: root.id,
            nodes: [root, path],
            sourceViewport: { x: 0, y: 0, width: 120, height: 80 },
            issues: [
              {
                code: "effect-omitted",
                message: "One filter was omitted",
                severity: "warning",
              },
            ],
          });
        },
      },
    );

    expect(workerInput).toEqual({ svg, idPrefix, name: "Brand mark.svg" });
    expect(response).toMatchObject({
      ok: true,
      result: {
        observedRevision: 1,
        designRevision: { previousRevision: 0, revision: 1 },
        content: {
          kind: "svg-import-result",
          rootNodeId: root.id,
          importedNodeIds: [root.id, path.id],
          revision: 1,
          atomic: true,
          issues: [{ code: "effect-omitted" }],
        },
      },
    });
    expect(JSON.stringify(response)).not.toContain("<svg");
    expect(JSON.stringify(response)).not.toContain("idPrefix");
    expect(
      runtime.getSnapshot().document.nodesById[root.id]?.transform,
    ).toEqual([1, 0, 0, 1, 920, 140]);
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([root.id]);
    expect(runtime.undo()).toMatchObject({ ok: true });
    expect(runtime.getSnapshot().document.nodesById[root.id]).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById[path.id]).toBeUndefined();
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

  it("returns structured invariant details without mutating the document", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "apply_invalid_invariant",
        call: {
          toolCallId: "tool_invalid_invariant",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Break a stroke invariant",
            commands: [
              {
                commandId: "rename_feature_first",
                type: "update_properties",
                nodeId: "feature_one",
                name: "Feature prepared for styling",
              },
              {
                commandId: "break_feature_stroke",
                type: "update_properties",
                nodeId: "feature_one",
                properties: { strokeWidth: -1 },
              },
            ],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "design.invalid",
        retryable: false,
        recoverable: true,
        details: {
          kind: "design-transaction",
          issues: [
            {
              commandId: "break_feature_stroke",
              nodeId: "feature_one",
            },
          ],
          recovery: {
            action: "inspect-and-revise",
            toolName: "opendesign_inspect_document",
            required: true,
          },
        },
      },
    });
    if (response.ok) throw new Error("Invalid transaction unexpectedly passed");
    const details = response.error.details;
    expect(details?.fingerprint).toMatch(/^design_[a-f0-9]{8}$/);
    expect(details?.issues[0]).toMatchObject({
      commandId: "break_feature_stroke",
      nodeId: "feature_one",
      path: "/nodesById/feature_one/properties/strokeWidth",
      message: "Expected number to be greater or equal to 0",
    });
    expect(response.error.message).not.toContain("Expected union value");
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(
      (
        runtime.getSnapshot().document.nodesById.feature_one?.properties as {
          strokeWidth?: number;
        }
      ).strokeWidth,
    ).not.toBe(-1);
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
                  childIds: ["mascot_body"],
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

  it("rejects unmatched predeclared insert children before writing a revision", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());

    const response = await executeDesignToolRequest(
      {
        requestId: "apply_unmatched_children",
        call: {
          toolCallId: "tool_apply_unmatched_children",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Create incomplete group",
            commands: [
              {
                commandId: "insert_incomplete_group",
                type: "insert_element",
                pageId: "page_welcome",
                parentId: "frame_welcome",
                index: 4,
                node: {
                  id: "incomplete_group",
                  kind: "group",
                  name: "Incomplete group",
                  parentId: "frame_welcome",
                  childIds: ["missing_child"],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, 0, 0],
                  size: { width: 100, height: 100 },
                  opacity: 1,
                  properties: {},
                  extensions: {},
                },
              },
            ],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(response).toMatchObject({
      ok: false,
      error: {
        code: "design.invalid",
        recoverable: true,
        retryable: false,
        details: {
          kind: "design-transaction",
          issues: [
            {
              commandId: "insert_incomplete_group",
              nodeId: "incomplete_group",
              path: "/nodesById/incomplete_group/childIds",
            },
          ],
        },
      },
    });
    if (response.ok) throw new Error("Invalid child hierarchy was accepted");
    expect(response.error.details?.issues[0]?.message).toContain(
      "Keep insert_element node.childIds empty",
    );
    expect(runtime.getSnapshot().document.revision).toBe(0);
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
            placement: {
              mode: "fill" as const,
              focalPoint: { x: 0.5, y: 0.5 },
            },
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

  it("updates the explicit Image node instead of the live selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const oldAssetId = `asset_${"a".repeat(64)}`;
    const inserted = runtime.apply({
      transactionId: "insert_update_target",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "user", id: "test" },
      commands: [
        {
          commandId: "put_update_target",
          type: "put_asset",
          asset: {
            id: oldAssetId,
            kind: "image",
            name: "Old hero",
            mimeType: "image/png",
            source: { type: "data", value: "b2xk" },
            size: { width: 800, height: 600 },
            extensions: {},
          },
        },
        {
          commandId: "insert_update_target",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 4,
          node: {
            id: "hero_image",
            kind: "image",
            name: "Hero",
            parentId: "frame_welcome",
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 32, 32],
            size: { width: 320, height: 240 },
            opacity: 1,
            properties: {
              assetId: oldAssetId,
              placement: { mode: "fit" },
              altText: "Hero",
              cornerRadius: 0,
            },
            extensions: {},
          },
        },
      ],
    });
    expect(inserted.ok).toBe(true);
    runtime.setSelection(["feature_one"], "feature_one");

    const placementResponse = await executeDesignToolRequest(
      {
        requestId: "update_image_placement",
        call: {
          toolCallId: "tool_update_image_placement",
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: {
            action: "set-placement",
            label: "Reframe hero",
            pageId: "page_welcome",
            nodeId: "hero_image",
            placement: {
              mode: "crop",
              focalPoint: { x: 0.4, y: 0.6 },
              zoom: 1.3,
              rotation: -6,
              flipHorizontal: false,
              flipVertical: false,
            },
          },
        },
        context: { ...selectionContext, revision: 1 },
      },
      runtime,
      "page_changed_after_send",
    );
    expect(placementResponse).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-placement",
          nodeId: "hero_image",
          revision: 2,
          atomic: true,
        },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "feature_one",
    ]);

    const newAssetId = `asset_${"b".repeat(64)}`;
    const replacementResponse = await executeDesignToolRequest(
      {
        requestId: "replace_image_source",
        call: {
          toolCallId: "tool_replace_image_source",
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: {
            action: "replace-source",
            label: "Replace hero source",
            pageId: "page_welcome",
            nodeId: "hero_image",
            asset: {
              id: newAssetId,
              kind: "image",
              name: "New hero",
              mimeType: "image/webp",
              source: { type: "data", value: "bmV3" },
              size: { width: 1600, height: 900 },
              extensions: {},
            },
          },
        },
        context: { ...selectionContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(replacementResponse).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "replace-source",
          nodeId: "hero_image",
          assetId: newAssetId,
          deletedAssetId: oldAssetId,
          revision: 3,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.assetsById[oldAssetId],
    ).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(3);
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
              placement: {
                mode: "fill",
                focalPoint: { x: 0.5, y: 0.5 },
              },
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

  it("keeps invariant-dependent commands together in a document-valid stage", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const plan = planCreateBooleanGroup(
      runtime.getSnapshot().document,
      "page_welcome",
      ["feature_one", "feature_two"],
      "subtract",
      {
        booleanId: "progressive_boolean",
        name: "Progressive Boolean",
        commandPrefix: "progressive_boolean",
      },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const response = await executeDesignToolRequest(
      {
        requestId: "apply_invariant_dependent",
        call: {
          toolCallId: "tool_invariant_dependent",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Create a valid Boolean",
            commands: plan.commands,
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
      { stageDelayMs: 0 },
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: { revision: 1, stages: 1 },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.progressive_boolean,
    ).toMatchObject({
      kind: "boolean",
      childIds: ["feature_one", "feature_two"],
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
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

  it("creates, changes, and ungroups a non-destructive Boolean without reading the live selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["feature_three"], "feature_three");
    const before = runtime.getSnapshot().document;
    const sourceIds = ["feature_one", "feature_two"];
    const worldTransforms = Object.fromEntries(
      sourceIds.map((nodeId) => [nodeId, getWorldTransform(before, nodeId)]),
    );

    const created = await executeDesignToolRequest(
      {
        requestId: "hierarchy_create_boolean",
        call: {
          toolCallId: "tool_hierarchy_create_boolean",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "create-boolean",
            label: "Subtract capability shapes",
            pageId: "page_welcome",
            nodeIds: sourceIds,
            booleanId: "capability_boolean",
            name: "Capability mark",
            operation: "subtract",
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_changed_after_send",
    );

    expect(created).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "create-boolean",
          atomic: true,
          booleanId: "capability_boolean",
          operation: "subtract",
          childNodeIds: sourceIds,
          revision: 1,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.capability_boolean,
    ).toMatchObject({
      kind: "boolean",
      childIds: sourceIds,
      properties: { operation: "subtract" },
    });

    const changed = await executeDesignToolRequest(
      {
        requestId: "hierarchy_set_boolean",
        call: {
          toolCallId: "tool_hierarchy_set_boolean",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "set-boolean-operation",
            label: "Intersect capability shapes",
            pageId: "page_welcome",
            booleanId: "capability_boolean",
            operation: "intersect",
          },
        },
        context: { ...selectionContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(changed).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-boolean-operation",
          booleanId: "capability_boolean",
          operation: "intersect",
          revision: 2,
        },
      },
    });

    const ungrouped = await executeDesignToolRequest(
      {
        requestId: "hierarchy_ungroup_boolean",
        call: {
          toolCallId: "tool_hierarchy_ungroup_boolean",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "ungroup-boolean",
            label: "Release capability shapes",
            pageId: "page_welcome",
            booleanId: "capability_boolean",
          },
        },
        context: { ...selectionContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(ungrouped).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "ungroup-boolean",
          booleanId: "capability_boolean",
          childNodeIds: sourceIds,
          revision: 3,
        },
      },
    });
    const after = runtime.getSnapshot();
    expect(after.document.nodesById.capability_boolean).toBeUndefined();
    for (const nodeId of sourceIds) {
      expect(getWorldTransform(after.document, nodeId)).toEqual(
        worldTransforms[nodeId],
      );
    }
    expect(after.state.selection).toEqual({
      nodeIds: ["feature_three"],
      anchorNodeId: "feature_three",
    });
    expect(after.state.history.undo).toHaveLength(3);
  });

  it("reorders explicit sibling IDs atomically without reading or resetting selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["feature_three"], "feature_three");
    const response = await executeDesignToolRequest(
      {
        requestId: "hierarchy_reorder",
        call: {
          toolCallId: "tool_hierarchy_reorder",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "reorder",
            label: "Bring welcome copy to front",
            pageId: "page_welcome",
            nodeIds: ["title_welcome", "subtitle_welcome"],
            order: "bring-to-front",
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
          action: "reorder",
          order: "bring-to-front",
          nodeIds: ["title_welcome", "subtitle_welcome"],
          siblingOrder: [
            "shape_accent",
            "feature_group",
            "title_welcome",
            "subtitle_welcome",
          ],
          revision: 1,
          atomic: true,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const reordered = runtime.getSnapshot();
    expect(reordered.state.selection).toEqual({
      nodeIds: ["feature_three"],
      anchorNodeId: "feature_three",
    });
    expect(reordered.state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
    ]);
  });

  it("reparents explicit layers with host-computed transforms and dynamic Group bounds", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    const before = runtime.getSnapshot().document;
    const featureWorld = getWorldTransform(before, "feature_one");
    const siblingWorld = getWorldTransform(before, "feature_two");
    const response = await executeDesignToolRequest(
      {
        requestId: "hierarchy_reparent",
        call: {
          toolCallId: "tool_hierarchy_reparent",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "reparent",
            label: "Move first capability out of its Group",
            pageId: "page_welcome",
            nodeIds: ["feature_one"],
            parentId: "frame_welcome",
            index: 1,
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
          action: "reparent",
          nodeIds: ["feature_one"],
          parentId: "frame_welcome",
          index: 1,
          siblingOrder: [
            "shape_accent",
            "feature_one",
            "title_welcome",
            "subtitle_welcome",
            "feature_group",
          ],
          atomic: true,
          revision: 1,
          warnings: [],
        },
      },
    });
    const moved = runtime.getSnapshot();
    expect(moved.document.nodesById.feature_one?.parentId).toBe(
      "frame_welcome",
    );
    expect(moved.document.nodesById.feature_group?.size).toEqual({
      width: 556,
      height: 220,
    });
    expect(getWorldTransform(moved.document, "feature_one")).toEqual(
      featureWorld,
    );
    expect(getWorldTransform(moved.document, "feature_two")).toEqual(
      siblingWorld,
    );
    expect(moved.state.selection).toEqual({
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    });
    expect(moved.state.history.undo).toHaveLength(1);
  });

  it("returns hierarchy failures and visual-context warnings for Agent reparenting", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    await expect(
      executeDesignToolRequest(
        {
          requestId: "hierarchy_reparent_cycle",
          call: {
            toolCallId: "tool_hierarchy_reparent_cycle",
            toolName: DESIGN_HIERARCHY_TOOL_NAME,
            input: {
              action: "reparent",
              label: "Invalid cycle",
              pageId: "page_welcome",
              nodeIds: ["frame_welcome"],
              parentId: "feature_group",
              index: 0,
            },
          },
          context: pageContext,
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("hierarchy.invalid-target");
    expect(runtime.getSnapshot().document.revision).toBe(0);

    const styled = structuredClone(createWelcomeDocument());
    const styledGroup = styled.nodesById.feature_group;
    if (!styledGroup) throw new Error("Missing Group fixture");
    styledGroup.opacity = 0.6;
    const styledRuntime = new EditorRuntime(styled);
    const warned = await executeDesignToolRequest(
      {
        requestId: "hierarchy_reparent_warning",
        call: {
          toolCallId: "tool_hierarchy_reparent_warning",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "reparent",
            label: "Move title into styled Group",
            pageId: "page_welcome",
            nodeIds: ["title_welcome"],
            parentId: "feature_group",
            index: 0,
          },
        },
        context: pageContext,
      },
      styledRuntime,
      "page_welcome",
    );
    expect(warned).toMatchObject({
      ok: true,
      result: {
        content: {
          warnings: [expect.stringContaining("inherited clipping")],
        },
      },
    });
  });

  it("arranges explicit layers atomically without using or resetting selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    const before = runtime.getSnapshot().document;
    const firstWorld = getWorldTransform(before, "feature_one");
    const thirdWorld = getWorldTransform(before, "feature_three");
    const response = await executeDesignToolRequest(
      {
        requestId: "arrange_distribute",
        call: {
          toolCallId: "tool_arrange_distribute",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "distribute-horizontal",
            label: "Distribute capability cards",
            pageId: "page_welcome",
            nodeIds: ["feature_one", "feature_two", "feature_three"],
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
          action: "distribute-horizontal",
          nodeIds: ["feature_one", "feature_two", "feature_three"],
          orderedNodeIds: ["feature_one", "feature_two", "feature_three"],
          resolvedSpacing: 56,
          revision: 1,
          atomic: true,
          warnings: [],
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const arranged = runtime.getSnapshot();
    expect(arranged.document.nodesById.feature_group?.size).toEqual({
      width: 892,
      height: 220,
    });
    expect(getNodeBounds(arranged.document, "feature_two")?.x).toBe(504);
    expect(getWorldTransform(arranged.document, "feature_one")).toEqual(
      firstWorld,
    );
    expect(getWorldTransform(arranged.document, "feature_three")).toEqual(
      thirdWorld,
    );
    expect(arranged.state.selection).toEqual({
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    });
    expect(arranged.state.history.undo).toHaveLength(1);
  });

  it("tidies explicit layers and reports the host-resolved layout", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "arrange_tidy",
        call: {
          toolCallId: "tool_arrange_tidy",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "tidy-up",
            label: "Tidy capability cards",
            pageId: "page_welcome",
            nodeIds: ["feature_one", "feature_two", "feature_three"],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "tidy-up",
          tidyUpDimension: "horizontal",
          resolvedHorizontalSpacing: 32,
          orderedNodeIds: ["feature_one", "feature_two", "feature_three"],
          revision: 1,
          atomic: true,
        },
      },
    });
    expect(
      getNodeBounds(runtime.getSnapshot().document, "feature_three")?.x,
    ).toBe(816);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("sets exact negative Agent spacing and rejects locked or out-of-scope arrangement", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "arrange_spacing",
        call: {
          toolCallId: "tool_arrange_spacing",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-horizontal-spacing",
            label: "Overlap capability cards",
            pageId: "page_welcome",
            nodeIds: ["feature_one", "feature_two", "feature_three"],
            spacing: -20,
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(response).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-horizontal-spacing",
          resolvedSpacing: -20,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.feature_group?.size.width,
    ).toBe(740);

    const locked = structuredClone(createWelcomeDocument());
    locked.nodesById.feature_group.locked = true;
    const lockedRuntime = new EditorRuntime(locked);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "arrange_locked",
          call: {
            toolCallId: "tool_arrange_locked",
            toolName: DESIGN_ARRANGE_TOOL_NAME,
            input: {
              action: "distribute-horizontal",
              label: "Invalid locked arrangement",
              pageId: "page_welcome",
              nodeIds: ["feature_one", "feature_two", "feature_three"],
            },
          },
          context: pageContext,
        },
        lockedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("arrange.locked");
    expect(lockedRuntime.getSnapshot().document.revision).toBe(0);

    await expect(
      executeDesignToolRequest(
        {
          requestId: "arrange_scope",
          call: {
            toolCallId: "tool_arrange_scope",
            toolName: DESIGN_ARRANGE_TOOL_NAME,
            input: {
              action: "align-left",
              label: "Wrong Page",
              pageId: "page_welcome",
              nodeIds: ["feature_one", "feature_two"],
            },
          },
          context: {
            ...pageContext,
            mutationTarget: {
              kind: "page",
              pageId: "page_other",
            },
          },
        },
        new EditorRuntime(createWelcomeDocument()),
        "page_welcome",
      ),
    ).rejects.toThrow("Arrangement operation targets Page page_welcome");
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
