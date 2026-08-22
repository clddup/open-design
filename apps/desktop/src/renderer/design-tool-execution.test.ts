import type { DesignNode } from "@opendesign/design-contracts";
import { resolveComponentInstance } from "@opendesign/component-service";
import {
  createWelcomeDocument,
  EditorRuntime,
  getNodeBounds,
  getWorldTransform,
  planCreateBooleanGroup,
} from "@opendesign/editor-runtime";
import { memoizeTextLayoutProvider } from "@opendesign/text-service";
import { describe, expect, it, vi } from "vitest";
import {
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_VARIABLE_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
} from "../shared/design-agent-tools";
import type { RendererDesignToolRequest } from "../shared/design-tool-bridge";
import { decodeAgentTextLineBreaks } from "./agent-text-normalization";
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
              exportSettings: [],
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
  it("applies scoped Agent font replacement through the shared reflow transaction", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: {
        id: "test-text-layout",
        version: "3",
        inspectFont: () => ({
          status: "available",
          provider: "test-text-layout",
          providerVersion: "3",
          message: "The requested font is loaded",
        }),
        measure: (request) => ({
          ok: true,
          provider: "test-text-layout",
          providerVersion: "3",
          size: { width: request.width ?? 320, height: 64 },
          warnings: [],
        }),
      },
    });
    const response = await executeDesignToolRequest(
      {
        requestId: "replace_font",
        call: {
          toolCallId: "tool_replace_font",
          toolName: DESIGN_FONT_TOOL_NAME,
          input: {
            action: "replace",
            label: "Replace missing font",
            pageId: "page_welcome",
            nodeIds: ["title_welcome", "subtitle_welcome"],
            expectedFont: {
              fontFamily: "Inter",
              fontStyleName: "Semi Bold",
              fontWeight: 600,
              fontSlant: "normal",
            },
            replacementFont: {
              fontFamily: "IBM Plex Sans",
              fontStyleName: null,
              fontWeight: 500,
              fontSlant: "normal",
            },
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
          label: "Replace missing font",
          revision: 1,
          stages: 1,
          warnings: [],
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 500,
        fontSlant: "normal",
      },
    });
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().state.history.canUndo).toBe(true);
  });

  it("rejects stale and out-of-scope font writes without changing the document", async () => {
    const createRuntime = () =>
      new EditorRuntime(createWelcomeDocument(), {
        textLayoutProvider: {
          id: "test-text-layout",
          version: "3",
          inspectFont: () => ({
            status: "available",
            provider: "test-text-layout",
            providerVersion: "3",
            message: "The requested font is loaded",
          }),
          measure: (request) => ({
            ok: true,
            provider: "test-text-layout",
            providerVersion: "3",
            size: { width: request.width ?? 320, height: 64 },
            warnings: [],
          }),
        },
      });
    const input = {
      action: "replace" as const,
      label: "Replace Inter",
      pageId: "page_welcome",
      nodeIds: ["title_welcome"],
      expectedFont: {
        fontFamily: "Inter",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        fontSlant: "normal",
      },
      replacementFont: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 500,
        fontSlant: "normal",
      },
    };
    const staleRuntime = createRuntime();
    expect(
      staleRuntime.apply({
        transactionId: "user_edit_before_font",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        commands: [
          {
            commandId: "rename_before_font",
            type: "update_properties",
            nodeId: "feature_one",
            name: "Changed by user",
          },
        ],
      }).ok,
    ).toBe(true);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "stale_font",
          call: {
            toolCallId: "tool_stale_font",
            toolName: DESIGN_FONT_TOOL_NAME,
            input,
          },
          context: pageContext,
        },
        staleRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");
    expect(staleRuntime.getSnapshot().document.revision).toBe(1);

    const scopedRuntime = createRuntime();
    await expect(
      executeDesignToolRequest(
        {
          requestId: "scoped_font",
          call: {
            toolCallId: "tool_scoped_font",
            toolName: DESIGN_FONT_TOOL_NAME,
            input,
          },
          context: {
            ...pageContext,
            mutationTarget: { kind: "page", pageId: "page_other" },
          },
        },
        scopedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("outside the registered page mutation target");
    expect(scopedRuntime.getSnapshot().document.revision).toBe(0);
  });

  it("styles one inspected text range as one material revision without resetting selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["title_welcome"], "title_welcome");
    const response = await executeDesignToolRequest(
      {
        requestId: "style_title_range",
        call: {
          toolCallId: "tool_style_title_range",
          toolName: DESIGN_TEXT_RANGE_TOOL_NAME,
          input: {
            label: "Emphasize title prefix",
            pageId: "page_welcome",
            nodeId: "title_welcome",
            start: 0,
            end: 6,
            style: {
              fontWeight: 700,
              listOptions: { type: "ordered" },
              listSpacing: 8,
              paragraphSpacing: 12,
              fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
            },
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
          label: "Emphasize title prefix",
          revision: 1,
          stages: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const title = runtime.getSnapshot().document.nodesById.title_welcome;
    if (!title || title.kind !== "text") {
      throw new Error("Missing title fixture");
    }
    expect(title.properties.paragraphRuns).toEqual([
      {
        start: 0,
        end: 33,
        style: {
          listOptions: { type: "ordered" },
          indentation: 1,
          listSpacing: 8,
          paragraphIndent: 0,
          paragraphSpacing: 12,
        },
      },
    ]);
    const runs = title.properties.runs;
    if (!runs) throw new Error("Missing rich-text runs");
    expect(runs).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      start: 0,
      end: 6,
      style: {
        fontWeight: 700,
        fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      },
    });
    expect(runs[1]).toMatchObject({ start: 6 });
    expect(runtime.getSnapshot().state.selection).toEqual({
      nodeIds: ["title_welcome"],
      anchorNodeId: "title_welcome",
    });
    expect(runtime.getSnapshot().state.history.canUndo).toBe(true);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({ properties: { runs: [] } });
  });

  it("rejects cross-Page, locked, and half-surrogate range writes atomically", async () => {
    const execute = (
      runtime: EditorRuntime,
      input: Record<string, unknown>,
      context = pageContext,
    ) =>
      executeDesignToolRequest(
        {
          requestId: "invalid_text_range",
          call: {
            toolCallId: "tool_invalid_text_range",
            toolName: DESIGN_TEXT_RANGE_TOOL_NAME,
            input,
          },
          context,
        },
        runtime,
        "page_welcome",
      );
    const baseInput = {
      label: "Style range",
      pageId: "page_welcome",
      nodeId: "title_welcome",
      start: 0,
      end: 1,
      style: { fontWeight: 700 },
    };

    const crossPageDocument = structuredClone(createWelcomeDocument());
    crossPageDocument.pageOrder.push("page_other");
    crossPageDocument.pagesById.page_other = {
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
      extensions: {},
    };
    const crossPageRuntime = new EditorRuntime(crossPageDocument);
    await expect(
      execute(
        crossPageRuntime,
        { ...baseInput, pageId: "page_other" },
        {
          ...pageContext,
          mutationTarget: { kind: "page", pageId: "page_other" },
        },
      ),
    ).rejects.toThrow("outside Page page_other");
    expect(crossPageRuntime.getSnapshot().document.revision).toBe(0);

    const lockedDocument = structuredClone(createWelcomeDocument());
    const lockedTitle = lockedDocument.nodesById.title_welcome;
    if (!lockedTitle) throw new Error("Missing title fixture");
    lockedTitle.locked = true;
    const lockedRuntime = new EditorRuntime(lockedDocument);
    expect(await execute(lockedRuntime, baseInput)).toMatchObject({
      ok: false,
      error: { code: "design.permission-denied" },
    });
    expect(lockedRuntime.getSnapshot().document.revision).toBe(0);

    const surrogateDocument = structuredClone(createWelcomeDocument());
    const surrogateTitle = surrogateDocument.nodesById.title_welcome;
    if (!surrogateTitle || surrogateTitle.kind !== "text") {
      throw new Error("Missing title fixture");
    }
    surrogateTitle.properties.content = "A😀B";
    surrogateTitle.properties.runs = [];
    const surrogateRuntime = new EditorRuntime(surrogateDocument);
    expect(
      await execute(surrogateRuntime, {
        ...baseInput,
        start: 1,
        end: 2,
      }),
    ).toMatchObject({ ok: false, error: { code: "design.invalid" } });
    expect(surrogateRuntime.getSnapshot().document.revision).toBe(0);
  });

  it("authors and binds Variables through the dedicated typed tool and inspection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const execute = (input: Record<string, unknown>) =>
      executeDesignToolRequest(
        {
          requestId: `variables_${runtime.getSnapshot().document.revision}`,
          call: {
            toolCallId: `tool_variables_${runtime.getSnapshot().document.revision}`,
            toolName: DESIGN_VARIABLE_TOOL_NAME,
            input,
          },
          context: {
            ...pageContext,
            revision: runtime.getSnapshot().document.revision,
          },
        },
        runtime,
        "page_welcome",
      );
    expect(
      await execute({
        action: "create-collection",
        label: "Create theme variables",
        pageId: "page_welcome",
        collectionId: "theme",
        key: "theme-key",
        name: "Theme",
        defaultModeId: "default",
        defaultModeName: "Default",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await execute({
        action: "create-variable",
        label: "Create title copy variable",
        pageId: "page_welcome",
        variableId: "title-copy",
        key: "title-copy-key",
        collectionId: "theme",
        name: "Content/Title",
        resolvedType: "STRING",
        valuesByMode: { default: "Typed Agent title" },
        scopes: ["TEXT_CONTENT"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await execute({
        action: "set-binding",
        label: "Bind title content",
        pageId: "page_welcome",
        target: {
          kind: "node",
          nodeId: "title_welcome",
          field: "characters",
        },
        variableId: "title-copy",
      }),
    ).toMatchObject({
      ok: true,
      result: { content: { action: "set-binding", atomic: true } },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.boundVariables,
    ).toEqual({
      characters: { type: "VARIABLE_ALIAS", id: "title-copy" },
    });

    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_variables",
        call: {
          toolCallId: "tool_inspect_variables",
          toolName: DESIGN_INSPECT_TOOL_NAME,
          input: {},
        },
        context: {
          ...pageContext,
          revision: runtime.getSnapshot().document.revision,
        },
      },
      runtime,
      "page_welcome",
    );
    expect(inspection).toMatchObject({
      ok: true,
      result: {
        content: {
          idAllocation: {
            version: 1,
            scope: "run",
            newNodeIdPrefix: "odr_run_1_",
          },
          document: {
            componentCatalog: {
              totalCount: 0,
              truncated: false,
              components: [],
            },
            variableCollectionsById: { theme: { defaultModeId: "default" } },
            variablesById: { "title-copy": { resolvedType: "STRING" } },
            libraryVariableCollectionsById: {},
            libraryVariablesById: {},
            variableResolutionsByNodeId: {
              title_welcome: {
                characters: {
                  ok: true,
                  resolved: { value: "Typed Agent title" },
                },
              },
            },
          },
        },
      },
    });
  });

  it("decodes model-escaped line breaks only in Agent text content", async () => {
    expect(decodeAgentTextLineBreaks("Line one\\nLine two")).toBe(
      "Line one\nLine two",
    );
    expect(decodeAgentTextLineBreaks("Line one\\r\\nLine two")).toBe(
      "Line one\nLine two",
    );
    expect(decodeAgentTextLineBreaks(String.raw`C:\new\reference.png`)).toBe(
      String.raw`C:\new\reference.png`,
    );
    expect(decodeAgentTextLineBreaks(String.raw`Keep \\n literal`)).toBe(
      String.raw`Keep \\n literal`,
    );

    const runtime = new EditorRuntime(createWelcomeDocument());
    const frame = runtime.getSnapshot().document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const response = await executeDesignToolRequest(
      {
        requestId: "apply_escaped_text",
        call: {
          toolCallId: "tool_escaped_text",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Add multiline copy",
            summary: String.raw`Preserve C:\new\reference.png`,
            commands: [
              {
                commandId: "insert_escaped_text",
                type: "insert_element",
                pageId: "page_welcome",
                parentId: frame.id,
                index: frame.childIds.length,
                node: {
                  id: "agent_escaped_text",
                  kind: "text",
                  name: "Multiline copy",
                  parentId: frame.id,
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, 64, 620],
                  size: { width: 480, height: 96 },
                  exportSettings: [],
                  opacity: 1,
                  properties: {
                    content: "Line one\\nLine two",
                    fontFamily: "Inter, sans-serif",
                    fontStyleName: null,
                    fontSize: 28,
                    fontWeight: 700,
                    fontSlant: "normal",
                    lineHeight: 36,
                    letterSpacing: 0,
                    paragraphIndent: 0,
                    paragraphSpacing: 0,
                    listSpacing: 0,
                    hangingList: false,
                    textCase: "original",
                    textDecoration: "none",
                    textAlignHorizontal: "left",
                    textAlignVertical: "top",
                    textResize: "fixed",
                    textWrap: "word",
                    textOverflow: "visible",
                    textTruncation: "disabled",
                    maxLines: null,
                    fills: [{ type: "solid", color: "#151515", opacity: 1 }],
                    strokes: [],
                    strokeWidth: 0,
                  },
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
      { stageDelayMs: 0 },
    );

    expect(response.ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.agent_escaped_text,
    ).toMatchObject({ properties: { content: "Line one\nLine two" } });
    if (response.ok) {
      expect(response.result.content).toMatchObject({
        label: "Add multiline copy",
      });
    }
  });

  it("creates, inspects, overrides, and detaches components through the typed tool", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const createComponent = await executeDesignToolRequest(
      {
        requestId: "component_create",
        call: {
          toolCallId: "tool_component_create",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "create-component",
            label: "Create feature component",
            pageId: "page_welcome",
            rootNodeId: "feature_group",
            componentId: "component_feature",
            name: "Feature",
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(createComponent).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "create-component",
          componentId: "component_feature",
          mainNodeId: "feature_group",
        },
      },
    });

    const sourceNodeId =
      runtime.getSnapshot().document.nodesById.feature_group?.childIds[0];
    if (!sourceNodeId) throw new Error("Feature component has no source layer");
    const addProperty = await executeDesignToolRequest(
      {
        requestId: "component_add_property",
        call: {
          toolCallId: "tool_component_add_property",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "add-property",
            label: "Expose feature visibility",
            pageId: "page_welcome",
            componentId: "component_feature",
            propertyId: "feature:visible",
            name: "Show feature",
            type: "BOOLEAN",
            sourceNodeId,
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(addProperty).toMatchObject({
      ok: true,
      result: {
        content: { action: "add-property", revision: 2 },
      },
    });

    const createInstance = await executeDesignToolRequest(
      {
        requestId: "component_instance",
        call: {
          toolCallId: "tool_component_instance",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "create-instance",
            label: "Place feature instance",
            pageId: "page_welcome",
            componentId: "component_feature",
            instanceId: "feature_instance",
            parentId: "frame_welcome",
            index: 4,
            x: 720,
            y: 560,
          },
        },
        context: { ...pageContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(createInstance).toMatchObject({
      ok: true,
      result: { content: { instanceId: "feature_instance", revision: 3 } },
    });

    const setProperty = await executeDesignToolRequest(
      {
        requestId: "component_set_property",
        call: {
          toolCallId: "tool_component_set_property",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "set-property",
            label: "Hide feature through component property",
            pageId: "page_welcome",
            instanceId: "feature_instance",
            propertyName: "Show feature#feature:visible",
            value: false,
          },
        },
        context: { ...pageContext, revision: 3 },
      },
      runtime,
      "page_welcome",
    );
    expect(setProperty).toMatchObject({
      ok: true,
      result: { content: { action: "set-property", revision: 4 } },
    });

    const override = await executeDesignToolRequest(
      {
        requestId: "component_override",
        call: {
          toolCallId: "tool_component_override",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "set-override",
            label: "Hide feature source",
            pageId: "page_welcome",
            instanceId: "feature_instance",
            sourcePath: [sourceNodeId],
            patch: { visible: false },
          },
        },
        context: { ...pageContext, revision: 4 },
      },
      runtime,
      "page_welcome",
    );
    expect(override.ok).toBe(true);

    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_components",
        call: {
          toolCallId: "tool_inspect_components",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: { ...pageContext, revision: 5 },
      },
      runtime,
      "page_welcome",
    );
    expect(inspection).toMatchObject({
      ok: true,
      result: {
        content: {
          document: {
            componentsById: {
              component_feature: {
                rootNodeId: "feature_group",
                componentPropertyOrder: ["Show feature#feature:visible"],
                componentPropertyDefinitions: {
                  "Show feature#feature:visible": {
                    type: "BOOLEAN",
                    defaultValue: true,
                  },
                },
              },
            },
            instancesById: {
              feature_instance: {
                componentId: "component_feature",
                componentProperties: {
                  "Show feature#feature:visible": {
                    type: "BOOLEAN",
                    value: false,
                  },
                },
                propertyAssignments: {
                  "Show feature#feature:visible": false,
                },
                overrides: [{ sourcePath: [sourceNodeId] }],
              },
            },
          },
        },
      },
    });
    expect(JSON.stringify(inspection)).toContain(
      `"sourceNodeId":"${sourceNodeId}","kind":"rectangle","name":"Structured editing","componentPropertyReferences":{"visible":"Show feature#feature:visible"}`,
    );

    const renamedProperty = await executeDesignToolRequest(
      {
        requestId: "component_rename_property",
        call: {
          toolCallId: "tool_component_rename_property",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "rename-property",
            label: "Rename feature property",
            pageId: "page_welcome",
            componentId: "component_feature",
            propertyName: "Show feature#feature:visible",
            name: "Feature visible",
          },
        },
        context: { ...pageContext, revision: 5 },
      },
      runtime,
      "page_welcome",
    );
    expect(renamedProperty).toMatchObject({
      ok: true,
      result: { content: { action: "rename-property", revision: 6 } },
    });

    const resetProperty = await executeDesignToolRequest(
      {
        requestId: "component_reset_property",
        call: {
          toolCallId: "tool_component_reset_property",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "reset-property",
            label: "Reset feature property",
            pageId: "page_welcome",
            instanceId: "feature_instance",
            propertyName: "Feature visible#feature:visible",
          },
        },
        context: { ...pageContext, revision: 6 },
      },
      runtime,
      "page_welcome",
    );
    expect(resetProperty).toMatchObject({
      ok: true,
      result: { content: { action: "reset-property", revision: 7 } },
    });

    const removedProperty = await executeDesignToolRequest(
      {
        requestId: "component_remove_property",
        call: {
          toolCallId: "tool_component_remove_property",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "remove-property",
            label: "Remove feature property",
            pageId: "page_welcome",
            componentId: "component_feature",
            propertyName: "Feature visible#feature:visible",
          },
        },
        context: { ...pageContext, revision: 7 },
      },
      runtime,
      "page_welcome",
    );
    expect(removedProperty).toMatchObject({
      ok: true,
      result: { content: { action: "remove-property", revision: 8 } },
    });

    const detached = await executeDesignToolRequest(
      {
        requestId: "component_detach",
        call: {
          toolCallId: "tool_component_detach",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "detach-instance",
            label: "Detach feature instance",
            pageId: "page_welcome",
            instanceId: "feature_instance",
          },
        },
        context: { ...pageContext, revision: 8 },
      },
      runtime,
      "page_welcome",
    );
    expect(detached.ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.feature_instance?.kind,
    ).not.toBe("instance");

    const removed = await executeDesignToolRequest(
      {
        requestId: "component_remove",
        call: {
          toolCallId: "tool_component_remove",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "remove-component",
            label: "Remove feature component identity",
            pageId: "page_welcome",
            componentId: "component_feature",
          },
        },
        context: { ...pageContext, revision: 9 },
      },
      runtime,
      "page_welcome",
    );
    expect(removed, JSON.stringify(removed)).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "remove-component",
          componentId: "component_feature",
          revision: 10,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.componentsById.component_feature,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById.feature_group?.kind).toBe(
      "group",
    );
  });

  it("reorders inspected ordinary Component properties through one typed action", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const execute = (input: Record<string, unknown>, revision: number) =>
      executeDesignToolRequest(
        {
          requestId: `component_order_${revision}`,
          call: {
            toolCallId: `tool_component_order_${revision}`,
            toolName: DESIGN_COMPONENT_TOOL_NAME,
            input,
          },
          context: { ...pageContext, revision },
        },
        runtime,
        "page_welcome",
      );
    expect(
      await execute(
        {
          action: "create-component",
          label: "Create feature component",
          pageId: "page_welcome",
          rootNodeId: "feature_group",
          componentId: "component_feature",
          name: "Feature",
        },
        0,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await execute(
        {
          action: "add-property",
          label: "Expose first card",
          pageId: "page_welcome",
          componentId: "component_feature",
          propertyId: "feature:first",
          name: "First card",
          type: "BOOLEAN",
          sourceNodeId: "feature_one",
        },
        1,
      ),
    ).toMatchObject({ ok: true });
    expect(
      await execute(
        {
          action: "add-property",
          label: "Expose second card",
          pageId: "page_welcome",
          componentId: "component_feature",
          propertyId: "feature:second",
          name: "Second card",
          type: "BOOLEAN",
          sourceNodeId: "feature_two",
        },
        2,
      ),
    ).toMatchObject({ ok: true });
    const reordered = await execute(
      {
        action: "reorder-properties",
        label: "Prioritize second card",
        pageId: "page_welcome",
        componentId: "component_feature",
        componentRootNodeId: "feature_group",
        componentPropertyOrder: [
          "Second card#feature:second",
          "First card#feature:first",
        ],
      },
      3,
    );
    expect(reordered).toMatchObject({
      ok: true,
      result: { content: { action: "reorder-properties", revision: 4 } },
    });
    expect(
      runtime.getSnapshot().document.componentsById.component_feature
        ?.componentPropertyOrder,
    ).toEqual(["Second card#feature:second", "First card#feature:first"]);
    await expect(
      execute(
        {
          action: "reorder-properties",
          label: "Use stale Component root",
          pageId: "page_welcome",
          componentId: "component_feature",
          componentRootNodeId: "removed_feature_root",
          componentPropertyOrder: [
            "First card#feature:first",
            "Second card#feature:second",
          ],
        },
        4,
      ),
    ).rejects.toThrow(
      "Component component_feature main is outside Page page_welcome",
    );
  });

  it("combines inspected Component roots into one atomic Variant Set", async () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    const source = document.nodesById.feature_one;
    if (frame?.kind !== "frame" || !source) {
      throw new Error("Welcome Component fixture is unavailable");
    }
    frame.childIds.push("feature_hover_group");
    document.nodesById.feature_hover_group = {
      id: "feature_hover_group",
      kind: "group",
      name: "Feature hover",
      parentId: frame.id,
      childIds: ["feature_hover_shape"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 64, 620],
      size: { width: 304, height: 220 },
      exportSettings: [],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    document.nodesById.feature_hover_shape = {
      ...structuredClone(source),
      id: "feature_hover_shape",
      name: "Feature hover surface",
      parentId: "feature_hover_group",
      transform: [1, 0, 0, 1, 0, 0],
    };
    const runtime = new EditorRuntime(document);

    for (const [revision, componentId, nodeId, name] of [
      [0, "feature_default", "feature_group", "Feature default"],
      [1, "feature_hover", "feature_hover_group", "Feature hover"],
    ] as const) {
      const response = await executeDesignToolRequest(
        {
          requestId: `create_${componentId}`,
          call: {
            toolCallId: `tool_create_${componentId}`,
            toolName: DESIGN_COMPONENT_TOOL_NAME,
            input: {
              action: "create-component",
              label: `Create ${name}`,
              pageId: "page_welcome",
              rootNodeId: nodeId,
              componentId,
              name,
            },
          },
          context: { ...pageContext, revision },
        },
        runtime,
        "page_welcome",
      );
      expect(response.ok).toBe(true);
    }

    const combined = await executeDesignToolRequest(
      {
        requestId: "combine_feature_variants",
        call: {
          toolCallId: "tool_combine_feature_variants",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "combine-as-variants",
            label: "Combine feature variants",
            pageId: "page_welcome",
            componentIds: ["feature_default", "feature_hover"],
            componentRootNodeIds: ["feature_group", "feature_hover_group"],
            variantSetId: "feature_set",
            rootNodeId: "feature_set_root",
            name: "Feature",
            variantPropertiesByComponentId: {
              feature_default: { State: "Default" },
              feature_hover: { State: "Hover" },
            },
          },
        },
        context: { ...pageContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );

    expect(combined).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "combine-as-variants",
          componentId: "feature_default",
          mainNodeId: "feature_group",
          revision: 3,
          atomic: true,
        },
        designRevision: { previousRevision: 2, revision: 3 },
      },
    });
    const snapshot = runtime.getSnapshot().document;
    expect(snapshot.variantSetsById.feature_set).toMatchObject({
      rootNodeId: "feature_set_root",
      defaultComponentId: "feature_default",
      componentPropertyDefinitions: {
        State: {
          type: "VARIANT",
          defaultValue: "Default",
          variantOptions: ["Default", "Hover"],
        },
      },
    });
    expect(snapshot.nodesById.feature_set_root?.childIds).toEqual([
      "feature_group",
      "feature_hover_group",
    ]);

    const instance = await executeDesignToolRequest(
      {
        requestId: "place_feature_variant_instance",
        call: {
          toolCallId: "tool_place_feature_variant_instance",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "create-instance",
            label: "Place feature instance",
            pageId: "page_welcome",
            componentId: "feature_default",
            instanceId: "feature_variant_instance",
            parentId: "frame_welcome",
            index: snapshot.nodesById.frame_welcome?.childIds.length ?? 0,
            x: 520,
            y: 620,
          },
        },
        context: { ...pageContext, revision: 3 },
      },
      runtime,
      "page_welcome",
    );
    expect(instance.ok).toBe(true);
    const switched = await executeDesignToolRequest(
      {
        requestId: "switch_feature_variant",
        call: {
          toolCallId: "tool_switch_feature_variant",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "set-property",
            label: "Use hover feature variant",
            pageId: "page_welcome",
            instanceId: "feature_variant_instance",
            propertyName: "State",
            value: "Hover",
          },
        },
        context: { ...pageContext, revision: 4 },
      },
      runtime,
      "page_welcome",
    );
    expect(switched.ok).toBe(true);
    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_feature_variants",
        call: {
          toolCallId: "tool_inspect_feature_variants",
          toolName: "opendesign_inspect_document",
          input: {},
        },
        context: { ...pageContext, revision: 5 },
      },
      runtime,
      "page_welcome",
    );
    expect(inspection).toMatchObject({
      ok: true,
      result: {
        content: {
          document: {
            variantSetsById: {
              feature_set: {
                componentIds: ["feature_default", "feature_hover"],
                defaultComponentId: "feature_default",
              },
            },
            instancesById: {
              feature_variant_instance: {
                componentId: "feature_default",
                resolvedComponentId: "feature_hover",
                componentProperties: {
                  State: { type: "VARIANT", value: "Hover" },
                },
              },
            },
          },
        },
      },
    });

    const duplicated = await executeDesignToolRequest(
      {
        requestId: "duplicate_feature_variant",
        call: {
          toolCallId: "tool_duplicate_feature_variant",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "duplicate-variant",
            label: "Add pressed feature variant",
            pageId: "page_welcome",
            variantSetId: "feature_set",
            rootNodeId: "feature_set_root",
            sourceComponentId: "feature_hover",
            sourceRootNodeId: "feature_hover_group",
            componentId: "feature_pressed",
            componentRootNodeId: "feature_pressed_group",
            variantProperties: { State: "Pressed" },
          },
        },
        context: { ...pageContext, revision: 5 },
      },
      runtime,
      "page_welcome",
    );
    expect(duplicated).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "duplicate-variant",
          revision: 6,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.componentsById.feature_pressed,
    ).toMatchObject({
      variantSetId: "feature_set",
      variantProperties: { State: "Pressed" },
    });

    const removed = await executeDesignToolRequest(
      {
        requestId: "remove_feature_variant",
        call: {
          toolCallId: "tool_remove_feature_variant",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "remove-variant",
            label: "Remove pressed feature variant",
            pageId: "page_welcome",
            variantSetId: "feature_set",
            rootNodeId: "feature_set_root",
            componentId: "feature_pressed",
            componentRootNodeId: "feature_pressed_group",
          },
        },
        context: { ...pageContext, revision: 6 },
      },
      runtime,
      "page_welcome",
    );
    expect(removed).toMatchObject({
      ok: true,
      result: { content: { action: "remove-variant", revision: 7 } },
    });
    expect(
      runtime.getSnapshot().document.componentsById.feature_pressed
        ?.variantSetId,
    ).toBeUndefined();

    const matrix = await executeDesignToolRequest(
      {
        requestId: "add_feature_size_matrix",
        call: {
          toolCallId: "tool_add_feature_size_matrix",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "add-variant-property",
            label: "Add feature size property",
            pageId: "page_welcome",
            variantSetId: "feature_set",
            rootNodeId: "feature_set_root",
            propertyName: "Size",
            valuesByComponentId: {
              feature_default: "Small",
              feature_hover: "Large",
            },
            index: 0,
          },
        },
        context: { ...pageContext, revision: 7 },
      },
      runtime,
      "page_welcome",
    );
    expect(matrix).toMatchObject({
      ok: true,
      result: { content: { action: "add-variant-property", revision: 8 } },
    });

    const edited = await executeDesignToolRequest(
      {
        requestId: "edit_feature_hover_matrix",
        call: {
          toolCallId: "tool_edit_feature_hover_matrix",
          toolName: DESIGN_COMPONENT_TOOL_NAME,
          input: {
            action: "set-variant-properties",
            label: "Rename hover feature combination",
            pageId: "page_welcome",
            variantSetId: "feature_set",
            rootNodeId: "feature_set_root",
            componentId: "feature_hover",
            componentRootNodeId: "feature_hover_group",
            variantProperties: { Size: "Large", State: "Hovered" },
          },
        },
        context: { ...pageContext, revision: 8 },
      },
      runtime,
      "page_welcome",
    );
    expect(edited).toMatchObject({
      ok: true,
      result: { content: { action: "set-variant-properties", revision: 9 } },
    });
    expect(
      runtime.getSnapshot().document.variantSetsById.feature_set,
    ).toMatchObject({ propertyOrder: ["Size", "State"] });
    expect(
      resolveComponentInstance(
        runtime.getSnapshot().document,
        "feature_variant_instance",
      ),
    ).toMatchObject({ ok: true, componentId: "feature_hover" });
  });

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
    expect(createdPageId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
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

    const cleared = await executeDesignToolRequest(
      {
        requestId: "page_clear_current",
        call: {
          toolCallId: "tool_page_clear_current",
          toolName: DESIGN_PAGE_TOOL_NAME,
          input: {
            action: "clear",
            label: "Clear current Page",
            pageId: "page_welcome",
          },
        },
        context: { ...pageContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(cleared).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "clear",
          pageId: "page_welcome",
          revision: 3,
          atomic: true,
        },
        designRevision: { previousRevision: 2, revision: 3 },
      },
    });
    expect(runtime.getSnapshot().document.pagesById.page_welcome).toMatchObject(
      { name: "Homepage", rootNodeIds: [] },
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(3);

    const clearedAgain = await executeDesignToolRequest(
      {
        requestId: "page_clear_current_again",
        call: {
          toolCallId: "tool_page_clear_current_again",
          toolName: DESIGN_PAGE_TOOL_NAME,
          input: {
            action: "clear",
            label: "Clear current Page again",
            pageId: "page_welcome",
          },
        },
        context: { ...pageContext, revision: 3 },
      },
      runtime,
      "page_welcome",
    );
    expect(clearedAgain).toMatchObject({
      ok: true,
      result: {
        observedRevision: 3,
        content: {
          action: "clear",
          pageId: "page_welcome",
          revision: 3,
          unchanged: true,
        },
      },
    });
    if (!clearedAgain.ok) throw new Error(clearedAgain.error.message);
    expect(clearedAgain.result.designRevision).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(3);

    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.pagesById.page_welcome?.rootNodeIds,
    ).toContain("frame_welcome");
  });

  it("sanitizes provider tool-call separators before persisting host Page IDs", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const created = await executeDesignToolRequest(
      {
        requestId: "page_create_provider_id",
        call: {
          toolCallId: "call_page|fc_provider/id",
          toolName: DESIGN_PAGE_TOOL_NAME,
          input: {
            action: "create",
            label: "Create design system Page",
            name: "Design System",
          },
        },
        context: {
          ...pageContext,
          mutationTarget: { kind: "document" as const },
        },
      },
      runtime,
      "page_welcome",
    );

    expect(created).toMatchObject({ ok: true });
    if (!created.ok || typeof created.result.content !== "object") return;
    const pageId = (created.result.content as { pageId: string }).pageId;
    expect(pageId).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    expect(pageId).not.toContain("|");
    expect(pageId).not.toContain("/");
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

  it("lets the Agent create measured Auto Width text without estimating bounds", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      textLayoutProvider: memoizeTextLayoutProvider({
        id: "test-text-layout",
        version: "1",
        measure: (request) => ({
          ok: true,
          provider: "test-text-layout",
          providerVersion: "1",
          size: { width: request.content.length * 14, height: 36 },
          warnings: [],
        }),
      }),
    });
    const frame = runtime.getSnapshot().document.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    const content = "Measured by the host";

    const response = await executeDesignToolRequest(
      {
        requestId: "apply_auto_width_text",
        call: {
          toolCallId: "tool_auto_width_text",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Add Auto Width heading",
            commands: [
              {
                commandId: "insert_auto_width_heading",
                type: "insert_element",
                pageId: "page_welcome",
                parentId: frame.id,
                index: frame.childIds.length,
                node: {
                  id: "agent_auto_heading",
                  kind: "text",
                  name: "Auto heading",
                  parentId: frame.id,
                  childIds: [],
                  visible: true,
                  locked: false,
                  transform: [1, 0, 0, 1, 64, 620],
                  size: { width: 1, height: 1 },
                  exportSettings: [],
                  opacity: 1,
                  properties: {
                    content,
                    fontFamily: "Inter, sans-serif",
                    fontStyleName: null,
                    fontSize: 28,
                    fontWeight: 700,
                    fontSlant: "normal",
                    lineHeight: 36,
                    letterSpacing: 0,
                    paragraphIndent: 0,
                    paragraphSpacing: 0,
                    listSpacing: 0,
                    hangingList: false,
                    textCase: "original",
                    textDecoration: "none",
                    textAlignHorizontal: "left",
                    textAlignVertical: "top",
                    textResize: "auto-width",
                    textWrap: "none",
                    textOverflow: "visible",
                    textTruncation: "disabled",
                    maxLines: null,
                    fills: [{ type: "solid", color: "#151515", opacity: 1 }],
                    strokes: [],
                    strokeWidth: 0,
                  },
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
      { stageDelayMs: 0 },
    );

    expect(response).toMatchObject({
      ok: true,
      result: {
        content: {
          warnings: [],
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.agent_auto_heading,
    ).toMatchObject({
      size: { width: content.length * 14, height: 36 },
      properties: { textResize: "auto-width" },
    });
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

  it("stages a new Design File image asset across unrelated revision changes", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    expect(
      runtime.apply({
        transactionId: "transaction_user_before_asset_stage",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Edit while image generation is running",
        commands: [
          {
            commandId: "rename_before_asset_stage",
            type: "update_properties",
            nodeId: "feature_one",
            name: "Preserved user edit",
          },
        ],
      }).ok,
    ).toBe(true);
    const assetId = `asset_${"a".repeat(64)}`;
    const staged = await executeDesignToolRequest(
      {
        requestId: "stage_generated_asset",
        call: {
          toolCallId: "tool_stage_generated_asset",
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: "Add generated image to Design File assets",
            executionMode: "atomic",
            commands: [
              {
                commandId: "put_generated_asset",
                type: "put_asset",
                asset: {
                  id: assetId,
                  kind: "image",
                  name: "Generated hero.png",
                  mimeType: "image/png",
                  source: { type: "data", value: "aGVsbG8=" },
                  size: { width: 1536, height: 1024 },
                  extensions: {
                    generatedBy: "opendesign-agent",
                    designRole: "hero",
                    staged: true,
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
    );
    expect(staged).toMatchObject({
      ok: true,
      result: {
        designRevision: { previousRevision: 1, revision: 2 },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Preserved user edit",
    );

    const inspection = await executeDesignToolRequest(
      {
        requestId: "inspect_staged_asset",
        call: {
          toolCallId: "tool_inspect_staged_asset",
          toolName: DESIGN_INSPECT_TOOL_NAME,
          input: {},
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(inspection).toMatchObject({
      ok: true,
      result: {
        observedRevision: 2,
        content: {
          document: {
            assetsById: {
              [assetId]: {
                id: assetId,
                size: { width: 1536, height: 1024 },
                availability: "design-file",
                generated: true,
                designRole: "hero",
              },
            },
          },
        },
      },
    });

    await expect(
      executeDesignToolRequest(
        {
          requestId: "overwrite_staged_asset_from_stale_revision",
          call: {
            toolCallId: "tool_overwrite_staged_asset",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Overwrite generated image",
              executionMode: "atomic",
              commands: [
                {
                  commandId: "overwrite_generated_asset",
                  type: "put_asset",
                  asset: {
                    id: assetId,
                    kind: "image",
                    name: "Conflicting image.png",
                    mimeType: "image/png",
                    source: { type: "data", value: "Y29uZmxpY3Q=" },
                    size: { width: 512, height: 512 },
                    extensions: { generatedBy: "opendesign-agent" },
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
    ).rejects.toThrow("expected 0, current 2");
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
              exportSettings: [],
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
      document: {
        fontAvailability: [
          {
            fontFamily: "Inter",
            fontStyleName: "Semi Bold",
            fontWeight: 600,
            fontSlant: "normal",
            nodeCount: 2,
            nodeIds: ["subtitle_welcome", "title_welcome"],
            nodeIdsTruncated: false,
            status: "unknown",
          },
        ],
        fontAvailabilitySummary: {
          requestCount: 1,
          returnedRequestCount: 1,
          truncated: false,
        },
      },
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
            textLayoutQuality: {
              version: 1,
              documentId: "document_welcome",
              revision: 0,
              pageId: "page_welcome",
              measurements: [
                {
                  status: "measured",
                  nodeId: "title_welcome",
                  provider: "test-text",
                  providerVersion: "1",
                  boxSize: { width: 720, height: 72 },
                  fullContentSize: { width: 720, height: 72 },
                  displayedContentSize: { width: 720, height: 72 },
                  overflow: { horizontal: false, vertical: false },
                  truncated: false,
                },
                {
                  status: "measured",
                  nodeId: "subtitle_welcome",
                  provider: "test-text",
                  providerVersion: "1",
                  boxSize: { width: 650, height: 62 },
                  fullContentSize: { width: 650, height: 62 },
                  displayedContentSize: { width: 650, height: 62 },
                  overflow: { horizontal: false, vertical: false },
                  truncated: false,
                },
              ],
            },
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
            version: 6,
            documentId: "document_welcome",
            revision: 0,
            pageId: "page_welcome",
            artboardFrameId: "frame_welcome",
            checkedTextNodeCount: 2,
            errorCount: 0,
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
      exportSettings: [],
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
      exportSettings: [],
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
                  exportSettings: [],
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
                  exportSettings: [],
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
                  exportSettings: [],
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
                    exportSettings: [],
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
          exportSettings: [],
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
            exportSettings: [],
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

    const filterResponse = await executeDesignToolRequest(
      {
        requestId: "adjust_image",
        call: {
          toolCallId: "tool_adjust_image",
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: {
            action: "set-filters",
            label: "Balance hero image",
            pageId: "page_welcome",
            nodeId: "hero_image",
            filters: {
              exposure: 0.15,
              saturation: -0.2,
              highlights: -0.3,
            },
          },
        },
        context: { ...selectionContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(filterResponse).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-filters",
          nodeId: "hero_image",
          revision: 3,
          atomic: true,
        },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.hero_image).toMatchObject({
      properties: {
        filters: {
          exposure: 0.15,
          saturation: -0.2,
          highlights: -0.3,
        },
      },
    });
    await expect(
      executeDesignToolRequest(
        {
          requestId: "bypass_image_adjustment",
          call: {
            toolCallId: "tool_bypass_image_adjustment",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass image workflow",
              commands: [
                {
                  commandId: "bypass_image_filters",
                  type: "update_properties",
                  nodeId: "hero_image",
                  properties: { filters: { contrast: 0.5 } },
                },
              ],
            },
          },
          context: { ...selectionContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("image_update_requires_image_tool");

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
        context: { ...selectionContext, revision: 3 },
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
          revision: 4,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.assetsById[oldAssetId],
    ).toBeUndefined();
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(4);
  });

  it("updates one inspected image paint and blocks generic filter rewrites", async () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.asset_photo = {
      id: "asset_photo",
      kind: "image",
      name: "Photo",
      mimeType: "image/png",
      source: { type: "data", value: "cGhvdG8=" },
      size: { width: 640, height: 480 },
      extensions: {},
    };
    const node = document.nodesById.feature_one;
    if (!node || node.kind !== "rectangle") throw new Error("Missing fixture");
    node.properties.fills = [
      { type: "solid", color: "#ffffff", opacity: 0.5 },
      {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
      },
    ];
    const runtime = new EditorRuntime(document);
    const response = await executeDesignToolRequest(
      {
        requestId: "adjust_image_paint",
        call: {
          toolCallId: "tool_adjust_image_paint",
          toolName: INTERNAL_UPDATE_IMAGE_TOOL_NAME,
          input: {
            action: "set-paint-filters",
            label: "Balance card photo",
            pageId: "page_welcome",
            nodeId: "feature_one",
            paintField: "fills",
            paintIndex: 1,
            expectedPaint: {
              type: "image",
              assetId: "asset_photo",
              fit: "cover",
              opacity: 1,
            },
            filters: { contrast: 0.25, shadows: -0.3 },
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
          action: "set-paint-filters",
          paintField: "fills",
          paintIndex: 1,
          assetId: "asset_photo",
          filters: { contrast: 0.25, shadows: -0.3 },
          revision: 1,
        },
      },
    });

    await expect(
      executeDesignToolRequest(
        {
          requestId: "bypass_image_paint",
          call: {
            toolCallId: "tool_bypass_image_paint",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass image paint workflow",
              commands: [
                {
                  commandId: "bypass_image_paint",
                  type: "update_properties",
                  nodeId: "feature_one",
                  properties: {
                    fills: [
                      { type: "solid", color: "#ffffff", opacity: 0.5 },
                      {
                        type: "image",
                        assetId: "asset_photo",
                        fit: "cover",
                        opacity: 1,
                        filters: { exposure: 0.5 },
                      },
                    ],
                  },
                },
              ],
            },
          },
          context: { ...selectionContext, revision: 1 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("image_paint_update_requires_image_tool");
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
            exportSettings: [],
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
    const onCanvasWait = vi.fn();
    const onProgress =
      vi.fn<
        (
          phase: "accepted" | "applying" | "capturing" | "persisting",
          progress: number,
          message?: string,
        ) => void
      >();
    const response = executeDesignToolRequest(
      {
        requestId: "apply_progressive",
        call: {
          toolCallId: "tool_progressive",
          toolName: "opendesign_apply_transaction",
          input: {
            label: "Refine selected card progressively",
            steps: [
              {
                stepId: "structure",
                label: "Update card structure",
                commandIds: ["progressive_name_first"],
              },
              {
                stepId: "finish",
                label: "Finish card treatment",
                commandIds: [
                  "progressive_opacity",
                  "progressive_size",
                  "progressive_name_final",
                ],
              },
            ],
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
      { onCanvasWait, onProgress },
    );

    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Visible first stage",
    );

    const completed = await response;
    expect(completed).toMatchObject({
      ok: true,
      result: {
        content: {
          revision: 2,
          stages: 2,
          committedSteps: [
            {
              stepIds: ["structure"],
              label: "Update card structure",
              revision: 1,
            },
            {
              stepIds: ["finish"],
              label: "Finish card treatment",
              revision: 2,
            },
          ],
        },
        designRevision: { previousRevision: 0, revision: 2 },
      },
    });
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Finished card",
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(onCanvasWait).toHaveBeenCalledTimes(1);
    expect(onCanvasWait.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(0);
    expect(onCanvasWait.mock.calls[0]?.[1]).toBe(0);
    const progressMessages = onProgress.mock.calls.flatMap((call) =>
      call[2] === undefined ? [] : [call[2]],
    );
    expect(progressMessages).toEqual([
      "设计步骤：Update card structure · r1",
      "设计步骤：Finish card treatment · r2",
    ]);

    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.name).toBe(
      "Structured editing",
    );
  });

  it("allocates many real artboard roots atomically in one revision and undo entry", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const base = runtime.getSnapshot().document;
    const targets = Array.from({ length: 12 }, (_, index) => ({
      frameId: `allocated_frame_${index + 1}`,
      x: 1_280 + (index % 4) * 420,
      y: Math.floor(index / 4) * 900,
    }));
    const response = await executeDesignToolRequest(
      {
        requestId: "allocate_12_artboards",
        call: {
          toolCallId: "tool_allocate_12_artboards",
          toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
          input: {
            label: "Allocate 12 planned artboards",
            executionMode: "atomic",
            commands: targets.map((target, index) => ({
              commandId: `allocate_${target.frameId}`,
              type: "insert_element" as const,
              pageId: "page_welcome",
              parentId: null,
              index: base.pagesById.page_welcome.rootNodeIds.length + index,
              node: {
                id: target.frameId,
                kind: "frame" as const,
                name: `Screen ${index + 1}`,
                parentId: null,
                childIds: [],
                visible: true,
                locked: false,
                transform: [1, 0, 0, 1, target.x, target.y] as const,
                size: { width: 390, height: 844 },
                exportSettings: [],
                opacity: 1,
                properties: {
                  fills: [
                    { type: "solid" as const, color: "#ffffff", opacity: 1 },
                  ],
                  strokes: [],
                  strokeWidth: 0,
                  cornerRadius: 0,
                  clipsContent: true,
                },
                extensions: { agentTargetId: `target_${index + 1}` },
              },
            })),
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
        content: { revision: 1, stages: 1 },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const allocated = runtime.getSnapshot();
    expect(allocated.state.history.undo).toHaveLength(1);
    expect(
      targets.every(
        (target) =>
          allocated.document.nodesById[target.frameId]?.kind === "frame",
      ),
    ).toBe(true);
    expect(runtime.undo()).toMatchObject({ ok: true });
    expect(
      targets.every(
        (target) =>
          runtime.getSnapshot().document.nodesById[target.frameId] ===
          undefined,
      ),
    ).toBe(true);
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
            steps: [
              {
                stepId: "temporary",
                label: "Apply temporary card structure",
                commandIds: ["cancelled_name_first"],
              },
              {
                stepId: "finish",
                label: "Finish cancelled treatment",
                commandIds: [
                  "cancelled_opacity",
                  "cancelled_size",
                  "cancelled_name_final",
                ],
              },
            ],
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

  it("creates, changes, and removes a contained sibling mask without reading live selection", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    runtime.setSelection(["feature_three"], "feature_three");
    const before = runtime.getSnapshot().document;
    const titleWorld = getWorldTransform(before, "title_welcome");
    const subtitleWorld = getWorldTransform(before, "subtitle_welcome");

    const created = await executeDesignToolRequest(
      {
        requestId: "hierarchy_create_mask",
        call: {
          toolCallId: "tool_hierarchy_create_mask",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "create-mask",
            label: "Mask welcome subtitle",
            pageId: "page_welcome",
            nodeIds: ["subtitle_welcome", "title_welcome"],
            groupId: "welcome_mask_group",
            name: "Welcome mask",
            maskType: "alpha",
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
          action: "create-mask",
          atomic: true,
          groupId: "welcome_mask_group",
          maskNodeId: "title_welcome",
          maskType: "alpha",
          childNodeIds: ["title_welcome", "subtitle_welcome"],
          revision: 1,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.maskMode,
    ).toBe("alpha");
    expect(
      getWorldTransform(runtime.getSnapshot().document, "title_welcome"),
    ).toEqual(titleWorld);
    expect(
      getWorldTransform(runtime.getSnapshot().document, "subtitle_welcome"),
    ).toEqual(subtitleWorld);

    const changed = await executeDesignToolRequest(
      {
        requestId: "hierarchy_set_mask_type",
        call: {
          toolCallId: "tool_hierarchy_set_mask_type",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "set-mask-type",
            label: "Use vector welcome mask",
            pageId: "page_welcome",
            maskNodeId: "title_welcome",
            maskType: "vector",
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
          action: "set-mask-type",
          maskNodeId: "title_welcome",
          maskType: "vector",
          revision: 2,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.maskMode,
    ).toBe("outline");

    const removed = await executeDesignToolRequest(
      {
        requestId: "hierarchy_remove_mask",
        call: {
          toolCallId: "tool_hierarchy_remove_mask",
          toolName: DESIGN_HIERARCHY_TOOL_NAME,
          input: {
            action: "remove-mask",
            label: "Remove welcome mask",
            pageId: "page_welcome",
            maskNodeId: "title_welcome",
          },
        },
        context: { ...selectionContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(removed).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "remove-mask",
          maskNodeId: "title_welcome",
          revision: 3,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.welcome_mask_group,
    ).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.maskMode,
    ).toBe("none");
    expect(runtime.getSnapshot().state.selection).toEqual({
      nodeIds: ["feature_three"],
      anchorNodeId: "feature_three",
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(3);
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

  it("edits an explicit vector contour atomically without reading or changing live selection", async () => {
    const runtime = createEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");
    const closed = await executeDesignToolRequest(
      {
        requestId: "vector_close",
        call: {
          toolCallId: "tool_vector_close",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "set-closed",
            closed: true,
            label: "Close the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
          },
        },
        context: selectionContext,
      },
      runtime,
      "page_changed_after_send",
    );

    expect(closed).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-closed",
          atomic: true,
          closed: true,
          nodeId: "editable_logo_contour",
          pageId: "page_welcome",
          pathId: "logo_path",
          revision: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    const beforeReverse = editableVectorNetwork(runtime);

    const reversed = await executeDesignToolRequest(
      {
        requestId: "vector_reverse",
        call: {
          toolCallId: "tool_vector_reverse",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "reverse-path",
            label: "Reverse the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
          },
        },
        context: { ...selectionContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(reversed).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "reverse-path",
          atomic: true,
          closed: true,
          revision: 2,
        },
      },
    });
    expect(editableVectorNetwork(runtime).paths[0]?.segments).toEqual(
      [...(beforeReverse.paths[0]?.segments ?? [])]
        .reverse()
        .map((reference) => ({ ...reference, reversed: !reference.reversed })),
    );
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(editableVectorNetwork(runtime)).toEqual(beforeReverse);
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(editableVectorNetwork(reopened)).toEqual(
      editableVectorNetwork(runtime),
    );
  });

  it("cuts an inspected vector segment atomically and returns trusted topology IDs", async () => {
    const runtime = createEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");
    const result = await executeDesignToolRequest(
      {
        requestId: "vector_cut",
        call: {
          toolCallId: "tool_vector_cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-path",
            at: { kind: "segment", segmentId: "segment_bc", t: 0.25 },
            label: "Cut the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            pathId: "logo_path",
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "cut-path",
          atomic: true,
          closed: false,
          cutVertexIds: ["vertex_edit_1", "vertex_edit_2"],
          nodeId: "editable_logo_contour",
          pageId: "page_welcome",
          pathId: "logo_path",
          pathIds: ["logo_path", "path_edit_1"],
          revision: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(editableVectorNetwork(runtime).paths).toHaveLength(2);
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(editableVectorNetwork(runtime).paths).toHaveLength(1);
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
  });

  it("disconnects and reconnects inspected vector endpoints without model-authored geometry", async () => {
    const runtime = createEditableVectorRuntime();
    const disconnected = await executeDesignToolRequest(
      {
        requestId: "vector_disconnect",
        call: {
          toolCallId: "tool_vector_disconnect",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "disconnect-vertex",
            label: "Disconnect the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            pathId: "logo_path",
            vertexId: "vertex_b",
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(disconnected).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "disconnect-vertex",
          atomic: true,
          cutVertexIds: ["vertex_b", "vertex_edit_1"],
          pathIds: ["logo_path", "path_edit_1"],
          revision: 1,
        },
      },
    });

    const connected = await executeDesignToolRequest(
      {
        requestId: "vector_connect",
        call: {
          toolCallId: "tool_vector_connect",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "connect-endpoints",
            label: "Reconnect the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            vertexIds: ["vertex_b", "vertex_edit_1"],
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(connected).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "connect-endpoints",
          atomic: true,
          pathId: "logo_path",
          revision: 2,
        },
      },
    });
    expect(editableVectorNetwork(runtime).paths).toHaveLength(1);
    expect(editableVectorNetwork(runtime).vertices).toHaveLength(3);
  });

  it("transforms inspected vector points without exposing network rewriting", async () => {
    const runtime = createEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");
    const result = await executeDesignToolRequest(
      {
        requestId: "vector_transform_vertices",
        call: {
          toolCallId: "tool_vector_transform_vertices",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "transform-vertices",
            label: "Move two logo points",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            transform: [1, 0, 0, 1, 20, 10],
            vertexIds: ["vertex_b", "vertex_c"],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "transform-vertices",
          atomic: true,
          nodeId: "editable_logo_contour",
          pathId: "logo_path",
          revision: 1,
        },
      },
    });
    expect(editableVectorNetwork(runtime).vertices).toEqual([
      { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
      { id: "vertex_b", x: 140, y: 10, handleMode: "corner" },
      { id: "vertex_c", x: 80, y: 90, handleMode: "corner" },
    ]);
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("transforms explicit point groups across Vector layers with one document-space transaction", async () => {
    const sourceRuntime = createEditableVectorRuntime();
    const document = structuredClone(sourceRuntime.getSnapshot().document);
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.editable_logo_contour;
    if (!frame || frame.kind !== "frame" || !first) {
      throw new Error("Missing multi-Vector transform fixture");
    }
    const second = structuredClone(first);
    second.id = "editable_logo_shadow";
    second.name = "Editable logo shadow";
    second.transform = [2, 0, 0, 0.5, 220, 40];
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    const runtime = new EditorRuntime(document);
    const result = await executeDesignToolRequest(
      {
        requestId: "vector_transform_layers_vertices",
        call: {
          toolCallId: "tool_vector_transform_layers_vertices",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "transform-layers-vertices",
            label: "Move logo points together",
            pageId: "page_welcome",
            targets: [
              {
                nodeId: "editable_logo_contour",
                vertexIds: ["vertex_b"],
              },
              {
                nodeId: "editable_logo_shadow",
                vertexIds: ["vertex_c"],
              },
            ],
            transform: [1, 0, 0, 1, 20, 10],
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "transform-layers-vertices",
          atomic: true,
          nodeIds: ["editable_logo_contour", "editable_logo_shadow"],
          revision: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(
      editableVectorNetwork(runtime, "editable_logo_contour").vertices,
    ).toContainEqual(
      expect.objectContaining({ id: "vertex_b", x: 140, y: 10 }),
    );
    expect(
      editableVectorNetwork(runtime, "editable_logo_shadow").vertices,
    ).toContainEqual(
      expect.objectContaining({ id: "vertex_c", x: 70, y: 100 }),
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
  });

  it("divides a closed vector with a node-local line into host-named sibling layers", async () => {
    const runtime = createClosedEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");

    const result = await executeDesignToolRequest(
      {
        requestId: "vector_line_cut",
        call: {
          toolCallId: "tool/vector line cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-with-line",
            end: { x: 130, y: 40 },
            label: "Divide the logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            start: { x: -10, y: 40 },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_changed_after_send",
    );

    const resultNodeId = "vector_cut_tool_vector_line_cut_0";
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "cut-with-line",
          atomic: true,
          intersectionCount: 2,
          nodeId: "editable_logo_contour",
          pageId: "page_welcome",
          resultNodeIds: ["editable_logo_contour", resultNodeId],
          revision: 1,
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    const document = runtime.getSnapshot().document;
    const frame = document.nodesById.frame_welcome;
    const extracted = document.nodesById[resultNodeId];
    expect(frame?.kind === "frame" ? frame.childIds : []).toEqual(
      expect.arrayContaining(["editable_logo_contour", resultNodeId]),
    );
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    expect(frame.childIds.indexOf(resultNodeId)).toBe(
      frame.childIds.indexOf("editable_logo_contour") + 1,
    );
    expect(extracted).toMatchObject({
      id: resultNodeId,
      kind: "vector",
      parentId: "frame_welcome",
    });
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById[resultNodeId],
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(
      runtime.getSnapshot().document.nodesById[resultNodeId],
    ).toBeDefined();
  });

  it("moves an uncut compound hole into the Agent-created sibling layer", async () => {
    const runtime = createCompoundEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");

    const result = await executeDesignToolRequest(
      {
        requestId: "vector_compound_line_cut",
        call: {
          toolCallId: "tool/vector compound line cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-with-line",
            end: { x: 130, y: 20 },
            label: "Divide the compound logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            start: { x: -10, y: 20 },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    const resultNodeId = "vector_cut_tool_vector_compound_line_cut_0";
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "cut-with-line",
          atomic: true,
          intersectionCount: 2,
          resultNodeIds: ["editable_logo_contour", resultNodeId],
          revision: 1,
        },
      },
    });
    const retained = editableVectorNetwork(runtime);
    const extracted = runtime.getSnapshot().document.nodesById[resultNodeId];
    if (
      !extracted ||
      extracted.kind !== "vector" ||
      !("network" in extracted.properties)
    ) {
      throw new Error("Missing Agent compound Cut result");
    }
    expect(retained.regions[0]?.loops).toEqual([
      { pathId: "logo_path", reversed: false },
    ]);
    expect(extracted.properties.network.paths.map((path) => path.id)).toEqual([
      "path_edit_1",
      "logo_hole_path",
    ]);
    expect(extracted.properties.network.regions[0]?.loops).toEqual([
      { pathId: "path_edit_1", reversed: false },
      { pathId: "logo_hole_path", reversed: true },
    ]);
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById[resultNodeId],
    ).toBeUndefined();

    const crossedRuntime = createCompoundEditableVectorRuntime();
    const crossed = await executeDesignToolRequest(
      {
        requestId: "vector_crossed_hole_cut",
        call: {
          toolCallId: "tool_vector_crossed_hole_cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-with-line",
            end: { x: 130, y: 45 },
            label: "Cut through the compound logo hole",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            start: { x: -10, y: 45 },
          },
        },
        context: pageContext,
      },
      crossedRuntime,
      "page_welcome",
    );
    const crossedResultNodeId = "vector_cut_tool_vector_crossed_hole_cut_0";
    expect(crossed).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "cut-with-line",
          atomic: true,
          intersectionCount: 4,
          resultNodeIds: ["editable_logo_contour", crossedResultNodeId],
          revision: 1,
        },
      },
    });
    for (const nodeId of ["editable_logo_contour", crossedResultNodeId]) {
      const node = crossedRuntime.getSnapshot().document.nodesById[nodeId];
      if (!node || node.kind !== "vector" || !("network" in node.properties)) {
        throw new Error("Missing crossed-hole Agent Cut result");
      }
      expect(node.properties.network.paths).toHaveLength(1);
      expect(node.properties.network.regions).toHaveLength(1);
      expect(node.properties.network.regions[0]?.loops).toEqual([
        expect.objectContaining({ reversed: false }),
      ]);
    }
    expect(crossedRuntime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("extracts a concave four-crossing design into one host-created sibling", async () => {
    const runtime = createConcaveEditableVectorRuntime();
    runtime.setSelection(["title_welcome"], "title_welcome");
    const result = await executeDesignToolRequest(
      {
        requestId: "vector_concave_line_cut",
        call: {
          toolCallId: "tool/vector concave line cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-with-line",
            end: { x: 120, y: 50 },
            label: "Divide the concave logo contour",
            nodeId: "editable_logo_contour",
            pageId: "page_welcome",
            start: { x: -20, y: 50 },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    const resultNodeId = "vector_cut_tool_vector_concave_line_cut_0";
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          atomic: true,
          extractedPathIds: ["path_edit_1", "path_edit_2"],
          intersectionCount: 4,
          retainedPathIds: ["path_concave"],
          resultNodeIds: ["editable_logo_contour", resultNodeId],
          revision: 1,
        },
      },
    });
    const retained = editableVectorNetwork(runtime);
    const extracted = runtime.getSnapshot().document.nodesById[resultNodeId];
    expect(retained.paths.map((path) => path.id)).toEqual(["path_concave"]);
    if (
      !extracted ||
      extracted.kind !== "vector" ||
      !("network" in extracted.properties)
    ) {
      throw new Error("Missing concave Agent Cut result");
    }
    expect(extracted.properties.network.paths.map((path) => path.id)).toEqual([
      "path_edit_1",
      "path_edit_2",
    ]);
    expect(extracted.properties.network.regions).toHaveLength(2);
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("divides multiple explicit Vector layers with one document-space line and one undo step", async () => {
    const sourceRuntime = createClosedEditableVectorRuntime();
    const document = structuredClone(sourceRuntime.getSnapshot().document);
    const frame = document.nodesById.frame_welcome;
    const first = document.nodesById.editable_logo_contour;
    const openSource =
      createEditableVectorRuntime().getSnapshot().document.nodesById
        .editable_logo_contour;
    if (!frame || frame.kind !== "frame" || !first || !openSource) {
      throw new Error("Missing multi-Vector Cut fixture");
    }
    const second = structuredClone(openSource);
    second.id = "editable_logo_shadow";
    second.name = "Editable logo shadow";
    second.transform = [1, 0, 0, 1, 220, 40];
    document.nodesById[second.id] = second;
    frame.childIds.push(second.id);
    const runtime = new EditorRuntime(document);
    runtime.setSelection(["title_welcome"], "title_welcome");

    const result = await executeDesignToolRequest(
      {
        requestId: "vector_layer_line_cut",
        call: {
          toolCallId: "tool/vector layer line cut",
          toolName: DESIGN_VECTOR_TOOL_NAME,
          input: {
            action: "cut-layers-with-line",
            end: { x: 450, y: 144 },
            label: "Divide both logo contours",
            nodeIds: ["editable_logo_contour", "editable_logo_shadow"],
            pageId: "page_welcome",
            start: { x: 100, y: 144 },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_changed_after_send",
    );

    const firstResultId = "vector_cut_tool_vector_layer_line_cut_0_0";
    const secondResultId = "vector_cut_tool_vector_layer_line_cut_1_0";
    expect(result).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "cut-layers-with-line",
          atomic: true,
          nodeIds: ["editable_logo_contour", "editable_logo_shadow"],
          resultNodeIds: [
            "editable_logo_contour",
            firstResultId,
            "editable_logo_shadow",
            secondResultId,
          ],
          revision: 1,
          targets: [
            {
              intersectionCount: 2,
              nodeId: "editable_logo_contour",
              resultNodeId: firstResultId,
            },
            {
              intersectionCount: 1,
              nodeId: "editable_logo_shadow",
              resultNodeId: secondResultId,
            },
          ],
        },
        designRevision: { previousRevision: 0, revision: 1 },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById[firstResultId],
    ).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById[secondResultId],
    ).toBeDefined();
    const secondRetained =
      runtime.getSnapshot().document.nodesById.editable_logo_shadow;
    const secondExtracted =
      runtime.getSnapshot().document.nodesById[secondResultId];
    for (const node of [secondRetained, secondExtracted]) {
      if (!node || node.kind !== "vector" || !("network" in node.properties)) {
        throw new Error("Missing divided open Vector fixture");
      }
      expect(node.properties.network.paths.every((path) => !path.closed)).toBe(
        true,
      );
      expect(node.properties.network.regions).toEqual([]);
    }
    expect(runtime.getSnapshot().state.selection.nodeIds).toEqual([
      "title_welcome",
    ]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById[firstResultId],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById[secondResultId],
    ).toBeUndefined();
  });

  it("rejects no-op, locked, out-of-scope, and stale Agent vector edits", async () => {
    const noOpRuntime = createEditableVectorRuntime();
    await expect(
      executeDesignToolRequest(
        {
          requestId: "vector_noop",
          call: {
            toolCallId: "tool_vector_noop",
            toolName: DESIGN_VECTOR_TOOL_NAME,
            input: {
              action: "set-closed",
              closed: false,
              label: "Keep the contour open",
              nodeId: "editable_logo_contour",
              pageId: "page_welcome",
            },
          },
          context: pageContext,
        },
        noOpRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("vector-edit.no-op");
    expect(noOpRuntime.getSnapshot().document.revision).toBe(0);

    await expect(
      executeDesignToolRequest(
        {
          requestId: "vector_stale_segment",
          call: {
            toolCallId: "tool_vector_stale_segment",
            toolName: DESIGN_VECTOR_TOOL_NAME,
            input: {
              action: "cut-path",
              at: { kind: "segment", segmentId: "missing_segment", t: 0.5 },
              label: "Cut the logo contour",
              nodeId: "editable_logo_contour",
              pageId: "page_welcome",
              pathId: "logo_path",
            },
          },
          context: pageContext,
        },
        createEditableVectorRuntime(),
        "page_welcome",
      ),
    ).rejects.toThrow("vector-edit.not-found");

    const lockedRuntime = createEditableVectorRuntime();
    const lockedDocument = structuredClone(
      lockedRuntime.getSnapshot().document,
    );
    lockedDocument.nodesById.frame_welcome.locked = true;
    const inheritedLockedRuntime = new EditorRuntime(lockedDocument);
    await expect(
      executeDesignToolRequest(
        vectorToolRequest("vector_locked", "page_welcome"),
        inheritedLockedRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("vector-edit.locked");

    const lockedLayerCutRuntime = createClosedEditableVectorRuntime();
    const lockedLayerCutDocument = structuredClone(
      lockedLayerCutRuntime.getSnapshot().document,
    );
    lockedLayerCutDocument.nodesById.editable_logo_contour.locked = true;
    await expect(
      executeDesignToolRequest(
        {
          requestId: "vector_layer_cut_locked",
          call: {
            toolCallId: "tool_vector_layer_cut_locked",
            toolName: DESIGN_VECTOR_TOOL_NAME,
            input: {
              action: "cut-layers-with-line",
              end: { x: 260, y: 144 },
              label: "Divide the locked logo contour",
              nodeIds: ["editable_logo_contour"],
              pageId: "page_welcome",
              start: { x: 100, y: 144 },
            },
          },
          context: pageContext,
        },
        new EditorRuntime(lockedLayerCutDocument),
        "page_welcome",
      ),
    ).rejects.toThrow("vector-edit.locked");

    await expect(
      executeDesignToolRequest(
        vectorToolRequest("vector_wrong_page", "page_other"),
        createEditableVectorRuntime(),
        "page_welcome",
      ),
    ).rejects.toThrow("outside the registered page mutation target");

    const staleRuntime = createEditableVectorRuntime();
    const snapshot = staleRuntime.getSnapshot();
    expect(
      staleRuntime.apply({
        transactionId: "user_changed_before_vector",
        documentId: snapshot.document.documentId,
        baseRevision: snapshot.document.revision,
        actor: { type: "user", id: "local-user" },
        label: "Change before vector edit",
        commands: [
          {
            commandId: "rename_before_vector",
            type: "update_properties",
            nodeId: "title_welcome",
            name: "Changed",
          },
        ],
      }).ok,
    ).toBe(true);
    await expect(
      executeDesignToolRequest(
        vectorToolRequest("vector_stale", "page_welcome"),
        staleRuntime,
        "page_welcome",
      ),
    ).rejects.toThrow("expected 0, current 1");
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

  it("sets constraints and resizes a populated Frame through one Agent transaction", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const constrained = await executeDesignToolRequest(
      {
        requestId: "constraints_set",
        call: {
          toolCallId: "tool_constraints_set",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-constraints",
            label: "Stretch title with screen",
            pageId: "page_welcome",
            nodeId: "title_welcome",
            constraints: { horizontal: "left-right", vertical: "top" },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(constrained).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-constraints",
          nodeId: "title_welcome",
          constraints: { horizontal: "left-right", vertical: "top" },
          atomic: true,
          revision: 1,
        },
      },
    });
    const resized = await executeDesignToolRequest(
      {
        requestId: "constraints_resize",
        call: {
          toolCallId: "tool_constraints_resize",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "resize-frame",
            label: "Resize responsive screen",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            width: 1600,
            height: 900,
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(resized).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "resize-frame",
          frameId: "frame_welcome",
          width: 1600,
          height: 900,
          atomic: true,
          revision: 2,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.size.width,
    ).toBe(1200);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(2);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "constraints_bypass",
          call: {
            toolCallId: "tool_constraints_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass responsive resize",
              commands: [
                {
                  commandId: "bypass_resize",
                  type: "update_properties",
                  nodeId: "frame_welcome",
                  size: { width: 1800, height: 1000 },
                },
              ],
            },
          },
          context: { ...pageContext, revision: 2 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("frame_resize_requires_layout_tool");
    expect(runtime.getSnapshot().document.revision).toBe(2);
  });

  it("repairs trailing delivery overflow through one bounded Agent transaction", async () => {
    const document = structuredClone(createWelcomeDocument());
    const trailing = document.nodesById.feature_three;
    if (!trailing) throw new Error("Missing trailing fixture node");
    trailing.transform = [1, 0, 0, 1, 1_100, 24];
    const runtime = new EditorRuntime(document);

    const repaired = await executeDesignToolRequest(
      {
        requestId: "repair_delivery_overflow",
        call: {
          toolCallId: "tool_repair_delivery_overflow",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "repair-overflow",
            label: "Reveal complete delivery",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );

    expect(repaired).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "repair-overflow",
          nodeIds: ["frame_welcome"],
          atomic: true,
          revision: 1,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.size,
    ).toEqual({ width: 1_336, height: 720 });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("sets Frame Auto Layout through host-derived geometry and one Agent transaction", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "auto_layout_set",
        call: {
          toolCallId: "tool_auto_layout_set",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-auto-layout",
            label: "Create vertical landing flow",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            autoLayout: {
              mode: "vertical",
              padding: { top: 24, right: 32, bottom: 24, left: 32 },
              gap: 16,
              primaryAlignment: "start",
              counterAlignment: "center",
            },
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
          action: "set-auto-layout",
          frameId: "frame_welcome",
          autoLayout: {
            mode: "vertical",
            gap: 16,
            counterAlignment: "center",
          },
          revision: 1,
          atomic: true,
        },
      },
    });
    const document = runtime.getSnapshot().document;
    expect(document.nodesById.frame_welcome).toMatchObject({
      properties: { autoLayout: { mode: "vertical", gap: 16 } },
    });
    expect(document.nodesById.shape_accent?.transform[5]).toBe(24);
    expect(document.nodesById.title_welcome?.transform[5]).toBe(48);
    expect(document.nodesById.subtitle_welcome?.transform[5]).toBe(136);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);

    const sized = await executeDesignToolRequest(
      {
        requestId: "auto_layout_child_fill",
        call: {
          toolCallId: "tool_auto_layout_child_fill",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-layout-sizing",
            label: "Fill title width",
            pageId: "page_welcome",
            nodeId: "title_welcome",
            sizing: { horizontal: "fill", vertical: "fixed" },
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(sized).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-layout-sizing",
          nodeId: "title_welcome",
          sizing: { horizontal: "fill", vertical: "fixed" },
          revision: 2,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutSizing,
    ).toEqual({ horizontal: "fill", vertical: "fixed" });

    const absolute = await executeDesignToolRequest(
      {
        requestId: "auto_layout_child_absolute",
        call: {
          toolCallId: "tool_auto_layout_child_absolute",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-layout-positioning",
            label: "Float title over the flow",
            pageId: "page_welcome",
            nodeId: "title_welcome",
            positioning: "absolute",
            constraints: { horizontal: "right", vertical: "top" },
          },
        },
        context: { ...pageContext, revision: 2 },
      },
      runtime,
      "page_welcome",
    );
    expect(absolute).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-layout-positioning",
          nodeId: "title_welcome",
          positioning: "absolute",
          constraints: { horizontal: "right", vertical: "top" },
          revision: 3,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      layoutPositioning: "absolute",
      constraints: { horizontal: "right", vertical: "top" },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.layoutSizing,
    ).toBeUndefined();

    const invalidLimits = await executeDesignToolRequest(
      {
        requestId: "auto_layout_child_limits",
        call: {
          toolCallId: "tool_auto_layout_child_limits",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-layout-limits",
            label: "Bound absolute title width",
            pageId: "page_welcome",
            nodeId: "title_welcome",
            limits: { minWidth: 240, maxWidth: 720, minHeight: 48 },
          },
        },
        context: { ...pageContext, revision: 3 },
      },
      runtime,
      "page_welcome",
    );
    expect(invalidLimits.ok).toBe(false);
    if (invalidLimits.ok) throw new Error("Absolute limits were accepted");
    expect(invalidLimits.error.message).toContain("flow child");

    await expect(
      executeDesignToolRequest(
        {
          requestId: "auto_layout_bypass",
          call: {
            toolCallId: "tool_auto_layout_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass flow geometry",
              commands: [
                {
                  commandId: "move_flow_child",
                  type: "update_properties",
                  nodeId: "subtitle_welcome",
                  transform: [1, 0, 0, 1, 500, 500],
                },
              ],
            },
          },
          context: { ...pageContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("auto_layout_requires_layout_tool");
    await expect(
      executeDesignToolRequest(
        {
          requestId: "auto_layout_sizing_bypass",
          call: {
            toolCallId: "tool_auto_layout_sizing_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass flow sizing",
              commands: [
                {
                  commandId: "bypass_fill",
                  type: "update_properties",
                  nodeId: "subtitle_welcome",
                  layoutSizing: { horizontal: "fixed", vertical: "fixed" },
                },
              ],
            },
          },
          context: { ...pageContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("set-layout-sizing");
    await expect(
      executeDesignToolRequest(
        {
          requestId: "grid_placement_bypass",
          call: {
            toolCallId: "tool_grid_placement_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass Grid placement",
              commands: [
                {
                  commandId: "bypass_grid_cell",
                  type: "update_properties",
                  nodeId: "subtitle_welcome",
                  gridPlacement: {
                    row: 0,
                    column: 0,
                    rowSpan: 1,
                    columnSpan: 1,
                    horizontalAlign: "auto",
                    verticalAlign: "auto",
                  },
                },
              ],
            },
          },
          context: { ...pageContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("set-grid-placement");
    expect(runtime.getSnapshot().document.revision).toBe(3);
    await expect(
      executeDesignToolRequest(
        {
          requestId: "layout_guides_bypass",
          call: {
            toolCallId: "tool_layout_guides_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass layout guides",
              commands: [
                {
                  commandId: "bypass_layout_guides",
                  type: "update_properties",
                  nodeId: "frame_welcome",
                  properties: {
                    layoutGuides: [
                      {
                        id: "grid_8",
                        type: "grid",
                        size: 8,
                        color: "#ff5a5f",
                        opacity: 0.12,
                      },
                    ],
                  },
                },
              ],
            },
          },
          context: { ...pageContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("set-layout-guides");
    expect(runtime.getSnapshot().document.revision).toBe(3);
    const frameWithGuides = {
      ...runtime.getSnapshot().document.nodesById.frame_welcome,
      id: "frame_with_guides",
      name: "Bypass guide Frame",
      parentId: null,
      childIds: [],
      properties: {
        ...runtime.getSnapshot().document.nodesById.frame_welcome?.properties,
        layoutGuides: [
          {
            id: "grid_16",
            type: "grid" as const,
            size: 16,
            color: "#3366ff",
            opacity: 0.2,
          },
        ],
      },
    };
    for (const [requestId, commands] of [
      [
        "layout_guides_insert_bypass",
        [
          {
            commandId: "insert_frame_with_guides",
            type: "insert_element" as const,
            pageId: "page_welcome",
            parentId: null,
            index: 1,
            node: frameWithGuides,
          },
        ],
      ],
      [
        "layout_guides_replace_bypass",
        [
          {
            commandId: "replace_frame_with_guides",
            type: "replace_subtree" as const,
            rootNodeId: "frame_welcome",
            nodes: [
              {
                ...frameWithGuides,
                id: "frame_welcome",
                name: "Replaced guide Frame",
              },
            ],
          },
        ],
      ],
    ] as const) {
      await expect(
        executeDesignToolRequest(
          {
            requestId,
            call: {
              toolCallId: `tool_${requestId}`,
              toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
              input: { label: "Bypass layout guides", commands },
            },
            context: { ...pageContext, revision: 3 },
          },
          runtime,
          "page_welcome",
        ),
      ).rejects.toThrow("set-layout-guides");
      expect(runtime.getSnapshot().document.revision).toBe(3);
    }

    await expect(
      executeDesignToolRequest(
        {
          requestId: "auto_layout_limits_bypass",
          call: {
            toolCallId: "tool_auto_layout_limits_bypass",
            toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
            input: {
              label: "Bypass limits",
              commands: [
                {
                  commandId: "bypass_limits",
                  type: "update_properties",
                  nodeId: "subtitle_welcome",
                  layoutLimits: { maxWidth: 400 },
                },
              ],
            },
          },
          context: { ...pageContext, revision: 3 },
        },
        runtime,
        "page_welcome",
      ),
    ).rejects.toThrow("set-layout-limits");
    expect(runtime.getSnapshot().document.revision).toBe(3);

    const absoluteNode = {
      ...runtime.getSnapshot().document.nodesById.subtitle_welcome,
      id: "bypass_absolute",
      name: "Bypass absolute",
      parentId: "frame_welcome",
      layoutPositioning: "absolute" as const,
    };
    for (const [requestId, commands] of [
      [
        "auto_layout_positioning_update_bypass",
        [
          {
            commandId: "bypass_positioning_update",
            type: "update_properties" as const,
            nodeId: "subtitle_welcome",
            layoutPositioning: "absolute" as const,
          },
        ],
      ],
      [
        "auto_layout_positioning_insert_bypass",
        [
          {
            commandId: "bypass_positioning_insert",
            type: "insert_element" as const,
            pageId: "page_welcome",
            parentId: "frame_welcome",
            index: 4,
            node: absoluteNode,
          },
        ],
      ],
      [
        "auto_layout_positioning_replace_bypass",
        [
          {
            commandId: "bypass_positioning_replace",
            type: "replace_subtree" as const,
            rootNodeId: "subtitle_welcome",
            nodes: [
              {
                ...absoluteNode,
                id: "subtitle_welcome",
                name: "Replaced subtitle",
              },
            ],
          },
        ],
      ],
    ] as const) {
      await expect(
        executeDesignToolRequest(
          {
            requestId,
            call: {
              toolCallId: `tool_${requestId}`,
              toolName: INTERNAL_DESIGN_APPLY_TOOL_NAME,
              input: { label: "Bypass layout positioning", commands },
            },
            context: { ...pageContext, revision: 3 },
          },
          runtime,
          "page_welcome",
        ),
      ).rejects.toThrow("set-layout-positioning");
      expect(runtime.getSnapshot().document.revision).toBe(3);
    }

    const guides = await executeDesignToolRequest(
      {
        requestId: "layout_guides_set",
        call: {
          toolCallId: "tool_layout_guides_set",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-layout-guides",
            label: "Show 8pt grid",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            layoutGuides: [
              {
                id: "grid_8",
                type: "grid",
                size: 8,
                color: "#ff5a5f",
                opacity: 0.12,
              },
            ],
          },
        },
        context: { ...pageContext, revision: 3 },
      },
      runtime,
      "page_welcome",
    );
    expect(guides).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "set-layout-guides",
          revision: 4,
          atomic: true,
        },
      },
    });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    ).toMatchObject({
      properties: {
        layoutGuides: [
          {
            id: "grid_8",
            type: "grid",
            size: 8,
            color: "#ff5a5f",
            opacity: 0.12,
          },
        ],
      },
    });
  });

  it("sets horizontal Wrap through the Agent tool and derives wrapped child rows", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "auto_layout_wrap",
        call: {
          toolCallId: "tool_auto_layout_wrap",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-auto-layout",
            label: "Wrap landing content",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            autoLayout: {
              mode: "horizontal",
              padding: { top: 24, right: 24, bottom: 24, left: 24 },
              gap: 16,
              primaryAlignment: "start",
              counterAlignment: "start",
              sizing: { horizontal: "fixed", vertical: "hug" },
              wrap: { mode: "wrap", counterGap: 20 },
            },
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
          action: "set-auto-layout",
          frameId: "frame_welcome",
          autoLayout: {
            mode: "horizontal",
            wrap: { mode: "wrap", counterGap: 20 },
          },
          revision: 1,
          atomic: true,
        },
      },
    });
    const document = runtime.getSnapshot().document;
    expect(document.nodesById.frame_welcome).toMatchObject({
      properties: {
        autoLayout: {
          mode: "horizontal",
          sizing: { horizontal: "fixed", vertical: "hug" },
          wrap: { mode: "wrap", counterGap: 20 },
        },
      },
    });
    expect(document.nodesById.subtitle_welcome?.transform[5]).toBeGreaterThan(
      document.nodesById.title_welcome?.transform[5] ?? 0,
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("creates automatic Grid rows and reorders them through one typed Agent transaction", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const automatic = await executeDesignToolRequest(
      {
        requestId: "auto_grid_rows",
        call: {
          toolCallId: "tool_auto_grid_rows",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-auto-layout",
            label: "Create automatic content grid",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            autoLayout: {
              mode: "grid",
              padding: { top: 24, right: 24, bottom: 24, left: 24 },
              rowGap: 16,
              columnGap: 16,
              rows: [{ type: "fill", value: 1 }],
              columns: [
                { type: "fill", value: 1 },
                { type: "fill", value: 1 },
              ],
              itemsPositioning: "row-auto-flow",
              autoTracks: "rows",
              sizing: { horizontal: "fixed", vertical: "fixed" },
            },
          },
        },
        context: pageContext,
      },
      runtime,
      "page_welcome",
    );
    expect(automatic).toMatchObject({
      ok: true,
      result: { content: { action: "set-auto-layout", revision: 1 } },
    });
    const frame = runtime.getSnapshot().document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing welcome frame");
    const grid = frame.properties.autoLayout;
    if (!grid || grid.mode !== "grid") throw new Error("missing Grid layout");
    expect(grid.autoTracks).toBe("rows");
    expect(grid.rows.length).toBeGreaterThan(1);

    const rowCount = grid.rows.length;
    const reordered = await executeDesignToolRequest(
      {
        requestId: "reorder_grid_rows",
        call: {
          toolCallId: "tool_reorder_grid_rows",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "reorder-grid-tracks",
            label: "Move first content row to the end",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            axis: "rows",
            fromIndices: [0],
            insertionIndex: rowCount,
          },
        },
        context: { ...pageContext, revision: 1 },
      },
      runtime,
      "page_welcome",
    );
    expect(reordered).toMatchObject({
      ok: true,
      result: {
        content: {
          action: "reorder-grid-tracks",
          frameId: "frame_welcome",
          axis: "rows",
          revision: 2,
          atomic: true,
        },
      },
    });
    if (!reordered.ok) throw new Error("Expected Grid track reorder result");
    const content = reordered.result.content as { movements?: unknown };
    expect(content.movements).toEqual(
      expect.arrayContaining([{ from: 0, to: rowCount - 1 }]),
    );
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(2);
  });

  it("sets Auto gap through the Agent tool and lets the host derive responsive positions", async () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const response = await executeDesignToolRequest(
      {
        requestId: "auto_layout_auto_gap",
        call: {
          toolCallId: "tool_auto_layout_auto_gap",
          toolName: DESIGN_ARRANGE_TOOL_NAME,
          input: {
            action: "set-auto-layout",
            label: "Distribute navigation content",
            pageId: "page_welcome",
            frameId: "frame_welcome",
            autoLayout: {
              mode: "horizontal",
              padding: { top: 24, right: 32, bottom: 24, left: 32 },
              gap: 16,
              primaryAlignment: "space-between",
              counterAlignment: "center",
            },
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
          action: "set-auto-layout",
          autoLayout: { primaryAlignment: "space-between" },
          revision: 1,
          atomic: true,
        },
      },
    });
    const document = runtime.getSnapshot().document;
    expect(document.nodesById.shape_accent?.transform[4]).toBe(32);
    expect(document.nodesById.subtitle_welcome?.transform[4]).toBeGreaterThan(
      document.nodesById.title_welcome?.transform[4] ?? 0,
    );
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

function createEditableVectorRuntime(): EditorRuntime {
  const document = structuredClone(createWelcomeDocument());
  const frame = document.nodesById.frame_welcome;
  if (!frame || frame.kind !== "frame")
    throw new Error("Missing frame fixture");
  const vector: DesignNode = {
    id: "editable_logo_contour",
    kind: "vector",
    name: "Editable logo contour",
    parentId: frame.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 40, 40],
    size: { width: 120, height: 80 },
    exportSettings: [],
    opacity: 1,
    properties: {
      network: {
        vertices: [
          { id: "vertex_a", x: 0, y: 0, handleMode: "corner" },
          { id: "vertex_b", x: 120, y: 0, handleMode: "corner" },
          { id: "vertex_c", x: 60, y: 80, handleMode: "corner" },
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
          },
        ],
        paths: [
          {
            id: "logo_path",
            closed: false,
            segments: [
              { segmentId: "segment_ab", reversed: false },
              { segmentId: "segment_bc", reversed: false },
            ],
          },
        ],
        regions: [],
      },
      fills: [{ type: "solid", color: "#151515", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
    extensions: {},
  };
  document.nodesById[vector.id] = vector;
  frame.childIds.push(vector.id);
  return new EditorRuntime(document);
}

function createClosedEditableVectorRuntime(): EditorRuntime {
  const runtime = createEditableVectorRuntime();
  const document = structuredClone(runtime.getSnapshot().document);
  const vector = document.nodesById.editable_logo_contour;
  if (
    !vector ||
    vector.kind !== "vector" ||
    !("network" in vector.properties)
  ) {
    throw new Error("Missing editable vector fixture");
  }
  vector.properties.network.segments.push({
    id: "segment_ca",
    startVertexId: "vertex_c",
    endVertexId: "vertex_a",
  });
  const path = vector.properties.network.paths[0];
  if (!path) throw new Error("Missing editable vector path fixture");
  path.segments.push({ segmentId: "segment_ca", reversed: false });
  path.closed = true;
  vector.properties.network.regions = [
    {
      id: "region_logo",
      windingRule: "nonzero",
      loops: [{ pathId: path.id, reversed: false }],
    },
  ];
  return new EditorRuntime(document);
}

function createCompoundEditableVectorRuntime(): EditorRuntime {
  const runtime = createClosedEditableVectorRuntime();
  const document = structuredClone(runtime.getSnapshot().document);
  const vector = document.nodesById.editable_logo_contour;
  if (
    !vector ||
    vector.kind !== "vector" ||
    !("network" in vector.properties)
  ) {
    throw new Error("Missing compound editable vector fixture");
  }
  vector.properties.network.vertices.push(
    { id: "logo_hole_a", x: 40, y: 35, handleMode: "corner" },
    { id: "logo_hole_b", x: 80, y: 35, handleMode: "corner" },
    { id: "logo_hole_c", x: 70, y: 60, handleMode: "corner" },
    { id: "logo_hole_d", x: 50, y: 60, handleMode: "corner" },
  );
  vector.properties.network.segments.push(
    {
      id: "logo_hole_ab",
      startVertexId: "logo_hole_a",
      endVertexId: "logo_hole_b",
    },
    {
      id: "logo_hole_bc",
      startVertexId: "logo_hole_b",
      endVertexId: "logo_hole_c",
    },
    {
      id: "logo_hole_cd",
      startVertexId: "logo_hole_c",
      endVertexId: "logo_hole_d",
    },
    {
      id: "logo_hole_da",
      startVertexId: "logo_hole_d",
      endVertexId: "logo_hole_a",
    },
  );
  vector.properties.network.paths.push({
    id: "logo_hole_path",
    closed: true,
    segments: [
      { segmentId: "logo_hole_ab", reversed: false },
      { segmentId: "logo_hole_bc", reversed: false },
      { segmentId: "logo_hole_cd", reversed: false },
      { segmentId: "logo_hole_da", reversed: false },
    ],
  });
  vector.properties.network.regions[0].loops.push({
    pathId: "logo_hole_path",
    reversed: true,
  });
  return new EditorRuntime(document);
}

function createConcaveEditableVectorRuntime(): EditorRuntime {
  const runtime = createClosedEditableVectorRuntime();
  const document = structuredClone(runtime.getSnapshot().document);
  const vector = document.nodesById.editable_logo_contour;
  if (
    !vector ||
    vector.kind !== "vector" ||
    !("network" in vector.properties)
  ) {
    throw new Error("Missing concave editable vector fixture");
  }
  const points = [
    [0, 0],
    [100, 0],
    [100, 100],
    [70, 100],
    [70, 30],
    [30, 30],
    [30, 100],
    [0, 100],
  ] as const;
  const vertexIds = points.map((_point, index) => `vertex_concave_${index}`);
  const segmentIds = points.map((_point, index) => `segment_concave_${index}`);
  vector.size = { width: 100, height: 100 };
  vector.properties.network = {
    vertices: points.map(([x, y], index) => ({
      id: vertexIds[index],
      x,
      y,
      handleMode: "corner",
    })),
    segments: points.map((_point, index) => ({
      id: segmentIds[index],
      startVertexId: vertexIds[index],
      endVertexId: vertexIds[(index + 1) % vertexIds.length],
    })),
    paths: [
      {
        id: "path_concave",
        closed: true,
        segments: segmentIds.map((segmentId) => ({
          segmentId,
          reversed: false,
        })),
      },
    ],
    regions: [
      {
        id: "region_concave",
        windingRule: "nonzero",
        loops: [{ pathId: "path_concave", reversed: false }],
      },
    ],
  };
  return new EditorRuntime(document);
}

function editableVectorNetwork(
  runtime: EditorRuntime,
  nodeId = "editable_logo_contour",
) {
  const node = runtime.getSnapshot().document.nodesById[nodeId];
  if (!node || node.kind !== "vector" || !("network" in node.properties)) {
    throw new Error("Missing editable vector fixture");
  }
  return node.properties.network;
}

function vectorToolRequest(
  requestId: string,
  pageId: string,
): RendererDesignToolRequest {
  return {
    requestId,
    call: {
      toolCallId: `tool_${requestId}`,
      toolName: DESIGN_VECTOR_TOOL_NAME,
      input: {
        action: "reverse-path",
        label: "Reverse the logo contour",
        nodeId: "editable_logo_contour",
        pageId,
      },
    },
    context: pageContext,
  };
}
