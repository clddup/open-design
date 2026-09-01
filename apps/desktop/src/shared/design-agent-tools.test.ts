import { describe, expect, it } from "vitest";
import { schemaValidationIssues } from "@opendesign/design-contracts";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_SYSTEM_TOOL_NAME,
  INTERNAL_DESIGN_COMPONENT_TOOL_NAME as DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  DesignApplyContract,
  DesignArrangeContract,
  DesignCheckpointContract,
  DesignComponentContract,
  DesignPageContract,
  DesignPlanContract,
  DesignHierarchyContract,
  DesignVisualReviewContract,
  FirstSliceContract,
  designAgentToolInputIssues,
  isAgentSvgImportResult,
  isPreparedAgentSvgExport,
  isPreparedAgentRasterExport,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

function parsedApply(input: unknown) {
  const result = DesignApplyContract.parse(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result.value;
}

function parsedPlan(input: unknown) {
  const result = DesignPlanContract.parse(input);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.issues));
  }
  return result.value;
}

describe("component tool recovery contract", () => {
  it("uses one rootNodeId contract for promoting a Component Main", () => {
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "create-component",
        label: "Promote PanelHeader",
        pageId: "page_editor",
        rootNodeId: "cmp-panel-header-main",
        componentId: "component-panel-header",
        name: "PanelHeader",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "create-component",
        label: "Promote PanelHeader",
        pageId: "page_editor",
        nodeId: "cmp-panel-header-main",
        componentId: "component-panel-header",
        name: "PanelHeader",
      }),
    ).toBe(false);
  });

  it("returns exact create-component field paths from the single contract", () => {
    const issues = DesignComponentContract.issues({
      action: "create-component",
      label: "Promote PanelHeader",
      pageId: "page_editor",
      nodeId: "cmp-panel-header-main",
      componentId: "component-panel-header",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_component.schema_invalid",
          path: "/rootNodeId",
        }),
        expect.objectContaining({
          code: "design_component.schema_invalid",
          path: "/name",
        }),
        expect.objectContaining({
          code: "design_component.schema_invalid",
          path: "/nodeId",
        }),
      ]),
    );
  });
});

