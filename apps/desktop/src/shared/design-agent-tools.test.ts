import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_ARRANGE_TOOL_NAME,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_COMPONENT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  DESIGN_VECTOR_TOOL_NAME,
  DESIGN_PAGE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  EXPORT_SVG_TOOL_NAME,
  EXPORT_RASTER_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_APPLY_TOOL_NAME,
  INTERNAL_IMPORT_SVG_TOOL_NAME,
  INTERNAL_UPDATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
  isAgentSvgImportResult,
  isPreparedAgentSvgExport,
  isPreparedAgentRasterExport,
  normalizeDesignApplyToolInput,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

describe("design Agent tool contract", () => {
  it("normalizes model insert defaults before the trusted design boundary", () => {
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
              strokes: [],
              strokeWidth: 0,
              cornerRadius: 0,
            },
          },
        },
      ],
    };

    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, compactInput),
    ).toBe(true);
    expect(normalizeDesignApplyToolInput(compactInput)).toMatchObject({
      commands: [
        {
          node: {
            parentId: "poster_artboard",
            childIds: [],
            visible: true,
            locked: false,
            opacity: 1,
            extensions: {},
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
    expect(validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input)).toBe(
      true,
    );
    expect(normalizeDesignApplyToolInput(input)?.steps).toEqual(input.steps);
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
        ...input,
        steps: [input.steps[1], input.steps[0]],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
        ...input,
        steps: [input.steps[0]],
      }),
    ).toBe(false);
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
    expect(tool?.description).toContain(
      "opendesign_request_page_structure_access",
    );
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "create",
        label: "Create research Page",
        name: "Research",
        index: 1,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_PAGE_TOOL_NAME, {
        action: "rename",
        label: "Rename Page",
        pageId: "page_research",
        name: "Research",
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
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
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
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
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
      }),
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
    expect(validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input)).toBe(
      false,
    );
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
    const plan = {
      version: 2,
      pageId: "page_1",
      deliverable: "ui",
      objective: "Design a polished analytics workspace",
      outputMode: "editable-composition",
      artboard: {
        mode: "create",
        frameId: "analytics_artboard",
        x: 120,
        y: 80,
        width: 1440,
        height: 1024,
      },
      composition: {
        direction: "Dense desktop workspace with a strong primary data plane",
        hierarchy: ["Navigation", "Primary analysis", "Contextual detail"],
        regions: [
          {
            nodeId: "analytics_navigation",
            name: "Navigation",
            role: "structure",
            x: 32,
            y: 32,
            width: 1376,
            height: 72,
          },
          {
            nodeId: "analytics_primary",
            name: "Primary analysis",
            role: "content",
            x: 32,
            y: 128,
            width: 960,
            height: 864,
          },
          {
            nodeId: "analytics_inspector",
            name: "Contextual detail",
            role: "interaction",
            x: 1016,
            y: 128,
            width: 392,
            height: 864,
          },
        ],
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
    ).toMatchObject({ risk: "design_write", approval: "never" });
    expect(validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, plan)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        composition: {
          ...plan.composition,
          regions: [
            ...plan.composition.regions.slice(0, 2),
            {
              ...plan.composition.regions[2],
              x: 1_200,
              width: 392,
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        composition: {
          ...plan.composition,
          regions: [
            {
              ...plan.composition.regions[0],
              nodeId: plan.artboard.frameId,
            },
          ],
        },
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...plan,
        composition: {
          ...plan.composition,
          regions: [
            plan.composition.regions[0],
            {
              ...plan.composition.regions[1],
              nodeId: "analytics_navigation",
            },
          ],
        },
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
    const targetFromLegacy = (suffix: string, x: number) => ({
      targetId: `target_${suffix}`,
      label: suffix === "home" ? "Home" : "Profile",
      pageId: plan.pageId,
      objective: `Design the ${suffix} screen`,
      artboard: {
        ...plan.artboard,
        frameId: `artboard_${suffix}`,
        x,
      },
      composition: {
        ...plan.composition,
        regions: plan.composition.regions.map((region) => ({
          ...region,
          nodeId: `${region.nodeId}_${suffix}`,
        })),
      },
      editableLayers: [...plan.editableLayers],
      implementationSteps: [...plan.implementationSteps],
      validationChecks: [...plan.validationChecks],
    });
    const multiTargetPlan = {
      version: 3,
      deliverable: plan.deliverable,
      objective: "Design the requested Home and Profile screens",
      outputMode: plan.outputMode,
      targets: [
        targetFromLegacy("home", 120),
        targetFromLegacy("profile", 1_680),
      ],
      visualSystem: plan.visualSystem,
      rasterAssetRoles: plan.rasterAssetRoles,
    };
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, multiTargetPlan),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...multiTargetPlan,
        targets: [
          multiTargetPlan.targets[0],
          {
            ...multiTargetPlan.targets[1],
            targetId: multiTargetPlan.targets[0]?.targetId,
          },
        ],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_PLAN_TOOL_NAME, {
        ...multiTargetPlan,
        outputMode: "single-raster",
        rasterAssetRoles: ["final-single-image"],
        singleRasterEvidence: "one flattened image",
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

  it("exposes mutually exclusive path-data and editable-network semantics to the model", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_APPLY_TOOL_NAME,
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
    expect(schema).toContain('"required":["type","color","opacity"]');
    expect(schema).toContain(
      '"required":["type","color","opacity","offset","blur","spread"]',
    );
    expect(schema.length).toBeLessThan(64_000);
    expect(schema).not.toContain('"$ref"');
    expect(schema).not.toContain('"$defs"');
  });

  it("exposes bounded text wrapping and overflow without claiming auto sizing", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_APPLY_TOOL_NAME,
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
              fontSize: 18,
              fontWeight: 500,
              lineHeight: 26,
              letterSpacing: 0,
              textAlignHorizontal: "left",
              textAlignVertical: "top",
              textResize: "fixed",
              textWrap: "word",
              textOverflow: "ellipsis",
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
    expect(apply?.description).toContain(
      "measures Auto Size with the versioned Leafer Text provider",
    );
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
                textWrap: "balance",
                textOverflow: "fade",
              },
            },
          },
        ],
      }),
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
                path: "M 0 0 L 120 0 L 60 160 Z",
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
              properties: { ...node.properties, pointCount: 4.5 },
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
              properties: { ...node.properties, innerRadius: 1.2 },
            },
          },
        ],
      }),
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
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: polygon,
          },
        ],
      }),
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
    const tidyUp = {
      action: "tidy-up",
      label: "Tidy comparison cards",
      pageId: "page_1",
      nodeIds: ["card_one", "card_two", "card_three", "card_four"],
    };

    expect(arrange).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(arrange?.description).toContain("host-computed geometry");
    expect(arrange?.description).toContain("two-dimensional Tidy up");
    expect(arrange?.description).toContain("Smart Selection canvas handles");
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, distribute),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, spacing),
    ).toBe(true);
    expect(validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, tidyUp)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...distribute,
        nodeIds: ["card_one", "card_two"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_ARRANGE_TOOL_NAME, {
        ...tidyUp,
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
      "stable Page, node, path, vertex, and segment IDs",
    );
    expect(tool?.description).toContain("host-created editable sibling layers");
    expect(tool?.description).toContain("same-side cut connectors");
    expect(tool?.description).toContain(
      "crossed-hole boundaries become continuous",
    );
    expect(tool?.description).toContain("one atomic undoable");
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, close)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, reverse)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, cut)).toBe(
      true,
    );
    expect(validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, lineCut)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_VECTOR_TOOL_NAME, layerLineCut),
    ).toBe(true);
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
