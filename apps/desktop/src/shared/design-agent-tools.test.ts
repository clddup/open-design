import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  isAgentSvgImportResult,
  isPreparedAgentSvgExport,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

describe("design Agent tool contract", () => {
  it("requires a bounded executable design plan and rendered critique", () => {
    const plan = {
      pageId: "page_1",
      deliverable: "ui",
      objective: "Design a polished analytics workspace",
      outputMode: "editable-composition",
      artboard: {
        mode: "create",
        frameId: "analytics_artboard",
        width: 1440,
        height: 1024,
      },
      composition: {
        direction: "Dense desktop workspace with a strong primary data plane",
        hierarchy: ["Navigation", "Primary analysis", "Contextual detail"],
        assetIntegration:
          "Use native icons and restrained vector data accents; no raster asset",
        spacingRhythm: "4/8/12/20/32 px rhythm",
      },
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
      editableLayers: ["Navigation", "Charts", "Inspector"],
      implementationSteps: ["Create artboard", "Build hierarchy", "Add states"],
      validationChecks: ["Check hierarchy", "Check density", "Check focus"],
    };
    const review = {
      composition: "Primary plane is clear but the inspector is too dominant",
      hierarchy: "Heading and chart compete at the same contrast",
      typography: "Secondary labels need a quieter weight",
      assetIntegration: "Vector data accents align with the chart grid",
      formAndSurface: "Too many bordered surfaces flatten the depth",
      effects: "Selection halo is legible without decorative glow",
      refinements: [
        "Reduce inspector width and contrast",
        "Remove borders from secondary groups",
      ],
    };

    expect(
      DESIGN_AGENT_TOOL_SPECS.find(
        (tool) => tool.name === DESIGN_PLAN_TOOL_NAME,
      ),
    ).toMatchObject({ risk: "read", approval: "never" });
    expect(validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, plan)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        visualSystem: {
          ...plan.visualSystem,
          avoidances: ["Make it good"],
        },
      }),
    ).toBe(false);
    expect(validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, review)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        ...review,
        refinements: ["Looks fine"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_REVIEW_TOOL_NAME, {
        composition: "Looks good",
        hierarchy: "Looks good",
        typography: "Looks good",
        assetIntegration: "Looks good",
        formAndSurface: "Looks good",
        effects: "Looks good",
        refinements: ["Looks good", "Looks good"],
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

  it("exposes formal SVG path appearance semantics to the model", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_APPLY_TOOL_NAME,
    );
    const schema = JSON.stringify(apply?.inputSchema);

    expect(apply?.description).toContain("portable SVG path data");
    expect(schema).toContain('"path"');
    expect(schema).toContain('"fillRule"');
    expect(schema).toContain('"fills"');
    expect(schema).toContain('"strokes"');
    expect(schema.length).toBeLessThan(64_000);
    expect(schema).not.toContain('"$ref"');
    expect(schema).not.toContain('"$defs"');
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

    expect(validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
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

    expect(validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
    ).toBe(false);
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

  it("accepts versioned non-destructive placement when placing an image", () => {
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

    expect(validateDesignAgentToolInput(PLACE_IMAGE_TOOL_NAME, input)).toBe(
      true,
    );
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

  it("exposes strict semantic group and ungroup inputs without selection-derived targets", () => {
    const hierarchy = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_HIERARCHY_TOOL_NAME,
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

    expect(hierarchy).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(hierarchy?.description).toContain("explicit stable node IDs");
    expect(hierarchy?.description).toContain("one atomic undoable");
    expect(hierarchy?.description).toContain("non-destructive Boolean");
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, group),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, ungroup),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, reorder),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, reparent),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, createBoolean),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(
        DESIGN_HIERARCHY_TOOL_NAME,
        setBooleanOperation,
      ),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, ungroupBoolean),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        parentId: null,
        index: 0,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        nodeIds: ["body", "body"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        nodeIds: Array.from({ length: 250 }, (_, index) => `node_${index}`),
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        selectedNodeIds: ["different_live_selection"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...ungroup,
        nodeIds: ["body"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        order: "move-up-somehow",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        nodeIds: [],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        groupId: "must_not_be_accepted",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        nodeIds: ["mascot_group", "mascot_group"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        index: -1,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        groupId: "not_part_of_reparent",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...createBoolean,
        nodeIds: ["logo_base", "logo_base"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...setBooleanOperation,
        operation: "divide",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...ungroupBoolean,
        groupId: "wrong_field",
      }),
    ).toBe(false);
  });

  it("exposes bounded deterministic arrangement without model-computed transforms", () => {
    const arrange = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_ARRANGE_TOOL_NAME,
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

    expect(arrange).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(arrange?.description).toContain("host-computed geometry");
    expect(arrange?.description).toContain("not 2D Tidy up");
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, distribute),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, spacing),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...distribute,
        nodeIds: ["card_one", "card_two"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...spacing,
        spacing: Number.NaN,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...spacing,
        spacing: 1_000_001,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...distribute,
        spacing: undefined,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...spacing,
        selectedNodeIds: ["live_selection"],
      }),
    ).toBe(false);
  });
});