describe("design Agent tool contract", () => {
  it("gives every public tool one structured input issue entry", () => {
    expect(
      DESIGN_AGENT_TOOL_SPECS.every(
        (tool) => typeof tool.validateInputIssues === "function",
      ),
    ).toBe(true);
    expect(
      designAgentToolInputIssues(DESIGN_CAPABILITIES_TOOL_NAME, {
        unexpected: true,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_tool.empty_input_invalid",
        path: "/unexpected",
      }),
    );
    expect(designAgentToolInputIssues("opendesign_unknown", {})).toEqual([
      expect.objectContaining({
        code: "design_tool.unknown",
        path: "/",
      }),
    ]);
  });

  it("wires first-slice validation into the production tool definition", () => {
    const firstSlice = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_FIRST_SLICE_TOOL_NAME,
    );
    expect(firstSlice).not.toHaveProperty("explainInvalidInput");
    expect(firstSlice).toHaveProperty(
      "validateInputIssues",
      FirstSliceContract.issues,
    );
  });

  it("wires Checkpoint validation to its single contract entry", () => {
    const checkpoint = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_CHECKPOINT_TOOL_NAME,
    );
    expect(checkpoint).toHaveProperty(
      "validateInputIssues",
      DesignCheckpointContract.issues,
    );
  });

  it("compiles model insert defaults before the trusted design boundary", () => {
    const compactInput = {
      label: "Create poster background",
      commands: [
        {
          commandId: "insert_background",
          type: "insert_element",
          pageId: "page_1",
          parentId: "poster_artboard",
          index: 0,
          node: {
            id: "poster_background",
            name: "Poster background",
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 1200, height: 1600 },
            kind: "rectangle",
            properties: {
              fills: [{ type: "solid", color: "#101820", opacity: 1 }],
            },
          },
        },
        {
          commandId: "insert_status_dot",
          type: "insert_element",
          pageId: "page_1",
          parentId: "poster_artboard",
          index: 1,
          node: {
            id: "status_dot",
            name: "Status dot",
            transform: [1, 0, 0, 1, 24, 24],
            size: { width: 8, height: 8 },
            kind: "ellipse",
            properties: {
              fills: [{ type: "solid", color: "#18B89A", opacity: 1 }],
            },
          },
        },
      ],
    };

    expect(DesignApplyContract.parse(compactInput).ok).toBe(true);
    expect(parsedApply(compactInput)).toMatchObject({
      commands: [
        {
          node: {
            parentId: "poster_artboard",
            childIds: [],
            visible: true,
            locked: false,
            exportSettings: [],
            opacity: 1,
            extensions: {},
            properties: {
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 0,
            },
          },
        },
        {
          node: {
            id: "status_dot",
            properties: {
              strokes: [],
              strokeWidth: 0,
            },
          },
        },
      ],
    });
    expect(
      validateDesignAgentToolInput(
        INTERNAL_DESIGN_APPLY_TOOL_NAME,
        compactInput,
      ),
    ).toBe(false);
  });

  it("compiles every public node kind into the canonical document contract", () => {
    const textProperties = {
      content: "Canonical",
      fontFamily: "Inter",
      fontStyleName: "Regular",
      fontSize: 16,
      fontWeight: 400,
      fontSlant: "normal",
      lineHeight: 24,
      letterSpacing: 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original",
      textDecoration: "none",
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: "left",
      textAlignVertical: "top",
      textResize: "auto-height",
      textWrap: "word",
      textOverflow: "visible",
      textTruncation: "disabled",
      maxLines: null,
    };
    const network = {
      vertices: [
        { id: "v0", x: 0, y: 0 },
        { id: "v1", x: 100, y: 100 },
      ],
      segments: [{ id: "s0", startVertexId: "v0", endVertexId: "v1" }],
      paths: [
        {
          id: "p0",
          closed: false,
          segments: [{ segmentId: "s0", reversed: false }],
        },
      ],
      regions: [],
    };
    const kinds = [
      ["frame", {}],
      ["group", {}],
      ["rectangle", {}],
      ["ellipse", {}],
      [
        "line",
        {
          start: { x: 0, y: 0 },
          end: { x: 1, y: 1 },
          startEndpoint: "none",
          endEndpoint: "none",
        },
      ],
      ["polygon", { pointCount: 5 }],
      ["star", { pointCount: 5, innerRadius: 0.5 }],
      ["text", textProperties],
      [
        "image",
        { assetId: "asset_image", placement: { mode: "stretch" }, altText: "" },
      ],
      ["vector", { path: "M0 0 L100 100" }],
      ["path", { network }],
      ["slice", {}],
    ] as const;
    const input = {
      label: "Compile every public node kind",
      commands: kinds.map(([kind, properties], index) => ({
        commandId: `insert_${kind}_${index}`,
        type: "insert_element",
        pageId: "page_1",
        parentId: "artboard_1",
        index,
        node: {
          id: `node_${kind}_${index}`,
          name: `Node ${kind}`,
          transform: [1, 0, 0, 1, index * 12, index * 12],
          size: { width: 100, height: 100 },
          kind,
          properties,
        },
      })),
    };

    expect(schemaValidationIssues(DesignApplyContract.schema, input)).toEqual(
      [],
    );
    const parsed = DesignApplyContract.parse(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      schemaValidationIssues(DesignApplyContract.internalSchema, parsed.value),
    ).toEqual([]);
  });

  it("rejects cross-kind node and Paint fields before canonical compilation", () => {
    const issues = DesignApplyContract.issues({
      label: "Reject ambiguous model structure",
      commands: [
        {
          commandId: "insert_group",
          type: "insert_element",
          pageId: "page_1",
          parentId: "artboard_1",
          index: 0,
          node: {
            id: "group_1",
            name: "Group",
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 100, height: 100 },
            kind: "group",
            properties: {
              fills: [
                {
                  type: "solid",
                  color: "#FFFFFF",
                  opacity: 1,
                  stops: [
                    { offset: 0, color: "#FFFFFF", opacity: 1 },
                    { offset: 1, color: "#000000", opacity: 1 },
                  ],
                },
              ],
            },
          },
        },
      ],
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "design_apply.node_property_not_supported",
          path: "/commands/0/node/properties/fills",
        }),
        expect.objectContaining({
          code: "design_apply.paint_property_not_supported",
          path: "/commands/0/node/properties/fills/0/stops",
        }),
      ]),
    );
  });

  it("compiles every public Paint branch without a second structural failure", () => {
    const stops = [
      { offset: 0, color: "#FFFFFF", opacity: 1 },
      { offset: 1, color: "#000000", opacity: 1 },
    ];
    const input = {
      label: "Compile Paint branches",
      commands: [
        {
          commandId: "insert_paint_specimen",
          type: "insert_element",
          pageId: "page_1",
          parentId: "artboard_1",
          index: 0,
          node: {
            id: "paint_specimen",
            name: "Paint specimen",
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 100, height: 100 },
            kind: "rectangle",
            properties: {
              fills: [
                { type: "solid", color: "#FFFFFF", opacity: 1 },
                { type: "linear-gradient", stops, opacity: 1 },
                { type: "radial-gradient", stops, opacity: 1 },
                { type: "angular-gradient", stops, opacity: 1 },
                {
                  type: "image",
                  assetId: "asset_paint",
                  fit: "cover",
                  opacity: 1,
                },
              ],
            },
          },
        },
      ],
    };

    expect(schemaValidationIssues(DesignApplyContract.schema, input)).toEqual(
      [],
    );
    const parsed = DesignApplyContract.parse(input);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(
      schemaValidationIssues(DesignApplyContract.internalSchema, parsed.value),
    ).toEqual([]);
  });

  it("rejects missing kind fields at the node-edit contract boundary", () => {
    const issues = DesignApplyContract.issues({
      label: "Create incomplete star",
      commands: [
        {
          commandId: "insert_star",
          type: "insert_element",
          pageId: "page_1",
          parentId: "poster_artboard",
          index: 0,
          node: {
            id: "star_1",
            name: "Star",
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 64, height: 64 },
            kind: "star",
            properties: {
              fills: [{ type: "solid", color: "#FFFFFF", opacity: 1 }],
            },
          },
        },
      ],
    });

    expect(
      issues.some(
        (issue) =>
          issue.code === "design_apply.schema_invalid" &&
          issue.path.startsWith("/commands/0/node/properties"),
      ),
    ).toBe(true);
    expect(issues.map((issue) => issue.path).join("\n")).toContain(
      "pointCount",
    );
    expect(issues.map((issue) => issue.path).join("\n")).toContain(
      "innerRadius",
    );
  });

  it("accepts fill-only status primitives with semantic steps", () => {
    const input = {
      label: "Create runtime status bar",
      steps: [
        {
          stepId: "status_bar",
          label: "Runtime status",
          commandIds: ["status_region", "status_dot", "status_separator"],
        },
      ],
      commands: [
        {
          commandId: "status_region",
          type: "insert_element",
          pageId: "page_1",
          parentId: "shell_region",
          index: 3,
          node: {
            id: "status_region",
            name: "Runtime Status",
            transform: [1, 0, 0, 1, 88, 852],
            size: { width: 1352, height: 48 },
            kind: "frame",
            properties: {
              fills: [{ type: "solid", color: "#E8EEF5", opacity: 1 }],
            },
          },
        },
        {
          commandId: "status_dot",
          type: "insert_element",
          pageId: "page_1",
          parentId: "status_region",
          index: 0,
          node: {
            id: "runtime_online_dot",
            name: "Runtime Online",
            transform: [1, 0, 0, 1, 20, 20],
            size: { width: 8, height: 8 },
            kind: "ellipse",
            properties: {
              fills: [{ type: "solid", color: "#18B89A", opacity: 1 }],
            },
          },
        },
        {
          commandId: "status_separator",
          type: "insert_element",
          pageId: "page_1",
          parentId: "status_region",
          index: 1,
          node: {
            id: "status_separator",
            name: "Status Separator",
            transform: [1, 0, 0, 1, 180, 12],
            size: { width: 1, height: 24 },
            kind: "rectangle",
            properties: {
              fills: [{ type: "solid", color: "#C8D3E0", opacity: 1 }],
            },
          },
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(DesignApplyContract.issues(input)).toHaveLength(0);
  });

  it("compiles compact Agent export settings to the full document contract", () => {
    const input = {
      label: "Configure exports",
      commands: [
        {
          commandId: "set_exports",
          type: "update_properties",
          nodeId: "hero_slice",
          exportSettings: [
            {
              format: "PNG",
              suffix: "@2x",
              constraint: { type: "SCALE", value: 2 },
            },
            { format: "SVG", suffix: "-vector", svgIdAttribute: true },
          ],
        },
      ],
    };
    expect(parsedApply(input).commands[0]).toMatchObject({
      exportSettings: [
        {
          format: "PNG",
          contentsOnly: true,
          useAbsoluteBounds: false,
          colorProfile: "DOCUMENT",
        },
        {
          format: "SVG",
          svgOutlineText: false,
          svgIdAttribute: true,
          svgSimplifyStroke: true,
        },
      ],
    });
  });

  it("requires semantic steps to cover commands exactly once in order", () => {
    const input = {
      label: "Build navigation and hero",
      steps: [
        {
          stepId: "navigation",
          label: "Build navigation",
          commandIds: ["insert_navigation"],
        },
        {
          stepId: "hero",
          label: "Build hero",
          commandIds: ["insert_hero"],
        },
      ],
      commands: [
        {
          commandId: "insert_navigation",
          type: "update_properties",
          nodeId: "navigation",
          opacity: 0.9,
        },
        {
          commandId: "insert_hero",
          type: "update_properties",
          nodeId: "hero",
          opacity: 0.95,
        },
      ],
    };
    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(parsedApply(input).steps).toEqual(input.steps);
    expect(
      DesignApplyContract.parse({
        ...input,
        steps: [input.steps[1], input.steps[0]],
      }).ok,
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        ...input,
        steps: [input.steps[0]],
      }).ok,
    ).toBe(false);
  });

  it("rejects operation-domain failures before the Runtime transaction", () => {
    const emptyUpdate = DesignApplyContract.parse({
      label: "Empty update",
      commands: [
        {
          commandId: "empty_update",
          type: "update_properties",
          nodeId: "hero",
        },
      ],
    });
    expect(emptyUpdate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design_apply.schema_invalid",
          path: "/commands/0",
        }),
      ],
    });

    const duplicateCommand = {
      commandId: "duplicate_command",
      type: "update_properties",
      nodeId: "hero",
      opacity: 0.9,
    } as const;
    const duplicate = DesignApplyContract.parse({
      label: "Duplicate commands",
      commands: [duplicateCommand, duplicateCommand],
    });
    expect(duplicate).toEqual({
      ok: false,
      issues: [
        expect.objectContaining({
          code: "design.transaction_command_id_duplicate",
          path: "/commands/1/commandId",
        }),
      ],
    });
  });

  it("exposes a path-free versioned raster delivery tool with format-specific validation", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === EXPORT_RASTER_TOOL_NAME,
    );
    const input = {
      pageId: "page_1",
      rootNodeId: "frame_1",
      suggestedName: "Launch poster",
      format: "jpeg",
      size: { mode: "width", value: 2400 },
      background: { mode: "color", color: "#ffffff" },
      quality: 0.9,
      resampling: "smooth",
    };
    expect(tool).toMatchObject({ risk: "external", approval: "never" });
    expect(validateDesignAgentToolInput(EXPORT_RASTER_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(EXPORT_RASTER_TOOL_NAME, {
        ...input,
        filePath: "C:\\Users\\designer\\poster.jpg",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EXPORT_RASTER_TOOL_NAME, {
        ...input,
        background: { mode: "transparent" },
      }),
    ).toBe(false);
    expect(
      isPreparedAgentRasterExport({
        kind: "raster-export-preparation",
        version: 1,
        suggestedName: "Launch poster",
        format: "jpeg",
        mimeType: "image/jpeg",
        bytes: new Uint8Array([1, 2, 3]),
        width: 2400,
        height: 1600,
        revision: 4,
        rootNodeId: "frame_1",
      }),
    ).toBe(true);
  });

  it("validates a dedicated Page lifecycle tool and rejects Page commands in node transactions", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_PAGE_TOOL_NAME,
    );
    expect(tool).toMatchObject({ risk: "design_write", approval: "never" });
    expect(tool?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          enum: ["create", "rename", "duplicate", "reorder", "clear", "delete"],
        },
        label: { type: "string" },
        pageId: { type: "string" },
        name: { type: "string" },
        index: { type: "integer" },
      },
    });
    expect(tool?.description).toContain(
      "opendesign_request_page_structure_access",
    );
    expect(tool?.description).toContain("clear");
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "create",
        label: "Create research Page",
        name: "Research",
        index: 1,
      }),
    ).toBe(true);
    expect(
      DesignPageContract.parse({
        action: "rename",
        label: "Rename current page",
        pageId: "page_research",
        name: "01 · 品牌",
        index: 0,
      }).ok,
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "rename",
        label: "Rename Page",
        pageId: "page_research",
        name: "Research",
      }),
    ).toBe(true);
    expect(
      DesignPageContract.parse({
        action: "create",
        label: "Create homepage",
        pageId: "page_research",
        name: "02 · 首页",
        index: 1,
      }).ok,
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "rename",
        label: "Rename Page",
        pageId: "page_research",
        name: "01 · 品牌",
        index: 0,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "create",
        label: "Create Page",
        pageId: "page_research",
        name: "02 · 首页",
        index: 1,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "rename",
        label: "Rename Page",
        pageId: "page_research",
        name: "Research",
        unexpected: true,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "clear",
        label: "Clear current Page",
        pageId: "page_research",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "delete",
        label: "Delete Page",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "duplicate",
        label: "Duplicate Page",
        pageId: "page_research",
        name: "Bad\nName",
      }),
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        label: "Bypass Page tool",
        commands: [
          {
            commandId: "create_page",
            type: "insert_page",
            index: 1,
            page: {
              id: "page_bypass",
              name: "Bypass",
              rootNodeIds: [],
              extensions: {},
            },
            nodes: [],
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("requires one explicit approval tool before Page structure access", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === PAGE_STRUCTURE_ACCESS_TOOL_NAME,
    );
    const input = {
      actions: ["create-page", "cross-page-edit"],
      reason: "Create and then design the requested Research page",
    };

    expect(tool).toMatchObject({
      risk: "design_write",
      approval: "required",
      approvalPrompt: {
        title: "Allow Page structure changes",
      },
    });
    expect(
      validateDesignAgentToolInput(PAGE_STRUCTURE_ACCESS_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(PAGE_STRUCTURE_ACCESS_TOOL_NAME, {
        ...input,
        actions: ["create-page", "create-page"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(PAGE_STRUCTURE_ACCESS_TOOL_NAME, {
        actions: ["filesystem"],
        reason: input.reason,
      }),
    ).toBe(false);
  });

  it("validates dedicated component actions and rejects component definition bypasses", () => {
    const combineVariants = {
      action: "combine-as-variants",
      label: "Combine button states",
      pageId: "page_home",
      componentIds: ["button_default", "button_hover"],
      componentRootNodeIds: ["button_default_root", "button_hover_root"],
      variantSetId: "button_set",
      rootNodeId: "button_set_root",
      name: "Button",
      variantPropertiesByComponentId: {
        button_default: { State: "Default" },
        button_hover: { State: "Hover" },
      },
    };
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, combineVariants),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        ...combineVariants,
        componentRootNodeIds: ["button_default_root"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "duplicate-variant",
        label: "Add pressed state",
        pageId: "page_home",
        variantSetId: "button_set",
        rootNodeId: "button_set_root",
        sourceComponentId: "button_default",
        sourceRootNodeId: "button_default_root",
        componentId: "button_pressed",
        componentRootNodeId: "button_pressed_root",
        variantProperties: { State: "Pressed" },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "add-property",
        label: "Convert content frame to Slot",
        pageId: "page_home",
        componentId: "component_card",
        propertyId: "card:content",
        name: "Content",
        type: "SLOT",
        sourceNodeId: "card_content_frame",
        preferredValues: [{ type: "COMPONENT", key: "component_list_item" }],
      }),
    ).toBe(true);
    const reorderProperties = {
      action: "reorder-properties",
      label: "Prioritize card content",
      pageId: "page_home",
      componentId: "component_card",
      componentRootNodeId: "card_main",
      componentPropertyOrder: ["Content#card:content", "Title#card:title"],
    };
    expect(
      validateDesignAgentToolInput(
        DESIGN_COMPONENT_TOOL_NAME,
        reorderProperties,
      ),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        ...reorderProperties,
        componentPropertyOrder: [
          "Content#card:content",
          "Content#card:content",
        ],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-slot-settings",
        label: "Guide card contents",
        pageId: "page_home",
        componentId: "component_card",
        propertyName: "Content#card:content",
        settings: {
          minChildren: 1,
          maxChildren: 6,
          allowPreferredValuesOnly: true,
          stretchChildOnInsert: true,
        },
        preferredValues: [{ type: "COMPONENT", key: "component_list_item" }],
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "clear-slot",
        label: "Clear card contents",
        pageId: "page_home",
        instanceId: "card_instance",
        propertyName: "Content#card:content",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-slot-settings",
        label: "Invalid range",
        pageId: "page_home",
        componentId: "component_card",
        propertyName: "Content#card:content",
        settings: { minChildren: 8, maxChildren: 2 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "add-variant-property",
        label: "Add button size matrix",
        pageId: "page_home",
        variantSetId: "button_set",
        rootNodeId: "button_set_root",
        propertyName: "Size",
        valuesByComponentId: {
          button_default: "Small",
          button_hover: "Large",
        },
        index: 0,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-variant-properties",
        label: "Change hover combination",
        pageId: "page_home",
        variantSetId: "button_set",
        rootNodeId: "button_set_root",
        componentId: "button_hover",
        componentRootNodeId: "button_hover_root",
        variantProperties: { State: "Hovered", Size: "Large" },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "dissolve-variant-set",
        label: "Dissolve button variants",
        pageId: "page_home",
        variantSetId: "button_set",
        rootNodeId: "button_set_root",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        ...combineVariants,
        variantPropertiesByComponentId: {
          button_default: { State: "Default" },
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-override",
        label: "Override button label",
        pageId: "page_home",
        instanceId: "button_instance",
        sourcePath: ["button_main", "button_label"],
        patch: { properties: { content: "Buy now" }, opacity: 0.9 },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "add-property",
        label: "Expose button label",
        pageId: "page_home",
        componentId: "component_button",
        propertyId: "button:text",
        name: "Label",
        type: "TEXT",
        sourceNodeId: "button_label",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-property",
        label: "Set button label",
        pageId: "page_home",
        instanceId: "button_instance",
        propertyName: "Label#button:text",
        value: "Buy now",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "reset-property",
        label: "Reset button label",
        pageId: "page_home",
        instanceId: "button_instance",
        propertyName: "Label#button:text",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "add-property",
        label: "Invalid preferred values",
        pageId: "page_home",
        componentId: "component_button",
        propertyId: "button:text",
        name: "Label",
        type: "TEXT",
        sourceNodeId: "button_label",
        preferredValues: [{ type: "COMPONENT", key: "component_secondary" }],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-property",
        label: "Invalid property value",
        pageId: "page_home",
        instanceId: "button_instance",
        propertyName: "Label#button:text",
        value: { content: "Buy now" },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "set-override",
        label: "Invalid override",
        pageId: "page_home",
        instanceId: "button_instance",
        sourcePath: ["button_main", "button_label"],
        patch: { transform: [1, 0, 0, 1, 0, 0] },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_COMPONENT_TOOL_NAME, {
        action: "remove-component",
        label: "Remove component identity",
        pageId: "page_home",
        componentId: "component_button",
      }),
    ).toBe(true);
    expect(
      DesignApplyContract.parse({
        label: "Bypass component tool",
        commands: [
          {
            commandId: "put_component",
            type: "put_component",
            component: {
              id: "component_button",
              name: "Button",
              rootNodeId: "button_main",
              extensions: {},
            },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        label: "Bypass instance creation",
        commands: [
          {
            commandId: "insert_instance",
            type: "insert_element",
            pageId: "page_home",
            parentId: null,
            index: 0,
            node: {
              id: "button_instance",
              kind: "instance",
              name: "Button instance",
              parentId: null,
              childIds: [],
              visible: true,
              locked: false,
              transform: [1, 0, 0, 1, 0, 0],
              size: { width: 120, height: 40 },
              opacity: 1,
              properties: {
                componentId: "component_button",
                overrides: [],
              },
              extensions: {},
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("keeps planned revision rebase guards on the trusted internal apply boundary", () => {
    const input = {
      label: "Continue a translated planned Frame",
      rebaseGuard: {
        fromRevision: 4,
        targets: [
          {
            frameId: "frame_home",
            pageId: "page_home",
            width: 1_440,
            height: 960,
          },
        ],
      },
      commands: [
        {
          commandId: "continue_home",
          type: "update_properties",
          nodeId: "home_title",
          name: "Updated title",
        },
      ],
    };

    expect(
      validateDesignAgentToolInput(INTERNAL_DESIGN_APPLY_TOOL_NAME, input),
    ).toBe(true);
    expect(DesignApplyContract.parse(input).ok).toBe(false);
    expect(
      validateDesignAgentToolInput(INTERNAL_DESIGN_APPLY_TOOL_NAME, {
        ...input,
        rebaseGuard: {
          ...input.rebaseGuard,
          targets: [...input.rebaseGuard.targets, input.rebaseGuard.targets[0]],
        },
      }),
    ).toBe(false);
  });

  it("requires a bounded executable design plan and rendered critique", () => {
    const target = (suffix: string, x: number) => ({
      targetId: `target_${suffix}`,
      label: suffix === "home" ? "Home" : "Profile",
      pageId: "page_1",
      objective: `Design the ${suffix} analytics screen`,
      artboard: {
        mode: "create",
        frameId: `artboard_${suffix}`,
        x,
        y: 80,
        width: 1_440,
        height: 1_024,
      },
      composition: {
        direction: "Dense desktop workspace with one dominant data plane",
        hierarchy: ["Navigation", "Primary analysis", "Contextual detail"],
        regions: [
          {
            nodeId: `analytics_navigation_${suffix}`,
            name: "Navigation",
            role: "structure",
            x: 32,
            y: 32,
            width: 1_376,
            height: 72,
          },
          {
            nodeId: `analytics_primary_${suffix}`,
            name: "Primary analysis",
            role: "content",
            x: 32,
            y: 128,
            width: 960,
            height: 864,
          },
          {
            nodeId: `analytics_inspector_${suffix}`,
            name: "Contextual detail",
            role: "interaction",
            x: 1_016,
            y: 128,
            width: 392,
            height: 864,
          },
        ],
        assetIntegration:
          "Use native icons and restrained vector data accents without a raster asset",
        spacingRhythm: "4/8/12/20/32 px rhythm",
      },
      editableLayers: ["Navigation", "Charts", "Inspector"],
      implementationSteps: [
        "Create the artboard",
        "Build the hierarchy",
        "Add interaction states",
      ],
      validationChecks: ["Check hierarchy", "Check density", "Check focus"],
      qualityProfile: {
        kind: "ui",
        platform: "web",
        interactionMode: "pointer",
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        safeAreaNodeIds: [
          `analytics_navigation_${suffix}`,
          `analytics_primary_${suffix}`,
        ],
        interactiveNodeIds: [],
      },
    });
    const plan = {
      version: 1,
      deliverable: "ui",
      objective: "Design the requested Home and Profile analytics screens",
      outputMode: "editable-composition",
      targets: [target("home", 120), target("profile", 1_680)],
      visualSystem: {
        avoidances: [
          "Do not wrap every region in the same rounded card",
          "Do not use borders as the only hierarchy signal",
        ],
        formLanguage: "Compact controls, precise edges, restrained 6 px radii",
        palette: ["#0F172A ink", "#F8FAFC canvas", "#2563EB action"],
        surfaceAndDepth:
          "Use surface contrast and one elevation tier instead of card soup",
        typography: ["Inter 12/16 body", "Inter 24/30 semibold heading"],
        effects: ["Subtle 1 px separators", "Focused blue selection halo"],
      },
      rasterAssetRoles: [],
      componentStrategy: {
        summary:
          "Use one linked navigation identity across both screens and keep the one-off hero ordinary.",
        candidates: [
          {
            decisionId: "shared-navigation",
            label: "Shared navigation",
            decision: "component",
            rationale:
              "The navigation repeats with one stable structure and centralized visual updates.",
            componentId: "component_navigation",
            main: {
              mode: "create",
              targetId: "target_home",
              nodeId: "navigation_main",
            },
            instances: [
              {
                targetId: "target_profile",
                nodeId: "navigation_profile_instance",
              },
            ],
          },
          {
            decisionId: "home-hero",
            label: "Home hero",
            decision: "ordinary",
            rationale:
              "The hero is a one-off composition with no shared semantic identity.",
            occurrences: [
              { targetId: "target_home", nodeId: "home_hero_group" },
            ],
          },
        ],
      },
      briefFidelity: {
        requiredContent: ["Home and Profile analytics screens"],
        preservedSemantics: ["Existing navigation labels and destinations"],
        prohibitedAdditions: ["No unrequested product capabilities"],
        assumptions: [],
      },
      designIntent: {
        subject: "A desktop analytics workspace for operational decisions",
        audience: "Operations teams monitoring time-sensitive product signals",
        primaryJob:
          "Identify the most important change and act without losing context",
        calibration: {
          surfaceMode: "operate",
          expressiveness: "balanced",
          density: "dense",
        },
        visualThesis:
          "A precise signal room uses directional data bands and controlled density instead of a generic dashboard grid.",
        signatureMotif:
          "One continuous signal rail links navigation, primary metric, and active decision across the canvas.",
        typographyLanguage:
          "Condensed display numerals contrast with calm utilitarian labels and readable body copy.",
        colorMaterialLanguage:
          "Tinted graphite planes carry dense data while one high-chroma signal color marks action.",
        compositionTension:
          "An asymmetric primary plane and narrow contextual edge create deliberate focus and forward motion.",
        antiPatterns: [
          "No equal-weight grid of interchangeable metric cards",
          "No purple gradient used as a substitute for identity",
          "No decorative icon tiles above every section label",
        ],
      },
      skillRefs: structuredClone(BUILTIN_UI_DESIGN_SKILL_REFS),
    };
    const review = {
      version: 1,
      skillRefs: structuredClone(BUILTIN_UI_DESIGN_SKILL_REFS),
      briefFidelity:
        "The capture preserves the requested analytics functions and adds no new capability.",
      distinctiveness:
        "The signal rail creates a recognizable identity beyond a generic workspace.",
      signatureMotif:
        "The continuous rail is visible but needs stronger primary-metric integration.",
      composition:
        "The primary plane is clear but the inspector is too dominant.",
      hierarchy: "The heading and chart compete at the same contrast.",
      typography: "Secondary labels need a quieter weight and clearer role.",
      assetIntegration: "Vector data accents align with the chart grid.",
      formAndSurface: "Too many bordered surfaces flatten the depth.",
      effects: "The selection halo is legible without decorative glow.",
      antiTemplate:
        "The asymmetric hierarchy avoids an equal card grid and ornamental gradient.",
      criteria: {
        "visual-thesis": "The signal-room thesis is legible in the data plane.",
        "signature-motif":
          "The rail crosses navigation and the primary surface.",
        "composition-tension": "The split creates a dominant work area.",
        "typography-character":
          "Condensed numerals add identity without noise.",
        "material-coherence": "Graphite planes and one accent form a system.",
        "template-avoidance": "The screen avoids repeated cards and gradients.",
        "glance-legibility":
          "The primary task and action remain clear at thumbnail scale.",
        "subject-specificity":
          "The composition remains tied to the requested product subject.",
        "craft-precision":
          "Spacing, alignment, and control proportions need deliberate polish.",
      },
      failedCriteria: ["signature-motif", "craft-precision"],
      refinements: [
        "Reduce inspector width and contrast",
        "Integrate the signal rail with the primary metric",
      ],
    };

    const planSpec = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_PLAN_TOOL_NAME,
    );
    expect(planSpec).toMatchObject({
      risk: "design_write",
      approval: "never",
      inputSchema: {
        properties: {
          version: { const: 1 },
          targets: { type: "array" },
          componentStrategy: { type: "object" },
          briefFidelity: { type: "object" },
          referenceStrategy: { type: "object" },
        },
      },
    });
    expect(planSpec).toHaveProperty(
      "validateInputIssues",
      DesignPlanContract.issues,
    );
    expect(JSON.stringify(planSpec?.inputSchema)).toContain(
      '"safeAreaNodeIds"',
    );
    expect(JSON.stringify(planSpec?.inputSchema)).toContain(
      '"interactiveNodeIds"',
    );
    expect(JSON.stringify(planSpec?.inputSchema)).not.toContain('"skillRefs"');
    const { skillRefs: _planSkillRefs, ...modelPlan } = plan;
    expect(_planSkillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
    expect(validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, modelPlan)).toBe(
      true,
    );
    expect(parsedPlan(modelPlan).skillRefs).toEqual(
      BUILTIN_UI_DESIGN_SKILL_REFS,
    );
    expect(validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, plan)).toBe(
      true,
    );
    const reference = (hex: string) => ({
      attachmentId: `image_${hex.repeat(64)}`,
      decision: "style-reference" as const,
      application:
        "Transfer the reference's tonal hierarchy without copying its subject.",
      preserve: ["tonal hierarchy"],
      avoid: ["literal subject copy"],
    });
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        referenceStrategy: {
          synthesis:
            "Combine the reference's transferable visual decisions with the current product semantics.",
          references: [reference("a")],
        },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        referenceStrategy: {
          synthesis:
            "Three simultaneous visual references would make generation and critique unbounded.",
          references: [reference("a"), reference("b"), reference("c")],
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        componentStrategy: {
          summary:
            "Reuse the existing navigation Component and keep the unique hero ordinary.",
          candidates: [
            {
              decisionId: "catalog-navigation",
              label: "Product navigation",
              decision: "reuse-component",
              rationale:
                "The catalog Component has the same navigation job and supported variation surface.",
              componentId: "component_catalog_navigation",
              instances: [
                {
                  targetId: "target_home",
                  nodeId: "catalog_navigation_instance",
                },
              ],
            },
          ],
        },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        version: 7,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        targets: plan.targets.map((item, index) =>
          index === 0
            ? {
                ...item,
                composition: {
                  ...item.composition,
                  regions: item.composition.regions.map(
                    (region, regionIndex) =>
                      regionIndex === 2
                        ? { ...region, x: 1_200, width: 392 }
                        : region,
                  ),
                },
              }
            : item,
        ),
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        targets: [
          plan.targets[0],
          { ...plan.targets[1], targetId: "target_home" },
        ],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        visualSystem: {
          ...plan.visualSystem,
          avoidances: ["Make it good"],
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        skillRefs: plan.skillRefs.slice(1),
      }),
    ).toBe(true);
    expect(
      parsedPlan({
        ...plan,
        skillRefs: plan.skillRefs.slice(1),
      }).skillRefs,
    ).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        designIntent: { ...plan.designIntent, signatureMotif: "Modern" },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        targets: plan.targets.map((item, index) =>
          index === 0
            ? {
                ...item,
                qualityProfile: { kind: "graphic" },
              }
            : item,
        ),
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        componentStrategy: {
          ...plan.componentStrategy,
          candidates: [
            plan.componentStrategy.candidates[0],
            {
              ...plan.componentStrategy.candidates[1],
              occurrences: [
                {
                  targetId: "target_home",
                  nodeId: "navigation_main",
                },
              ],
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        outputMode: "single-raster",
        rasterAssetRoles: ["final-single-image"],
        singleRasterEvidence: "one flattened image",
      }),
    ).toBe(false);
    expect(validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, review)).toBe(
      true,
    );
    const { skillRefs: _reviewSkillRefs, ...modelReview } = review;
    expect(_reviewSkillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, modelReview),
    ).toBe(true);
    const parsedReview = DesignVisualReviewContract.parse(modelReview, {
      skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS,
    });
    expect(parsedReview.ok && parsedReview.value.skillRefs).toEqual(
      BUILTIN_UI_DESIGN_SKILL_REFS,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        ...review,
        version: 2,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        ...review,
        criteria: { ...review.criteria, "visual-thesis": "Looks good" },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        ...review,
        refinements: ["Looks fine"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        briefFidelity: review.briefFidelity,
        composition: review.composition,
        hierarchy: review.hierarchy,
        typography: review.typography,
        assetIntegration: review.assetIntegration,
        formAndSurface: review.formAndSurface,
        effects: review.effects,
        refinements: review.refinements,
      }),
    ).toBe(false);

    const checkpointApply = {
      label: "Refine hero spacing",
      commands: [
        {
          commandId: "remove_obsolete_badge",
          type: "delete_element",
          nodeId: "obsolete_badge",
        },
      ],
    };
    expect(
      validateDesignAgentToolInput(DESIGN_CHECKPOINT_TOOL_NAME, {
        version: 1,
        action: "apply-and-capture",
        apply: checkpointApply,
      }),
    ).toBe(true);
    const checkpointSpec = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_CHECKPOINT_TOOL_NAME,
    );
    expect(checkpointSpec?.inputSchema).toMatchObject({
      anyOf: [
        {
          properties: {
            version: { const: 1 },
            action: { const: "apply-and-capture" },
          },
          additionalProperties: false,
        },
        {
          properties: {
            version: { const: 1 },
            action: { const: "refine-and-capture" },
          },
          additionalProperties: false,
        },
      ],
    });
    expect(checkpointSpec?.inputSchema).toHaveProperty(
      "anyOf.0.properties.apply",
    );
    expect(checkpointSpec?.inputSchema).toHaveProperty(
      "anyOf.1.properties.refinement",
    );
    expect(
      validateDesignAgentToolInput(DESIGN_CHECKPOINT_TOOL_NAME, {
        version: 1,
        action: "refine-and-capture",
        refinement: checkpointApply,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_CHECKPOINT_TOOL_NAME, {
        version: 1,
        action: "refine-and-capture",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_CHECKPOINT_TOOL_NAME, {
        version: 1,
        action: "apply-and-capture",
        apply: checkpointApply,
        captureAnyway: true,
      }),
    ).toBe(false);
  });

  it("exposes the trusted capability manifest as a read-only tool", () => {
    const capabilities = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_CAPABILITIES_TOOL_NAME,
    );

    expect(capabilities).toMatchObject({ risk: "read", approval: "never" });
    expect(capabilities?.description).toContain(
      "versioned OpenDesign professional design capability manifest",
    );
    expect(
      validateDesignAgentToolInput(DESIGN_CAPABILITIES_TOOL_NAME, {}),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_CAPABILITIES_TOOL_NAME, {
        capability: "pretend-supported",
      }),
    ).toBe(false);
  });

  it("exposes mutually exclusive path-data and editable-network semantics to the model", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const schema = JSON.stringify(apply?.inputSchema);

    expect(apply?.description).toContain("properties.network");
    expect(apply?.description).toContain("exact imported SVG path data");
    expect(apply?.description).toContain(
      "never provide path and network together",
    );
    expect(schema).toContain('"path"');
    expect(schema).toContain('"network"');
    expect(schema).toContain('"tangentStart"');
    expect(schema).toContain('"handleMode"');
    expect(schema).toContain('"fillRule"');
    expect(schema).toContain('"fills"');
    expect(schema).toContain('"strokes"');
    expect(schema).toContain('"const":"solid"');
    expect(schema).toContain('"required":["type","opacity"]');
    expect(schema).toContain('"required":["type","color"]');
    expect(schema).toContain(
      '"required":["type","color","opacity","offset","blur","spread"]',
    );
    expect(schema.length).toBeLessThan(110_000);
    expect(schema).not.toContain('"$ref"');
    expect(schema).not.toContain('"$defs"');
  });

  it("keeps the first visible design transaction compact and basic", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const bootstrap = JSON.stringify(DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA);
    const complete = JSON.stringify(apply?.inputSchema);

    expect(apply?.modelDisclosure).toMatchObject({
      bootstrap: "available",
      beforePlan: "available",
      role: "material-write",
      bootstrapInputSchema: DESIGN_BOOTSTRAP_EDIT_TOOL_INPUT_SCHEMA,
    });
    expect(bootstrap).toContain(
      '"enum":["frame","group","rectangle","ellipse","text"]',
    );
    expect(bootstrap).toContain('"const":"insert_element"');
    expect(bootstrap).toContain('"const":"update_properties"');
    expect(bootstrap).toContain('"paragraphIndent"');
    expect(bootstrap).toContain('"textCase"');
    expect(bootstrap).toContain('"textDecoration"');
    expect(bootstrap).not.toContain('"textDecorationStyle"');
    expect(bootstrap).toContain('"textTruncation"');
    expect(bootstrap).toContain('"maxLines"');
    expect(bootstrap).not.toContain('"ellipsis"');
    expect(bootstrap).not.toContain('"network"');
    expect(bootstrap).not.toContain('"path"');
    expect(bootstrap).not.toContain('"assetId"');
    expect(bootstrap).not.toContain('"effects"');
    expect(
      DESIGN_AGENT_TOOL_SPECS.find(
        (tool) => tool.name === DESIGN_SYSTEM_TOOL_NAME,
      )?.modelDisclosure,
    ).toMatchObject({ bootstrap: "deferred" });
    expect(
      DESIGN_AGENT_TOOL_SPECS.find(
        (tool) => tool.name === DESIGN_FONT_TOOL_NAME,
      )?.modelDisclosure,
    ).toMatchObject({ bootstrap: "deferred", role: "material-write" });
    expect(bootstrap).not.toContain('"reflow_text"');
    expect(complete).not.toContain('"reflow_text"');
    expect(complete).not.toContain('"const":"update_text_range_style"');
    expect(complete).not.toContain('"const":"commit_text_edit"');
    expect(complete.length).toBeLessThan(110_000);
    const textRange = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_TEXT_RANGE_TOOL_NAME,
    );
    expect(textRange?.modelDisclosure).toMatchObject({
      bootstrap: "deferred",
      role: "material-write",
    });
    expect(JSON.stringify(textRange?.inputSchema)).toContain('"fills"');
  });

  it("keeps host text editing sessions out of model apply tools", () => {
    const input = {
      label: "Forge a host editing session",
      commands: [
        {
          commandId: "forged_edit",
          type: "commit_text_edit",
          nodeId: "title",
          content: "One\nTwo",
          paragraphPatches: [
            {
              start: 0,
              end: 7,
              style: { listOptions: { type: "ordered" }, indentation: 1 },
            },
          ],
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(false);
    expect(DesignApplyContract.parse(input).ok).toBe(false);
    expect(
      validateDesignAgentToolInput(INTERNAL_DESIGN_APPLY_TOOL_NAME, input),
    ).toBe(false);
  });

  it("routes bounded rich-text range styling through its dedicated deferred tool", () => {
    const input = {
      label: "Emphasize selected word",
      pageId: "page_1",
      nodeId: "title",
      start: 4,
      end: 10,
      style: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: "Semi Bold",
        fontWeight: 600,
        paragraphSpacing: 12,
        fills: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      },
    };
    expect(
      validateDesignAgentToolInput(DESIGN_TEXT_RANGE_TOOL_NAME, input),
    ).toBe(true);
    expect(DesignApplyContract.parse(input).ok).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_TEXT_RANGE_TOOL_NAME, {
        ...input,
        style: {},
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_TEXT_RANGE_TOOL_NAME, {
        ...input,
        end: input.start,
      }),
    ).toBe(false);
  });

  it("validates explicit scoped font reflow and replacement separately from generic apply", () => {
    const reflow = {
      action: "reflow",
      label: "Reflow Inter",
      pageId: "page_1",
      nodeIds: ["title", "subtitle"],
      expectedFont: {
        fontFamily: "Inter",
        fontStyleName: null,
        fontWeight: 600,
        fontSlant: "normal",
      },
    };
    const replace = {
      ...reflow,
      action: "replace",
      label: "Replace Inter",
      replacementFont: {
        fontFamily: "IBM Plex Sans",
        fontStyleName: null,
        fontWeight: 500,
        fontSlant: "normal",
      },
    };

    expect(validateDesignAgentToolInput(DESIGN_FONT_TOOL_NAME, reflow)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_FONT_TOOL_NAME, replace)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_FONT_TOOL_NAME, {
        ...replace,
        nodeIds: ["title", "title"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_FONT_TOOL_NAME, {
        ...reflow,
        replacementFont: replace.replacementFont,
      }),
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        label: "Bypass font tool",
        commands: [
          {
            commandId: "reflow",
            type: "reflow_text",
            nodeIds: ["title"],
            expectedFont: reflow.expectedFont,
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("exposes Typography Core v2 through the complete text transaction", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const schema = JSON.stringify(apply?.inputSchema);
    const input = {
      label: "Create a fixed caption",
      commands: [
        {
          commandId: "insert_caption",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: {
            id: "caption_1",
            name: "Caption",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 24, 24],
            size: { width: 240, height: 64 },
            opacity: 1,
            extensions: {},
            kind: "text",
            properties: {
              content: "A long fixed caption",
              fontFamily: "Inter",
              fontStyleName: null,
              fontSize: 18,
              fontWeight: 500,
              fontSlant: "normal",
              lineHeight: 26,
              letterSpacing: 0,
              paragraphIndent: 0,
              paragraphSpacing: 0,
              listSpacing: 0,
              hangingList: false,
              textCase: "uppercase",
              textDecoration: "underline",
              textDecorationStyle: "wavy",
              textDecorationOffset: { unit: "pixels", value: 3 },
              textDecorationThickness: { unit: "percent", value: 12 },
              textDecorationColor: {
                value: {
                  type: "solid",
                  color: "#2563eb",
                  opacity: 0.75,
                },
              },
              textDecorationSkipInk: false,
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              textResize: "fixed",
              textWrap: "word",
              textOverflow: "clip",
              textTruncation: "ending",
              maxLines: 2,
              fills: [{ type: "solid", color: "#151515", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
          },
        },
      ],
    };

    expect(schema).toContain('"textResize"');
    expect(schema).toContain('"textWrap"');
    expect(schema).toContain('"textOverflow"');
    expect(schema).toContain('"paragraphIndent"');
    expect(schema).toContain('"textCase"');
    expect(schema).toContain('"textDecoration"');
    expect(schema).toContain('"textDecorationStyle"');
    expect(schema).toContain('"textDecorationOffset"');
    expect(schema).toContain('"textDecorationThickness"');
    expect(schema).toContain('"textDecorationColor"');
    expect(schema).toContain('"textDecorationSkipInk"');
    expect(schema).toContain('"textTruncation"');
    expect(schema).toContain('"maxLines"');
    expect(schema).not.toContain('"ellipsis"');
    expect(apply?.description).toContain(
      "measures Auto Size and derived ending ellipsis",
    );
    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...input.commands[0]?.node,
              properties: {
                ...input.commands[0]?.node.properties,
                textWrap: "balance",
                textOverflow: "fade",
              },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("exports explicit SVG roots without accepting paths or fake settings", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === EXPORT_SVG_TOOL_NAME,
    );
    const input = {
      pageId: "page_brand",
      rootNodeIds: ["brand_mark", "brand_wordmark"],
      suggestedName: "Acme brand",
      includeLayerIds: true,
      padding: 24,
    };

    expect(tool).toMatchObject({ risk: "external", approval: "never" });
    expect(tool?.description).toContain("never receives a local path");
    expect(tool?.description).toContain("ordered sibling masks");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("outlineText");
    expect(validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, {
        ...input,
        suggestedName: "C:\\Users\\designer\\brand.svg",
      }),
    ).toBe(false);
    for (const suggestedName of ["CON.svg", "poster.", "poster:final.svg"]) {
      expect(
        validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, {
          ...input,
          suggestedName,
        }),
      ).toBe(false);
    }
    expect(
      validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, {
        ...input,
        rootNodeIds: ["brand_mark", "brand_mark"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, {
        ...input,
        padding: 100_001,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EXPORT_SVG_TOOL_NAME, {
        ...input,
        simplifyStroke: true,
      }),
    ).toBe(false);
  });

  it("imports only a run-scoped SVG handle into an explicit inspected target", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === IMPORT_SVG_TOOL_NAME,
    );
    const input = {
      attachmentId: `svg_${"a".repeat(64)}`,
      pageId: "page_brand",
      parentId: "brand_frame",
      index: 2,
      x: 120,
      y: 80,
    };

    expect(tool).toMatchObject({ risk: "design_write", approval: "never" });
    expect(tool?.description).toContain("editable OpenDesign vector tree");
    expect(tool?.description).toContain("ordered sibling masks");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain("filePath");
    expect(JSON.stringify(tool?.inputSchema)).not.toContain('"svg"');
    expect(validateDesignAgentToolInput(IMPORT_SVG_TOOL_NAME, input)).toBe(
      true,
    );
    for (const attachmentId of [
      `image_${"a".repeat(64)}`,
      "C:\\Users\\designer\\brand.svg",
      "<svg />",
    ]) {
      expect(
        validateDesignAgentToolInput(IMPORT_SVG_TOOL_NAME, {
          ...input,
          attachmentId,
        }),
      ).toBe(false);
    }
    expect(
      validateDesignAgentToolInput(IMPORT_SVG_TOOL_NAME, {
        ...input,
        selectedNodeId: "live_selection",
      }),
    ).toBe(false);

    const internal = {
      ...input,
      name: "Brand mark.svg",
      svg: '<svg viewBox="0 0 20 20" />',
      idPrefix: "agent_svg_deadbeef",
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_IMPORT_SVG_TOOL_NAME, internal),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_IMPORT_SVG_TOOL_NAME, {
        ...internal,
        idPrefix: "../unsafe",
      }),
    ).toBe(false);
  });

  it("accepts only bounded path-free SVG import results", () => {
    const result = {
      kind: "svg-import-result",
      version: 1,
      ok: true,
      format: "svg",
      attachmentId: `svg_${"a".repeat(64)}`,
      name: "Brand mark.svg",
      pageId: "page_brand",
      parentId: "brand_frame",
      rootNodeId: "agent_svg_root",
      importedNodeIds: ["agent_svg_root", "agent_svg_path"],
      revision: 5,
      atomic: true,
      issues: [],
    };

    expect(isAgentSvgImportResult(result)).toBe(true);
    expect(isAgentSvgImportResult({ ...result, svg: "<svg />" })).toBe(false);
    expect(
      isAgentSvgImportResult({ ...result, filePath: "/tmp/brand.svg" }),
    ).toBe(false);
    expect(
      isAgentSvgImportResult({
        ...result,
        importedNodeIds: ["agent_svg_root", "agent_svg_root"],
      }),
    ).toBe(false);
  });

  it("validates the bounded Renderer SVG preparation before Main saves it", () => {
    const prepared = {
      kind: "svg-export-preparation",
      version: 1,
      suggestedName: "Acme brand.svg",
      svg: '<svg viewBox="0 0 120 80" />',
      revision: 4,
      exportedNodeIds: ["brand_mark"],
      issues: [
        {
          code: "boolean-flattened",
          message: "Boolean operands were flattened into one standard path",
          severity: "warning",
          nodeId: "brand_mark",
        },
      ],
    };

    expect(isPreparedAgentSvgExport(prepared)).toBe(true);
    expect(
      isPreparedAgentSvgExport({ ...prepared, filePath: "/tmp/brand.svg" }),
    ).toBe(false);
    expect(
      isPreparedAgentSvgExport({
        ...prepared,
        issues: [{ ...prepared.issues[0], code: "invented-warning" }],
      }),
    ).toBe(false);
    expect(
      isPreparedAgentSvgExport({
        ...prepared,
        exportedNodeIds: ["brand_mark", "brand_mark"],
      }),
    ).toBe(false);
  });

  it("accepts a path node transaction and rejects non-path markup", () => {
    const input = {
      label: "Create mascot silhouette",
      commands: [
        {
          commandId: "insert_path",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: {
            id: "path_1",
            name: "Mascot silhouette",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 120, height: 160 },
            opacity: 1,
            extensions: {},
            kind: "path",
            properties: {
              path: "M 60 2 C 102 4 118 48 108 104 C 100 146 82 158 60 158 C 38 158 20 146 12 104 C 2 48 18 4 60 2 Z",
              fills: [{ type: "solid", color: "#111827", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
          },
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...input.commands[0]?.node,
              properties: {
                ...input.commands[0]?.node.properties,
                path: "<svg onload=bad()>",
              },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts editable vector network transactions and rejects dual geometry facts", () => {
    const input = {
      label: "Create editable mascot contour",
      commands: [
        {
          commandId: "insert_vector",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: {
            id: "vector_1",
            name: "Editable mascot contour",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 120, height: 160 },
            opacity: 1,
            extensions: {},
            kind: "vector",
            properties: {
              network: {
                vertices: [
                  { id: "vertex_a", x: 0, y: 0 },
                  { id: "vertex_b", x: 120, y: 0 },
                  { id: "vertex_c", x: 60, y: 160 },
                ],
                segments: [
                  {
                    id: "segment_ab",
                    startVertexId: "vertex_a",
                    endVertexId: "vertex_b",
                    tangentStart: { x: 30, y: 0 },
                    tangentEnd: { x: -30, y: 0 },
                  },
                  {
                    id: "segment_bc",
                    startVertexId: "vertex_b",
                    endVertexId: "vertex_c",
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
              fills: [{ type: "solid", color: "#111827", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
          },
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...input.commands[0]?.node,
              properties: {
                ...input.commands[0]?.node.properties,
                path: "M 0 0 L 120 0 L 60 160 Z",
              },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts a directed Line node and rejects invalid endpoint semantics", () => {
    const node = {
      id: "connector_1",
      name: "Directed connector",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 120, 80],
      size: { width: 240, height: 120 },
      opacity: 1,
      extensions: {},
      kind: "line",
      properties: {
        fills: [],
        strokes: [{ type: "solid", color: "#151515", opacity: 1 }],
        strokeWidth: 3,
        strokeAlign: "center",
        strokeCap: "round",
        strokeJoin: "round",
        dashPattern: [8, 4],
        start: { x: 1, y: 0 },
        end: { x: 0, y: 1 },
        startEndpoint: "circle",
        endEndpoint: "triangle-arrow",
      },
    };
    const input = {
      label: "Create a directed connector",
      commands: [
        {
          commandId: "insert_connector",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node,
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...node,
              properties: {
                ...node.properties,
                endEndpoint: "open-arrow",
              },
            },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...node,
              properties: {
                ...node.properties,
                start: { x: 1.2, y: 0 },
              },
            },
          },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts semantic Polygon and Star nodes and rejects invalid parameters", () => {
    const node = {
      id: "star_1",
      name: "Editable star",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 120, 80],
      size: { width: 180, height: 180 },
      opacity: 1,
      extensions: {},
      kind: "star",
      properties: {
        fills: [{ type: "solid", color: "#f59e0b", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        pointCount: 5,
        innerRadius: 0.382,
        cornerRadius: 0,
      },
    };
    const input = {
      label: "Create an editable star",
      commands: [
        {
          commandId: "insert_star",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node,
        },
      ],
    };

    expect(DesignApplyContract.parse(input).ok).toBe(true);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...node,
              properties: { ...node.properties, pointCount: 4.5 },
            },
          },
        ],
      }).ok,
    ).toBe(false);
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...node,
              properties: { ...node.properties, innerRadius: 1.2 },
            },
          },
        ],
      }).ok,
    ).toBe(false);

    const polygon = {
      ...node,
      id: "polygon_1",
      kind: "polygon",
      properties: {
        fills: node.properties.fills,
        strokes: [],
        strokeWidth: 0,
        pointCount: 6,
        cornerRadius: 8,
      },
    };
    expect(
      DesignApplyContract.parse({
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: polygon,
          },
        ],
      }).ok,
    ).toBe(true);
  });

  it("exposes bounded GPT Image 2 generation without a model override", () => {
    const generate = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === GENERATE_IMAGE_TOOL_NAME,
    );

    expect(generate?.description).toContain("application-wide");
    expect(JSON.stringify(generate?.inputSchema)).not.toContain("modelId");
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A luminous editorial penguin poster",
        role: "hero",
        size: "1536x1024",
        quality: "high",
        outputFormat: "webp",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A poster",
        role: "hero",
        modelId: "conversation-model",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A poster",
        role: "hero",
        size: "8192x8192",
      }),
    ).toBe(false);
  });

  it("accepts non-destructive placement with exactly one image source", () => {
    const input = {
      attachmentId: `image_${"a".repeat(64)}`,
      pageId: "page_1",
      parentId: "poster_frame",
      index: 2,
      nodeId: "hero_image",
      name: "Hero image",
      role: "hero",
      x: 120,
      y: 80,
      width: 640,
      height: 480,
      placement: {
        mode: "crop",
        focalPoint: { x: 0.42, y: 0.36 },
        zoom: 1.2,
        rotation: -8,
        flipHorizontal: false,
        flipVertical: false,
      },
    };
    const persistentInput = {
      assetId: `asset_${"b".repeat(64)}`,
      pageId: input.pageId,
      parentId: input.parentId,
      index: input.index,
      nodeId: input.nodeId,
      name: input.name,
      role: input.role,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      placement: input.placement,
    };

    expect(validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, persistentInput),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, {
        ...input,
        assetId: `asset_${"b".repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, {
        ...persistentInput,
        width: undefined,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, {
        ...input,
        placement: {
          ...input.placement,
          focalPoint: { x: -0.1, y: 0.36 },
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, {
        ...input,
        fit: "cover",
      }),
    ).toBe(false);
  });

  it("updates an explicit Image node without deriving a target from selection", () => {
    const setPlacement = {
      action: "set-placement",
      label: "Reframe the hero",
      pageId: "page_1",
      nodeId: "hero_image",
      placement: {
        mode: "crop",
        focalPoint: { x: 0.36, y: 0.58 },
        zoom: 1.25,
        rotation: -4,
        flipHorizontal: false,
        flipVertical: false,
      },
    };
    const replaceSource = {
      action: "replace-source",
      label: "Replace the hero source",
      pageId: "page_1",
      nodeId: "hero_image",
      attachmentId: `image_${"b".repeat(64)}`,
    };
    const setFilters = {
      action: "set-filters",
      label: "Balance the hero photo",
      pageId: "page_1",
      nodeId: "hero_image",
      filters: {
        exposure: 0.15,
        temperature: -0.2,
        highlights: -0.35,
      },
    };
    const setPaintFilters = {
      action: "set-paint-filters",
      label: "Balance the card image fill",
      pageId: "page_1",
      nodeId: "card",
      paintField: "fills",
      paintIndex: 1,
      expectedPaint: {
        type: "image",
        assetId: "asset_photo",
        fit: "cover",
        opacity: 1,
      },
      filters: { contrast: 0.2 },
    };
    const switchSource = {
      action: "switch-source",
      label: "Restore the original hero",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: "asset_retouch",
      assetId: "asset_original",
    };
    const update = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === UPDATE_IMAGE_TOOL_NAME,
    );

    expect(update).toMatchObject({ risk: "design_write", approval: "never" });
    expect(update?.description).toContain("explicit Page and node IDs");
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, setPlacement),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, replaceSource),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, setFilters),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, setPaintFilters),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, switchSource),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...switchSource,
        expectedAssetId: undefined,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...setPaintFilters,
        paintIndex: -1,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...setFilters,
        filters: { exposure: 1.1 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...setFilters,
        filters: { contrast: 0.2, preset: "cinematic" },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...setPlacement,
        placement: {
          ...setPlacement.placement,
          zoom: 0.5,
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...replaceSource,
        attachmentId: "C:\\Users\\me\\hero.png",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(UPDATE_IMAGE_TOOL_NAME, {
        ...setPlacement,
        selectedNodeId: "live_selection",
      }),
    ).toBe(false);
  });

  it("accepts only bounded embedded image assets on the trusted internal bridge", () => {
    const input = {
      action: "replace-source",
      label: "Replace hero",
      pageId: "page_1",
      nodeId: "hero_image",
      asset: {
        id: `asset_${"c".repeat(64)}`,
        kind: "image",
        name: "Hero.webp",
        mimeType: "image/webp",
        source: { type: "data", value: "aW1hZ2U=" },
        size: { width: 1600, height: 900 },
        extensions: {},
      },
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        asset: {
          ...input.asset,
          source: { type: "external", value: "C:\\secret\\hero.webp" },
        },
      }),
    ).toBe(false);
  });

  it("exposes stale-safe image edits without image bytes or provider controls", () => {
    const input = {
      action: "remove-background",
      label: "Remove the portrait background",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: `asset_${"a".repeat(64)}`,
    };
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === EDIT_IMAGE_TOOL_NAME,
    );
    expect(tool).toMatchObject({ risk: "external", approval: "never" });
    expect(tool?.description).toContain("transparent PNG");
    expect(tool?.description).toContain("prompt-edit");
    expect(tool?.description).toContain("replace-background");
    expect(tool?.description).toContain("upscale");
    expect(validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        source: "data:image/png;base64,aW1hZ2U=",
      }),
    ).toBe(false);
    const relight = {
      ...input,
      action: "relight",
      label: "Relight the hero for dark mode",
      lightingPreset: "neon",
    };
    expect(validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, relight)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...relight,
        lightingPreset: "custom-party-light",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...relight,
        prompt: "Make it neon",
      }),
    ).toBe(false);
    const replaceBackground = {
      ...input,
      action: "replace-background",
      label: "Replace the product background",
      prompt: "A graphite studio with a soft horizon",
    };
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, replaceBackground),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...replaceBackground,
        referenceAttachmentId: `image_${"b".repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        expectedAssetId: undefined,
      }),
    ).toBe(false);
    const promptEdit = {
      ...input,
      action: "prompt-edit",
      label: "Match the reference lighting",
      prompt: "Preserve the subject and use the reference lighting",
      referenceAttachmentId: `image_${"b".repeat(64)}`,
    };
    expect(validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, promptEdit)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...promptEdit,
        referenceAttachmentId: "C:\\Users\\me\\reference.png",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...promptEdit,
        provider: "openai-images",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...promptEdit,
        prompt: "   ",
      }),
    ).toBe(false);
    const selection = {
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.2 },
        { x: 0.5, y: 0.8 },
      ],
    };
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "erase-object",
        label: "Remove the selected lamp",
        selection,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "isolate-object",
        label: "Isolate the selected lamp",
        selection,
        resultNodeId: "isolated_lamp",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "erase-object",
        selection: { points: [{ x: 0.2, y: 0.2 }] },
        mask: "data:image/png;base64,aW1hZ2U=",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "expand",
        label: "Extend the hero to the right",
        expansion: { top: 0, right: 160, bottom: 0, left: 0 },
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "expand",
        expansion: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "upscale",
        label: "Boost hero resolution",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(EDIT_IMAGE_TOOL_NAME, {
        ...input,
        action: "upscale",
        label: "Boost hero resolution",
        scale: 4,
      }),
    ).toBe(false);
  });

  it("accepts only exact trusted mask provenance for isolated image layers", () => {
    const sourceAssetId = `asset_${"a".repeat(64)}`;
    const maskAsset = {
      id: `asset_${"b".repeat(64)}`,
      kind: "image",
      name: "Selection mask.png",
      mimeType: "image/png",
      source: { type: "data", value: "bWFzaw==" },
      size: { width: 800, height: 600 },
      extensions: {},
    } as const;
    const resultAsset = {
      ...maskAsset,
      id: `asset_${"c".repeat(64)}`,
      name: "Isolated object.png",
      source: { type: "data", value: "cmVzdWx0" },
    } as const;
    const input = {
      action: "derive-layer",
      label: "Isolate selected object",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: sourceAssetId,
      resultNodeId: "isolated_object",
      resultNodeName: "Isolated object",
      asset: resultAsset,
      supportingAssets: [maskAsset],
      derivation: {
        id: "image_derivation_isolate",
        sourceAssetId,
        resultAssetId: resultAsset.id,
        operation: "isolate-object",
        prompt: "Isolate the selected object",
        maskAssetId: maskAsset.id,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        supportingAssets: [
          { ...maskAsset, mimeType: "image/jpeg", name: "Forged mask.jpg" },
        ],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        resultNodeId: undefined,
      }),
    ).toBe(false);
  });

  it("accepts only semantic relighting provenance for internal image commits", () => {
    const sourceAssetId = `asset_${"d".repeat(64)}`;
    const resultAsset = {
      id: `asset_${"e".repeat(64)}`,
      kind: "image",
      name: "Relit.png",
      mimeType: "image/png",
      source: { type: "data", value: "cmVsaWdodA==" },
      size: { width: 800, height: 600 },
      extensions: {},
    } as const;
    const input = {
      action: "derive-source",
      label: "Relight hero",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: sourceAssetId,
      asset: resultAsset,
      derivation: {
        id: "image_derivation_relight",
        sourceAssetId,
        resultAssetId: resultAsset.id,
        operation: "relight",
        lightingPreset: "golden-hour",
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        derivation: { ...input.derivation, prompt: "Golden hour" },
      }),
    ).toBe(false);
  });

  it("accepts only geometry-bound trusted image expansion commits", () => {
    const sourceAssetId = `asset_${"3".repeat(64)}`;
    const maskAsset = {
      id: `asset_${"4".repeat(64)}`,
      kind: "image",
      name: "Expansion mask.png",
      mimeType: "image/png",
      source: { type: "data", value: "bWFzaw==" },
      size: { width: 1024, height: 1024 },
      extensions: {},
    } as const;
    const resultAsset = {
      ...maskAsset,
      id: `asset_${"5".repeat(64)}`,
      name: "Expanded.png",
      source: { type: "data", value: "cmVzdWx0" },
    } as const;
    const input = {
      action: "expand-source",
      label: "Expand hero",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: sourceAssetId,
      expectedPlacement: { mode: "fit" },
      expectedTargetSize: { width: 320, height: 240 },
      expansion: { top: 40, right: 0, bottom: 40, left: 0 },
      asset: resultAsset,
      supportingAssets: [maskAsset],
      derivation: {
        id: "image_derivation_expand",
        sourceAssetId,
        resultAssetId: resultAsset.id,
        operation: "expand",
        prompt: "Extend the image naturally",
        maskAssetId: maskAsset.id,
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        expectedTargetSize: { width: 0, height: 240 },
      }),
    ).toBe(false);
  });

  it("accepts only pixel-bound trusted image upscale commits", () => {
    const sourceAssetId = `asset_${"6".repeat(64)}`;
    const resultAsset = {
      id: `asset_${"7".repeat(64)}`,
      kind: "image",
      name: "Resolution boosted.png",
      mimeType: "image/png",
      source: { type: "data", value: "cmVzdWx0" },
      size: { width: 1_600, height: 1_200 },
      extensions: {},
    } as const;
    const input = {
      action: "upscale-source",
      label: "Boost hero resolution",
      pageId: "page_1",
      nodeId: "hero_image",
      expectedAssetId: sourceAssetId,
      expectedSourceSize: { width: 800, height: 600 },
      targetSize: { width: 1_600, height: 1_200 },
      asset: resultAsset,
      derivation: {
        id: "image_derivation_upscale",
        sourceAssetId,
        resultAssetId: resultAsset.id,
        operation: "upscale",
        referenceAssetIds: [],
        extensions: { provider: "openai-images", modelId: "gpt-image-2" },
      },
    };
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, input),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(INTERNAL_UPDATE_IMAGE_TOOL_NAME, {
        ...input,
        derivation: { ...input.derivation, prompt: "Upscale" },
      }),
    ).toBe(false);
  });

  it("exposes strict semantic group and ungroup inputs without selection-derived targets", () => {
    const editDesign = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const group = {
      action: "group",
      label: "Group mascot layers",
      pageId: "page_1",
      nodeIds: ["body", "face", "scarf"],
      groupId: "mascot_group",
      name: "Mascot",
    };
    const ungroup = {
      action: "ungroup",
      label: "Ungroup mascot",
      pageId: "page_1",
      groupId: "mascot_group",
    };
    const createMask = {
      action: "create-mask",
      label: "Mask portrait into avatar",
      pageId: "page_1",
      nodeIds: ["avatar_shape", "portrait_image"],
      groupId: "avatar_mask_group",
      name: "Avatar mask",
      maskType: "alpha",
    };
    const setMaskType = {
      action: "set-mask-type",
      label: "Use vector avatar mask",
      pageId: "page_1",
      maskNodeId: "avatar_shape",
      maskType: "vector",
    };
    const removeMask = {
      action: "remove-mask",
      label: "Remove avatar mask",
      pageId: "page_1",
      maskNodeId: "avatar_shape",
    };
    const reorder = {
      action: "reorder",
      label: "Bring mascot details forward",
      pageId: "page_1",
      nodeIds: ["face", "scarf"],
      order: "bring-forward",
    };
    const reparent = {
      action: "reparent",
      label: "Move mascot into poster",
      pageId: "page_1",
      nodeIds: ["mascot_group"],
      parentId: "poster_frame",
      index: 2,
    };
    const createBoolean = {
      action: "create-boolean",
      label: "Subtract logo cutout",
      pageId: "page_1",
      nodeIds: ["logo_base", "logo_cutout"],
      booleanId: "logo_boolean",
      name: "Logo mark",
      operation: "subtract",
    };
    const setBooleanOperation = {
      action: "set-boolean-operation",
      label: "Intersect logo shapes",
      pageId: "page_1",
      booleanId: "logo_boolean",
      operation: "intersect",
    };
    const ungroupBoolean = {
      action: "ungroup-boolean",
      label: "Release logo shapes",
      pageId: "page_1",
      booleanId: "logo_boolean",
    };

    expect(editDesign).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(editDesign?.description).toContain("stable IDs");
    expect(editDesign?.description).toContain("one revision and one undo");
    expect(editDesign?.description).toContain("Boolean groups");
    expect(editDesign?.description).toContain("masks");
    expect(DesignHierarchyContract.parse(group).ok).toBe(true);
    expect(DesignHierarchyContract.parse(ungroup).ok).toBe(true);
    expect(DesignHierarchyContract.parse(createMask).ok).toBe(true);
    expect(DesignHierarchyContract.parse(setMaskType).ok).toBe(true);
    expect(DesignHierarchyContract.parse(removeMask).ok).toBe(true);
    expect(DesignHierarchyContract.parse(reorder).ok).toBe(true);
    expect(DesignHierarchyContract.parse(reparent).ok).toBe(true);
    expect(DesignHierarchyContract.parse(createBoolean).ok).toBe(true);
    expect(DesignHierarchyContract.parse(setBooleanOperation).ok).toBe(true);
    expect(DesignHierarchyContract.parse(ungroupBoolean).ok).toBe(true);
    expect(
      DesignHierarchyContract.parse({
        ...reparent,
        parentId: null,
        index: 0,
      }).ok,
    ).toBe(true);
    expect(
      DesignHierarchyContract.parse({
        ...group,
        nodeIds: ["body", "body"],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...group,
        nodeIds: Array.from({ length: 250 }, (_, index) => `node_${index}`),
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...group,
        selectedNodeIds: ["different_live_selection"],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...ungroup,
        nodeIds: ["body"],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reorder,
        order: "move-up-somehow",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reorder,
        nodeIds: [],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reorder,
        groupId: "must_not_be_accepted",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reparent,
        nodeIds: ["mascot_group", "mascot_group"],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reparent,
        index: -1,
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...reparent,
        groupId: "not_part_of_reparent",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...createBoolean,
        nodeIds: ["logo_base", "logo_base"],
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...setBooleanOperation,
        operation: "divide",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...ungroupBoolean,
        groupId: "wrong_field",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...createMask,
        maskType: "clipping",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...setMaskType,
        groupId: "wrong_field",
      }).ok,
    ).toBe(false);
    expect(
      DesignHierarchyContract.parse({
        ...removeMask,
        maskType: "alpha",
      }).ok,
    ).toBe(false);
  });

  it("exposes bounded deterministic arrangement without model-computed transforms", () => {
    const editDesign = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const distribute = {
      action: "distribute-horizontal",
      label: "Distribute poster cards",
      pageId: "page_1",
      nodeIds: ["card_one", "card_two", "card_three"],
    };
    const spacing = {
      action: "set-vertical-spacing",
      label: "Set list rhythm",
      pageId: "page_1",
      nodeIds: ["row_one", "row_two"],
      spacing: 24,
    };
    const tidyUp = {
      action: "tidy-up",
      label: "Tidy comparison cards",
      pageId: "page_1",
      nodeIds: ["card_one", "card_two", "card_three", "card_four"],
    };
    const constraints = {
      action: "set-constraints",
      label: "Pin mobile footer",
      pageId: "page_1",
      nodeId: "footer",
      constraints: { horizontal: "left-right", vertical: "bottom" },
    };
    const resizeFrame = {
      action: "resize-frame",
      label: "Resize responsive screen",
      pageId: "page_1",
      frameId: "screen",
      width: 1440,
      height: 1024,
    };
    const autoLayout = {
      action: "set-auto-layout",
      label: "Build responsive navigation flow",
      pageId: "page_1",
      frameId: "navigation",
      autoLayout: {
        mode: "horizontal",
        padding: { top: 12, right: 16, bottom: 12, left: 16 },
        gap: 8,
        primaryAlignment: "start",
        counterAlignment: "center",
        sizing: { horizontal: "hug", vertical: "fixed" },
      },
    };
    const layoutSizing = {
      action: "set-layout-sizing",
      label: "Fill navigation row",
      pageId: "page_1",
      nodeId: "navigation_items",
      sizing: { horizontal: "fill", vertical: "fixed" },
    };
    const layoutLimits = {
      action: "set-layout-limits",
      label: "Bound responsive navigation",
      pageId: "page_1",
      nodeId: "navigation_items",
      limits: { minWidth: 240, maxWidth: 720, minHeight: 44 },
    };
    const layoutPositioning = {
      action: "set-layout-positioning",
      label: "Float navigation badge",
      pageId: "page_1",
      nodeId: "navigation_badge",
      positioning: "absolute",
      constraints: { horizontal: "right", vertical: "top" },
    };
    const layoutGuides = {
      action: "set-layout-guides",
      label: "Show 8pt grid",
      pageId: "page_1",
      frameId: "navigation",
      layoutGuides: [
        {
          id: "grid_8",
          type: "grid",
          size: 8,
          color: "#ff5a5f",
          opacity: 0.12,
        },
      ],
    };
    const columnStretchGuide = {
      ...layoutGuides,
      label: "Show 12-column layout",
      layoutGuides: [
        {
          id: "columns_12",
          type: "columns",
          alignment: "stretch",
          count: 12,
          gutter: 24,
          margin: 64,
          color: "#ff5a5f",
          opacity: 0.1,
        },
      ],
    };
    const rowEndGuide = {
      ...layoutGuides,
      label: "Show bottom-aligned rows",
      layoutGuides: [
        {
          id: "rows_bottom",
          type: "rows",
          alignment: "end",
          count: 4,
          gutter: 16,
          sectionSize: 40,
          offset: 24,
          color: "#3366ff",
          opacity: 0.12,
        },
      ],
    };

    expect(editDesign).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(editDesign?.description).toContain("host-computed geometry");
    expect(editDesign?.description).toContain("two-dimensional Tidy up");
    expect(editDesign?.description).toContain("Smart Selection canvas handles");
    expect(editDesign?.description).toContain("Constraints v1");
    expect(editDesign?.description).toContain("Auto Layout");
    expect(editDesign?.description).toContain("Auto gap");
    expect(editDesign?.description).toContain("counterAxisAlignContent");
    expect(editDesign?.description).toContain("Fill child's minimum width");
    expect(editDesign?.description).toContain("stretched rows");
    expect(editDesign?.description).toContain("first-line baseline");
    expect(editDesign?.description).toContain("min/max clamping");
    expect(editDesign?.description).toContain("absolute child");
    expect(DesignArrangeContract.parse(distribute).ok).toBe(true);
    expect(DesignArrangeContract.parse(spacing).ok).toBe(true);
    expect(DesignArrangeContract.parse(tidyUp).ok).toBe(true);
    expect(DesignArrangeContract.parse(constraints).ok).toBe(true);
    expect(DesignArrangeContract.parse(resizeFrame).ok).toBe(true);
    expect(DesignArrangeContract.parse(autoLayout).ok).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...autoLayout,
        autoLayout: {
          ...autoLayout.autoLayout,
          counterAlignment: "baseline",
        },
      }).ok,
    ).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...autoLayout,
        autoLayout: {
          ...autoLayout.autoLayout,
          primaryAlignment: "space-between",
        },
      }).ok,
    ).toBe(true);
    const wrapAutoLayout = {
      ...autoLayout,
      autoLayout: {
        ...autoLayout.autoLayout,
        sizing: { horizontal: "fixed", vertical: "hug" },
        wrap: { mode: "wrap", counterGap: 12 },
      },
    };
    expect(DesignArrangeContract.parse(wrapAutoLayout).ok).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...wrapAutoLayout,
        autoLayout: {
          ...wrapAutoLayout.autoLayout,
          wrap: {
            mode: "wrap",
            counterGap: 12,
            counterAxisAlignContent: "space-between",
          },
        },
      }).ok,
    ).toBe(true);
    expect(DesignArrangeContract.parse(layoutSizing).ok).toBe(true);
    expect(DesignArrangeContract.parse(layoutLimits).ok).toBe(true);
    expect(DesignArrangeContract.parse(layoutPositioning).ok).toBe(true);
    expect(DesignArrangeContract.parse(layoutGuides).ok).toBe(true);
    expect(DesignArrangeContract.parse(columnStretchGuide).ok).toBe(true);
    expect(DesignArrangeContract.parse(rowEndGuide).ok).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...columnStretchGuide,
        layoutGuides: [
          { ...columnStretchGuide.layoutGuides[0], margin: undefined },
        ],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...rowEndGuide,
        layoutGuides: [{ ...rowEndGuide.layoutGuides[0], count: 2.5 }],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...rowEndGuide,
        layoutGuides: [{ ...rowEndGuide.layoutGuides[0], offset: undefined }],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...layoutGuides,
        layoutGuides: [
          layoutGuides.layoutGuides[0],
          layoutGuides.layoutGuides[0],
        ],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...layoutPositioning,
        positioning: "flow",
        constraints: { horizontal: "right", vertical: "top" },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        action: "set-layout-positioning",
        label: "Return badge to flow",
        pageId: "page_1",
        nodeId: "navigation_badge",
        positioning: "flow",
      }).ok,
    ).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...layoutLimits,
        limits: null,
      }).ok,
    ).toBe(true);
    expect(
      DesignArrangeContract.parse({
        ...layoutLimits,
        limits: { minWidth: 720, maxWidth: 240 },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...layoutLimits,
        limits: { minWidth: 240, future: 1 },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...autoLayout,
        autoLayout: { ...autoLayout.autoLayout, wrap: true },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...wrapAutoLayout,
        autoLayout: { ...wrapAutoLayout.autoLayout, mode: "vertical" },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...wrapAutoLayout,
        autoLayout: {
          ...wrapAutoLayout.autoLayout,
          wrap: {
            mode: "wrap",
            counterGap: 12,
            counterAxisAlignContent: "space-evenly",
          },
        },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...wrapAutoLayout,
        autoLayout: {
          ...wrapAutoLayout.autoLayout,
          wrap: { mode: "wrap", counterGap: -1 },
        },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...wrapAutoLayout,
        autoLayout: {
          ...wrapAutoLayout.autoLayout,
          wrap: { mode: "wrap", counterGap: 12, columns: 3 },
        },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...layoutSizing,
        sizing: { horizontal: "hug", vertical: "fixed" },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...constraints,
        constraints: { horizontal: "stretch", vertical: "bottom" },
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...resizeFrame,
        width: 0,
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...distribute,
        nodeIds: ["card_one", "card_two"],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...tidyUp,
        nodeIds: ["card_one", "card_two"],
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...spacing,
        spacing: Number.NaN,
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...spacing,
        spacing: 1_000_001,
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...distribute,
        spacing: undefined,
      }).ok,
    ).toBe(false);
    expect(
      DesignArrangeContract.parse({
        ...spacing,
        selectedNodeIds: ["live_selection"],
      }).ok,
    ).toBe(false);
  });

  it("exposes strict semantic vector topology edits without model-authored networks", () => {
    const tool = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_VECTOR_TOOL_NAME,
    );
    const close = {
      action: "set-closed",
      closed: true,
      label: "Close the logo contour",
      nodeId: "logo_contour",
      pageId: "page_brand",
    };
    const reverse = {
      action: "reverse-path",
      label: "Reverse the logo contour",
      nodeId: "logo_contour",
      pageId: "page_brand",
    };
    const cut = {
      action: "cut-path",
      at: { kind: "segment", segmentId: "segment_logo_2", t: 0.4 },
      label: "Cut the logo contour",
      nodeId: "logo_contour",
      pageId: "page_brand",
      pathId: "path_logo",
    };
    const connect = {
      action: "connect-endpoints",
      endpoints: [
        { nodeId: "logo_contour", vertexId: "vertex_logo_a" },
        { nodeId: "logo_contour", vertexId: "vertex_logo_b" },
      ],
      label: "Connect the logo contour endpoints",
      pageId: "page_brand",
    };
    const disconnect = {
      action: "disconnect-vertex",
      label: "Disconnect the logo contour",
      nodeId: "logo_contour",
      pageId: "page_brand",
      pathId: "path_logo",
      segmentId: "segment_logo_branch",
      vertexId: "vertex_logo_mid",
    };
    const deleteSegments = {
      action: "delete-segments",
      label: "Delete the logo branch segment",
      nodeId: "logo_contour",
      pageId: "page_brand",
      segmentIds: ["segment_logo_branch"],
    };
    const deleteVertices = {
      action: "delete-vertices",
      label: "Delete the logo junction",
      nodeId: "logo_contour",
      pageId: "page_brand",
      vertexIds: ["vertex_logo_mid"],
    };
    const transform = {
      action: "transform-vertices",
      label: "Rotate selected logo points",
      nodeId: "logo_contour",
      pageId: "page_brand",
      transform: [0, 1, -1, 0, 96, 0],
      vertexIds: ["vertex_logo_a", "vertex_logo_mid"],
    };
    const layerTransform = {
      action: "transform-layers-vertices",
      label: "Scale selected logo points together",
      pageId: "page_brand",
      targets: [
        { nodeId: "logo_contour", vertexIds: ["vertex_logo_a"] },
        { nodeId: "logo_shadow", vertexIds: ["vertex_shadow_a"] },
      ],
      transform: [1.2, 0, 0, 1.2, -20, -20],
    };
    const lineCut = {
      action: "cut-with-line",
      end: { x: 128, y: 48 },
      label: "Divide the logo contour",
      nodeId: "logo_contour",
      pageId: "page_brand",
      start: { x: -8, y: 48 },
    };
    const layerLineCut = {
      action: "cut-layers-with-line",
      end: { x: 512, y: 240 },
      label: "Divide the selected logo contours",
      nodeIds: ["logo_contour", "logo_shadow"],
      pageId: "page_brand",
      start: { x: 16, y: 240 },
    };

    expect(tool).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(tool?.description).toContain(
      "stable Page, node, path, region, vertex, and segment IDs",
    );
    expect(tool?.description).toContain("host-created editable sibling layers");
    expect(tool?.description).toContain("same-side cut connectors");
    expect(tool?.description).toContain(
      "crossed-hole boundaries become continuous",
    );
    expect(tool?.description).toContain("one atomic undoable");
    expect(tool?.description).toContain("attached Bézier tangents");
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, close)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, reverse)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, cut)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, connect)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, disconnect),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, deleteSegments),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, deleteVertices),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, transform),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, layerTransform),
    ).toBe(true);
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, lineCut)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, layerLineCut),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...connect,
        endpoints: [
          { nodeId: "logo_contour", vertexId: "vertex_logo_a" },
          { nodeId: "logo_contour", vertexId: "vertex_logo_a" },
        ],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...disconnect,
        vertexId: undefined,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...transform,
        transform: [1, 0, 0, 1, 0],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...transform,
        vertexIds: [],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...deleteVertices,
        vertexIds: [],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...layerTransform,
        targets: [layerTransform.targets[0], { ...layerTransform.targets[0] }],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...cut,
        at: { ...cut.at, t: 1.2 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...cut,
        pathId: undefined,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...close,
        closed: "yes",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...reverse,
        closed: false,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...close,
        network: { vertices: [] },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...close,
        selectedNodeId: "live_selection",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...lineCut,
        start: { x: Number.NaN, y: 48 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...lineCut,
        end: { x: 1_000_001, y: 48 },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...lineCut,
        resultNodeId: "model_authored_result",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...layerLineCut,
        nodeIds: ["logo_contour", "logo_contour"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...layerLineCut,
        nodeIds: [],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, {
        ...layerLineCut,
        resultNodeIds: ["model_authored_result"],
      }),
    ).toBe(false);
  });
});
