import { describe, expect, it } from "vitest";
import {
  MAX_TRANSACTION_COMMANDS,
  schemaValidationIssues,
} from "@opendesign/design-contracts";
import {
  BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
  BUILTIN_LOGO_DESIGN_SKILL_REFS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  FirstSliceContract,
  type DesignFirstSliceToolInput,
} from "./design-first-slice-tool";
import { DesignApplyContract, DesignPlanContract } from "./design-agent-tools";

describe("compact first-slice tool", () => {
  it("uses the shared transaction safety limit instead of a first-slice quota", () => {
    type SchemaNode = {
      anyOf?: readonly SchemaNode[];
      const?: unknown;
      description: string;
      items: SchemaNode;
      maxItems: number;
      maxLength: number;
      properties: Record<string, SchemaNode>;
      required?: readonly string[];
    };
    const schema =
      DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA as unknown as SchemaNode;
    const properties = schema.properties;
    expect(properties.firstSlice.properties.stages.maxItems).toBe(
      MAX_TRANSACTION_COMMANDS,
    );
    expect(Object.keys(properties).sort()).toEqual(
      [
        "deliverable",
        "designIntent",
        "firstSlice",
        "logoColorStrategy",
        "logoExploration",
        "logoOutputs",
        "rasterAssetRoles",
        "targets",
        "visualSystem",
      ].sort(),
    );
    expect(JSON.stringify(properties)).not.toContain('"qualityProfile"');
    expect(JSON.stringify(properties)).not.toContain('"briefFidelity"');
    expect(JSON.stringify(properties)).not.toContain('"skillRefs"');
    expect(
      properties.firstSlice.properties.stages.items.properties.elements
        .maxItems,
    ).toBe(MAX_TRANSACTION_COMMANDS);
    const elementSchema =
      properties.firstSlice.properties.stages.items.properties.elements.items;
    expect(elementSchema.required).toEqual(
      expect.arrayContaining(["fills", "kind"]),
    );
    expect(elementSchema.required).not.toEqual(
      expect.arrayContaining(["strokes", "strokeWidth"]),
    );
    expect(Object.keys(elementSchema.properties)).toEqual(
      expect.arrayContaining([
        "fills",
        "strokes",
        "strokeWidth",
        "blendMode",
        "effects",
        "layoutPositioning",
        "layoutSizing",
        "autoLayout",
      ]),
    );
    expect(properties.firstSlice.properties.stages.description).toContain(
      "DesignTransaction command safety limit",
    );
    expect(properties.designIntent.description).toContain(
      "not a per-element rationale",
    );
    expect(properties.designIntent.properties.visualThesis.maxLength).toBe(320);
    expect(properties.designIntent.properties.antiPatterns.maxItems).toBe(5);
    expect(
      JSON.stringify(
        properties.designIntent.properties.calibration.properties.surfaceMode,
      ),
    ).toContain('"operate"');
    expect(
      JSON.stringify(
        properties.designIntent.properties.calibration.properties.surfaceMode,
      ),
    ).toContain('"graphic"');
    expect(properties.targets.items.properties.layout).toBeUndefined();
    expect(properties.visualSystem.properties.typography.maxItems).toBe(4);
    expect(schema.required).toEqual([
      "deliverable",
      "targets",
      "rasterAssetRoles",
      "firstSlice",
    ]);
    expect(properties.logoColorStrategy).toBeDefined();
    const valid = providerInput(fixture());
    expect(
      schemaValidationIssues(DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA, valid),
    ).toHaveLength(0);
    expect(
      FirstSliceContract.parse(valid, { target: hostTarget(fixture()) }).ok,
    ).toBe(true);
    const withoutHostFields = providerInputWithoutHostFields(fixture());
    expect(
      schemaValidationIssues(
        DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
        withoutHostFields,
      ),
    ).toHaveLength(0);
    expect(FirstSliceContract.modelIssues(withoutHostFields)).toEqual([]);
    expect(
      FirstSliceContract.parse(withoutHostFields, {
        target: hostTarget(fixture()),
      }).ok,
    ).toBe(true);
    const unexpected = { ...valid, hiddenLimit: 32 };
    expect(
      schemaValidationIssues(DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA, unexpected),
    ).not.toHaveLength(0);
    expect(FirstSliceContract.parse(unexpected).ok).toBe(false);

    const logo = fixture();
    logo.deliverable = "logo";
    logo.designIntent.calibration.surfaceMode = "graphic";
    logo.targets = logo.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const missingLogoStrategy = providerInput(logo);
    expect(
      schemaValidationIssues(
        DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
        missingLogoStrategy,
      ),
    ).toEqual([]);
    expect(
      FirstSliceContract.parse(missingLogoStrategy, {
        target: hostTarget(logo),
      }).ok,
    ).toBe(true);
  });

  it("preserves the model's brief-specific direction while binding only trusted host metadata", () => {
    const modelInput = providerInput(fixture());
    const normalized = parsedFirstSlice(modelInput);
    expect(normalized).toBeDefined();
    expect(normalized?.designIntent.visualThesis).toBe(
      fixture().designIntent.visualThesis,
    );
    expect(normalized?.designIntent.calibration).toEqual({
      surfaceMode: "operate",
      expressiveness: "expressive",
      density: "balanced",
    });
    expect(normalized?.briefFidelity.requiredContent).toEqual([
      "Create the requested visual deliverable",
    ]);
    expect(normalized?.visualSystem.palette).toContain("#0F172A");
    expect(normalized?.targets[0]).toMatchObject({
      objective: "A focused product overview",
      layout: "Authored from the submitted region geometry",
      spacing: "Defined by authored coordinates and Auto Layout",
    });
    expect(normalized?.targets[0]?.qualityProfile).toMatchObject({
      kind: "ui",
      platform: "other",
      safeNodeIds: ["home_hero"],
    });
    expect(
      normalized &&
        DesignPlanContract.parse(
          compileDesignFirstSliceToolInput(normalized).plan,
          { canonical: true },
        ).ok,
    ).toBe(true);
  });

  it("binds call-local document identities once while preserving target and stage identities", () => {
    const modelInput = providerInputWithoutHostFields(fixture());
    const result = FirstSliceContract.parse(modelInput, {
      authoritativePrompt: "Create Home and Profile screens",
      newNodeIdPrefix: "odr_run_slice_",
      target: hostTarget(fixture()),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected host-bound First Slice");
    expect(result.value.targets[0]).toMatchObject({
      targetId: "home",
      pageId: "page_1",
      frame: { frameId: "frame_home" },
      regions: [
        {
          nodeId: "odr_run_slice_4_home_home_hero",
          parentId: "frame_home",
        },
      ],
      qualityProfile: { safeNodeIds: ["odr_run_slice_4_home_home_hero"] },
    });
    expect(result.value.firstSlice).toMatchObject({
      targetId: "home",
      stages: [
        {
          stageId: "hero_stage",
          elements: [
            {
              id: "odr_run_slice_4_home_hero_panel",
              parentId: "odr_run_slice_4_home_home_hero",
            },
            {
              id: "odr_run_slice_4_home_hero_title",
              parentId: "odr_run_slice_4_home_home_hero",
            },
          ],
        },
      ],
    });
  });

  it("rejects more than the current rolling target at the schema boundary", () => {
    const input = fixture();
    input.targets.push(structuredClone(input.targets[0]));

    const result = FirstSliceContract.parse(providerInput(input), {
      target: hostTarget(input),
    });

    expect(result).toMatchObject({
      ok: false,
      issues: [expect.objectContaining({ path: "/targets" })],
    });
  });

  it("accepts host-bound target identity without model echoes and rejects an oversized host ID", () => {
    const input = fixture();
    const stable = providerInputWithoutHostFields(input);
    const binding = hostTarget(input);
    binding.frame.frameId = "odr_run_slice_frame_home";
    const parsed = FirstSliceContract.parse(stable, {
      newNodeIdPrefix: "odr_run_slice_",
      target: binding,
    });
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error("Expected reserved Frame ID to be valid");
    expect(parsed.value.targets[0]?.frame.frameId).toBe(
      "odr_run_slice_frame_home",
    );

    const oversized = hostTarget(input);
    oversized.frame.frameId = `f${"x".repeat(256)}`;
    expect(
      FirstSliceContract.parse(stable, { target: oversized }),
    ).toMatchObject({ ok: false });
  });

  it("derives non-authoritative planning metadata instead of rejecting authored content", () => {
    const modelInput = providerInput(fixture());
    Reflect.deleteProperty(modelInput, "designIntent");
    Reflect.deleteProperty(modelInput, "visualSystem");
    Reflect.deleteProperty(modelInput, "objective");
    Reflect.deleteProperty(modelInput, "version");
    const target = (modelInput.targets as Array<Record<string, unknown>>)[0];
    Reflect.deleteProperty(target, "label");
    Reflect.deleteProperty(target, "objective");
    Reflect.deleteProperty(target, "layout");
    Reflect.deleteProperty(target, "spacing");

    const result = FirstSliceContract.parse(modelInput, {
      target: hostTarget(fixture()),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected host-derived planning metadata");
    expect(result.value.version).toBe(1);
    expect(result.value.designIntent.signatureDecision).toContain(
      "submitted composition",
    );
    expect(result.value.visualSystem.typography[0]).toContain("Inter");
    expect(result.value.targets[0]).toMatchObject({
      label: "Home",
      layout: "Authored from the submitted region geometry",
    });
  });

  it("rejects a UI first slice classified as graphic", () => {
    const input = fixture();
    input.designIntent.calibration.surfaceMode = "graphic";
    const modelInput = providerInput(input);
    const result = FirstSliceContract.parse(modelInput, {
      target: hostTarget(fixture()),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected UI calibration failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.ui_surface_mode_invalid",
        path: "/designIntent/calibration/surfaceMode",
      }),
    );
  });

  it("rejects a non-UI first slice classified as a UI surface", () => {
    const input = fixture();
    input.deliverable = "poster";
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const result = FirstSliceContract.parse(providerInput(input), {
      target: hostTarget(input),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected graphic calibration failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.graphic_surface_mode_invalid",
        path: "/designIntent/calibration/surfaceMode",
      }),
    );
  });

  it("keeps the first material write focused on real hierarchy and defers Component promotion", () => {
    const modelInput = providerInput(fixture());
    modelInput.rasterAssetRoles = ["hero", "supporting-content"];

    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.rasterAssetRoles).toEqual([
      "hero",
      "supporting-content",
    ]);
    expect(
      normalized && compileDesignFirstSliceToolInput(normalized).plan,
    ).toMatchObject({
      rasterAssetRoles: ["hero", "supporting-content"],
      componentStrategy: {
        candidates: [],
      },
    });
  });

  it("places a generated persistent image in the first material slice", () => {
    const input = fixture();
    input.rasterAssetRoles = ["hero"];
    input.firstSlice.stages[0].elements[0] = {
      id: "hero_image",
      kind: "image",
      name: "Summer camp hero",
      parentId: "home_hero",
      x: 0,
      y: 0,
      width: 342,
      height: 260,
      fills: [],
      strokes: [],
      strokeWidth: 0,
      assetId: `asset_${"a".repeat(64)}`,
      placement: {
        mode: "fill",
        focalPoint: { x: 0.52, y: 0.42 },
      },
      altText: "Children exploring outdoors at summer camp",
      cornerRadius: 24,
    };

    const normalized = parsedFirstSlice(providerInput(input));
    expect(normalized).toBeDefined();
    const command = normalized
      ? compileDesignFirstSliceToolInput(normalized).apply.commands[0]
      : undefined;
    expect(command).toMatchObject({
      type: "insert_element",
      node: {
        kind: "image",
        properties: {
          assetId: `asset_${"a".repeat(64)}`,
          placement: { mode: "fill", focalPoint: { x: 0.52, y: 0.42 } },
          cornerRadius: 24,
        },
      },
    });
  });

  it("compiles editable row and stack relationships instead of flattening layout to coordinates", () => {
    const input = fixture();
    input.firstSlice.stages[0].elements[0] = {
      id: "hero_stack",
      kind: "frame",
      name: "Hero Stack",
      parentId: "home_hero",
      x: 0,
      y: 0,
      width: 342,
      height: 260,
      fills: [],
      strokes: [],
      strokeWidth: 0,
      autoLayout: {
        mode: "vertical",
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        gap: 16,
        primaryAlignment: "start",
        counterAlignment: "start",
        sizing: { horizontal: "fixed", vertical: "fixed" },
      },
    };
    const title = input.firstSlice.stages[0].elements[1];
    if (title?.kind !== "text") throw new Error("Expected Text fixture");
    input.firstSlice.stages[0].elements[1] = {
      ...title,
      parentId: "hero_stack",
      layoutSizing: { horizontal: "fill", vertical: "fixed" },
    };

    const normalized = parsedFirstSlice(providerInput(input));
    expect(normalized).toBeDefined();
    const compiled = normalized
      ? compileDesignFirstSliceToolInput(normalized)
      : undefined;
    expect(compiled?.apply.commands).toMatchObject([
      {
        node: {
          kind: "frame",
          properties: {
            autoLayout: {
              mode: "vertical",
              gap: 16,
              padding: { top: 24, right: 24, bottom: 24, left: 24 },
            },
          },
        },
      },
      {
        node: {
          kind: "text",
          parentId: "hero_stack",
          layoutSizing: { horizontal: "fill", vertical: "fixed" },
        },
      },
    ]);
    expect(
      compiled &&
        DesignApplyContract.parse(compiled.apply, {
          canonical: true,
          internal: true,
        }).ok,
    ).toBe(true);
  });

  it("rejects the removed parallel semantic identity payload", () => {
    const modelInput = providerInput(fixture());
    modelInput.semanticObjects = [
      {
        decisionId: "login_form_semantics",
        label: "Login form",
        decision: "ordinary",
        occurrences: [{ targetId: "home", nodeId: "home_hero" }],
      },
    ];

    const result = FirstSliceContract.parse(modelInput, {
      target: hostTarget(fixture()),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected removed semantic payload failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.schema_invalid",
        path: "/semanticObjects",
      }),
    );
  });

  it("uses the element kind discriminator to report the concrete invalid field", () => {
    const modelInput = providerInput(fixture());
    const firstSlice = modelInput.firstSlice as {
      stages: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    Reflect.deleteProperty(firstSlice.stages[0].elements[0], "fills");

    const result = FirstSliceContract.parse(modelInput, {
      target: hostTarget(fixture()),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected element schema failure");
    expect(result.issues[0]).toMatchObject({
      code: "first_slice.schema_invalid",
      path: "/firstSlice/stages/0/elements/0/fills",
    });
    expect(result.issues[0]?.message).not.toContain("union");
  });

  it("rejects Group shape appearance without discarding node effects", () => {
    const input = fixture();
    input.firstSlice.stages[0].elements.unshift({
      id: "hero_group",
      kind: "group",
      name: "Hero Group",
      parentId: "home_hero",
      x: 0,
      y: 0,
      width: 342,
      height: 260,
      fills: [{ type: "solid", color: "#FFFFFF", opacity: 1 }],
      strokes: [{ type: "solid", color: "#0F172A", opacity: 1 }],
      strokeWidth: 2,
      blendMode: "multiply",
      effects: [{ type: "layer-blur", radius: 4 }],
    });

    const result = parseCanonicalProjection(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected Group appearance failure");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "first_slice.group_fills_unsupported",
          path: "/firstSlice/stages/0/elements/0/fills",
        }),
        expect.objectContaining({
          code: "first_slice.group_strokes_unsupported",
          path: "/firstSlice/stages/0/elements/0/strokes",
        }),
        expect.objectContaining({
          code: "first_slice.group_stroke_width_unsupported",
          path: "/firstSlice/stages/0/elements/0/strokeWidth",
        }),
      ]),
    );
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({
        path: "/firstSlice/stages/0/elements/0/effects",
      }),
    );
  });

  it("does not count invisible Text as first-slice material", () => {
    const input = fixture();
    const title = input.firstSlice.stages[0].elements[1];
    if (title?.kind !== "text") throw new Error("Expected Text fixture");
    input.firstSlice.stages[0].elements = [
      { ...title, fills: [], strokes: [], strokeWidth: 0 },
    ];

    const result = parseCanonicalProjection(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected invisible material failure");
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.empty_referenced_region",
        path: "/targets/0/regions/0",
      }),
    );
  });

  it("binds the complete Run prompt as authoritative brief fidelity", () => {
    const modelInput = providerInput(fixture());
    const authoritativePrompt = [
      "Create four real brand artboards.",
      "Concept Exploration must contain three genuinely different directions.",
      "Selected Logo System must include symbol, wordmark, lockups, clear space, and minimum size.",
      "Desktop App Icon must include 16/24/32/64/128/256/512 px tests.",
      "Brand Usage Preview must include title bar, launch screen, app list, and light/dark canvas.",
    ].join("\n");

    const normalized = parsedFirstSlice(modelInput, {
      authoritativePrompt,
    });

    expect(normalized?.briefFidelity.requiredContent.join("\n")).toBe(
      authoritativePrompt,
    );
    expect(normalized?.briefFidelity.requiredContent.join("\n")).not.toBe(
      modelInput.objective,
    );
  });

  it("accepts distinct safe-area foreground and interactive hit-area IDs", () => {
    const input = fixture();
    const profile = input.targets[0].qualityProfile;
    if (profile.kind !== "ui") throw new Error("Expected UI fixture");
    profile.hitNodeIds = ["hero_panel"];

    expect(profile.safeNodeIds).not.toContain("hero_panel");
    expect(
      compileDesignFirstSliceToolInput(input).plan.targets[0]?.qualityProfile,
    ).toMatchObject({
      safeAreaNodeIds: ["hero_title"],
      interactiveNodeIds: ["hero_panel"],
    });
  });

  it("compiles all targets into the current Plan with pinned skills and a canonical first slice", () => {
    const input = fixture();
    input.referenceStrategy = {
      synthesis:
        "Transfer the attached reference's tonal hierarchy without changing the requested product semantics.",
      references: [
        {
          attachmentId: `image_${"d".repeat(64)}`,
          decision: "composition-reference",
          application:
            "Use its asymmetrical balance and negative-space ratio as directional guidance.",
          preserve: ["asymmetrical balance"],
          avoid: ["literal layout copy"],
        },
      ],
    };
    const compiled = compileDesignFirstSliceToolInput(input);
    expect(
      DesignPlanContract.parse(compiled.plan, { canonical: true }).ok,
    ).toBe(true);
    expect(
      DesignApplyContract.parse(compiled.apply, {
        canonical: true,
        internal: true,
      }).ok,
    ).toBe(true);
    expect(compiled.plan).toMatchObject({
      version: 1,
      skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS,
      designIntent: {
        visualThesis:
          "Momentum is expressed as a directional editorial system rather than a generic mobile card stack.",
        signatureDecision:
          "A cropped directional panel and offset type axis create a recognizable motion cue.",
      },
      briefFidelity: {
        requiredContent: ["Home product screen"],
        prohibitedAdditions: ["No unrequested workflow or run features"],
      },
      referenceStrategy: input.referenceStrategy,
      componentStrategy: {
        candidates: [],
      },
    });
    expect(
      compiled.plan.targets.map((target) => target.artboard.frameId),
    ).toEqual(["frame_home"]);
    expect(compiled.plan.targets[0]?.qualityProfile).toMatchObject({
      kind: "ui",
      platform: "ios",
      safeAreaNodeIds: ["hero_title"],
    });
    expect(compiled.apply.steps).toEqual([
      {
        stepId: "hero_stage",
        label: "Build real hero",
        commandIds: ["first_slice_1", "first_slice_2"],
      },
    ]);
    expect(compiled.apply.commands).toMatchObject([
      {
        parentId: "home_hero",
        node: { id: "hero_panel", kind: "rectangle", childIds: [] },
      },
      {
        parentId: "home_hero",
        node: {
          id: "hero_title",
          kind: "text",
          properties: {
            fontFamily: "Inter",
            fontStyleName: "Bold",
            fontWeight: 700,
            textResize: "auto-height",
          },
        },
      },
    ]);
  });

  it("preserves canonical gradient, stroke, blend and effect appearance in the first real revision", () => {
    const input = fixture();
    const [panel, title] = input.firstSlice.stages[0].elements;
    if (panel?.kind !== "rectangle" || title?.kind !== "text") {
      throw new Error("Expected rectangle and text fixture elements");
    }
    panel.fills = [
      {
        type: "linear-gradient",
        opacity: 0.92,
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
        stops: [
          { offset: 0, color: "#5B5CE2", opacity: 1 },
          { offset: 1, color: "#13B8A6", opacity: 0.76 },
        ],
      },
    ];
    panel.strokes = [{ type: "solid", color: "#FFFFFF", opacity: 0.28 }];
    panel.strokeWidth = 1;
    panel.blendMode = "screen";
    panel.effects = [
      {
        type: "drop-shadow",
        color: "#101828",
        opacity: 0.28,
        offset: { x: 0, y: 18 },
        blur: 42,
        spread: -8,
      },
      { type: "background-blur", radius: 18 },
    ];
    title.fills = [
      {
        type: "linear-gradient",
        opacity: 1,
        from: { x: 0, y: 0.5 },
        to: { x: 1, y: 0.5 },
        stops: [
          { offset: 0, color: "#FFFFFF", opacity: 1 },
          { offset: 1, color: "#D7F9F4", opacity: 1 },
        ],
      },
    ];

    const normalized = parsedFirstSlice(providerInput(input));
    expect(normalized).toBeDefined();
    if (!normalized) throw new Error("Expected canonical appearance input");
    const compiled = compileDesignFirstSliceToolInput(normalized);
    expect(
      DesignApplyContract.parse(compiled.apply, {
        canonical: true,
        internal: true,
      }).ok,
    ).toBe(true);
    expect(compiled.apply.commands[0]).toMatchObject({
      node: {
        blendMode: "screen",
        effects: [
          { type: "drop-shadow", blur: 42, spread: -8 },
          { type: "background-blur", radius: 18 },
        ],
        properties: {
          fills: [{ type: "linear-gradient", opacity: 0.92 }],
          strokes: [{ type: "solid", opacity: 0.28 }],
          strokeWidth: 1,
        },
      },
    });
    expect(compiled.apply.commands[1]).toMatchObject({
      node: {
        properties: {
          fills: [{ type: "linear-gradient" }],
        },
      },
    });
  });

  it("lets Main bind the current skill IDs instead of trusting model input", () => {
    const input = fixture();
    const modelInput = providerInput(input);

    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_UI_DESIGN_SKILL_REFS);

    const staleHostEcho = {
      ...modelInput,
      skillRefs: [{ id: "model-controlled" }],
    };
    const rejected = FirstSliceContract.parse(staleHostEcho);
    expect(rejected.ok).toBe(false);
    if (rejected.ok) throw new Error("Expected host echo rejection");
    expect(rejected.issues[0]?.path).toBe("/skillRefs");
  });

  it("binds graphic judgment skills and raster evidence roles for a poster", () => {
    const input = fixture();
    input.deliverable = "poster";
    input.designIntent.calibration.surfaceMode = "graphic";
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    const modelInput = providerInput(input);

    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_GRAPHIC_DESIGN_SKILL_REFS);
    expect(normalized?.rasterAssetRoles).toEqual([]);
    expect(
      normalized && compileDesignFirstSliceToolInput(normalized).plan,
    ).toMatchObject({
      deliverable: "poster",
      rasterAssetRoles: [],
      skillRefs: BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
    });
  });

  it("validates requested Logo exploration and also accepts one focused Logo/Icon", () => {
    const input = fixture();
    input.deliverable = "logo";
    input.designIntent.calibration.surfaceMode = "graphic";
    input.logoColorStrategy = {
      mode: "brand-color",
      rationale:
        "Electric violet identifies creative momentum while deep ink preserves professional precision.",
      lightDarkAdaptation:
        "Use violet on light surfaces and a brighter optical violet with white counters on dark surfaces.",
    };
    input.logoOutputs = ["symbol", "app-icon"];
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    input.targets[0].regions.push(
      {
        nodeId: "negative_region",
        name: "Negative Space Direction",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 80,
        width: 342,
        height: 220,
      },
      {
        nodeId: "modular_region",
        name: "Modular Direction",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 324,
        width: 342,
        height: 220,
      },
      {
        nodeId: "typographic_region",
        name: "Typographic Direction",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 568,
        width: 342,
        height: 220,
      },
    );
    input.logoExploration = {
      targetId: "home",
      directions: [
        logoDirection("concept_negative", "negative-space", "negative"),
        logoDirection("concept_modular", "modular-system", "modular"),
        logoDirection(
          "concept_typographic",
          "typographic-relationship",
          "typographic",
        ),
      ],
    };
    input.firstSlice.stages[0].elements = [
      ...logoDirectionElements("negative", "negative_region", "#FF5A5F"),
      ...logoDirectionElements("modular", "modular_region", "#2563EB"),
      ...logoDirectionElements("typographic", "typographic_region", "#7C3AED"),
    ];

    const modelInput = providerInput(input);
    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_LOGO_DESIGN_SKILL_REFS);
    expect(
      normalized &&
        compileDesignFirstSliceToolInput(normalized).apply.commands[0],
    ).toMatchObject({
      node: {
        kind: "frame",
        properties: {
          fills: [{ color: "#FFF7F2", opacity: 1, type: "solid" }],
        },
      },
    });
    const hostBound = parsedFirstSlice(modelInput, {
      newNodeIdPrefix: "odr_run_logo_",
    });
    expect(hostBound?.logoExploration?.directions[0]).toMatchObject({
      conceptId: "concept_negative",
      rootNodeId: "odr_run_logo_4_home_negative_root",
      masterNodeId: "odr_run_logo_4_home_negative_master",
    });

    if (!normalized) throw new Error("Expected parsed Logo input");
    const aliasedPlan = compileDesignFirstSliceToolInput(normalized).plan;
    const firstDirection = aliasedPlan.logoExploration?.directions[0];
    if (!firstDirection) throw new Error("Expected compiled Logo exploration");
    expect(firstDirection).toMatchObject({
      rootNodeId: "negative_root",
      masterNodeId: "negative_master",
    });
    expect(
      compileDesignFirstSliceToolInput(normalized).apply.commands.some(
        (command) =>
          command.type === "insert_element" &&
          command.node.id.includes("__evidence_"),
      ),
    ).toBe(false);
    firstDirection.masterNodeId = firstDirection.rootNodeId;
    expect(DesignPlanContract.parse(aliasedPlan, { canonical: true }).ok).toBe(
      false,
    );

    const duplicatePrinciple = structuredClone(modelInput) as {
      logoExploration?: NonNullable<
        DesignFirstSliceToolInput["logoExploration"]
      >;
    };
    if (!duplicatePrinciple.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    duplicatePrinciple.logoExploration.directions[1].principle =
      "negative-space";
    expect(
      FirstSliceContract.parse(duplicatePrinciple, {
        target: hostTarget(input),
      }).ok,
    ).toBe(true);

    const duplicateColorSystem = structuredClone(modelInput) as {
      logoExploration?: NonNullable<
        DesignFirstSliceToolInput["logoExploration"]
      >;
    };
    if (!duplicateColorSystem.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    duplicateColorSystem.logoExploration.directions[1].colorSystem =
      structuredClone(
        duplicateColorSystem.logoExploration.directions[0].colorSystem,
      );
    expect(
      FirstSliceContract.parse(duplicateColorSystem, {
        target: hostTarget(input),
      }).ok,
    ).toBe(true);

    const unplannedConceptRoot = structuredClone(modelInput) as {
      logoExploration?: NonNullable<
        DesignFirstSliceToolInput["logoExploration"]
      >;
    };
    if (!unplannedConceptRoot.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    unplannedConceptRoot.logoExploration.directions[0].rootNodeId =
      "unplanned_concept_root";
    expect(
      FirstSliceContract.parse(unplannedConceptRoot, {
        target: hostTarget(input),
      }).ok,
    ).toBe(false);

    const laterTargetExploration = structuredClone(modelInput) as {
      logoExploration?: NonNullable<
        DesignFirstSliceToolInput["logoExploration"]
      >;
    };
    if (!laterTargetExploration.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    laterTargetExploration.logoExploration.targetId = "profile";
    expect(
      FirstSliceContract.parse(laterTargetExploration, {
        target: hostTarget(input),
      }).ok,
    ).toBe(false);

    const missingExploration = structuredClone(modelInput);
    delete missingExploration.logoExploration;
    missingExploration.logoOutputs = ["symbol"];
    const focused = parsedFirstSlice(missingExploration);
    expect(focused).toMatchObject({
      deliverable: "logo",
      logoOutputs: ["symbol"],
    });
    expect(focused?.logoExploration).toBeUndefined();
    expect(
      focused && compileDesignFirstSliceToolInput(focused).plan,
    ).toMatchObject({
      deliverable: "logo",
      logoOutputs: ["symbol"],
    });

    const monochromeFocused = structuredClone(missingExploration) as Record<
      string,
      unknown
    > & {
      logoColorStrategy?: DesignFirstSliceToolInput["logoColorStrategy"];
      visualSystem: DesignFirstSliceToolInput["visualSystem"];
    };
    monochromeFocused.visualSystem.palette = ["#111111", "#FFFFFF"];
    monochromeFocused.logoColorStrategy = {
      mode: "monochrome-by-brief",
      rationale:
        "The primary identity is intentionally reduced to one high-contrast ink relationship.",
      lightDarkAdaptation:
        "Reverse foreground and background while preserving the same optical counterform.",
    };
    expect(
      FirstSliceContract.parse(monochromeFocused, {
        authoritativePrompt:
          "Include monochrome tests alongside the primary color Logo.",
        target: hostTarget(input),
      }).ok,
    ).toBe(true);
    expect(
      FirstSliceContract.parse(monochromeFocused, {
        authoritativePrompt: "The primary Logo must be monochrome only.",
        target: hostTarget(input),
      }).ok,
    ).toBe(true);

    const omittedOutputs = structuredClone(missingExploration);
    delete omittedOutputs.logoOutputs;
    const omitted = parsedFirstSlice(omittedOutputs);
    expect(omitted?.deliverable).toBe("logo");
    expect(omitted?.logoOutputs).toBeUndefined();
  });

  it("rejects duplicate IDs, forward parents, empty regions and a slice for a later target", () => {
    const duplicate = fixture();
    duplicate.firstSlice.stages[0].elements[1].id = "home_hero";
    expect(parseCanonicalProjection(duplicate).ok).toBe(false);

    const forwardParent = fixture();
    forwardParent.firstSlice.stages[0].elements[0].parentId = "hero_title";
    expect(parseCanonicalProjection(forwardParent).ok).toBe(false);

    const emptyRegion = fixture();
    emptyRegion.firstSlice.stages[0].elements.splice(0);
    expect(parseCanonicalProjection(emptyRegion).ok).toBe(false);

    const wrongTarget = fixture();
    wrongTarget.firstSlice.targetId = "profile";
    expect(parseCanonicalProjection(wrongTarget).ok).toBe(true);

    const crossTargetFrameCollision = fixture();
    crossTargetFrameCollision.targets[0].regions[0].nodeId = "frame_home";
    for (const element of crossTargetFrameCollision.firstSlice.stages[0]
      .elements) {
      element.parentId = "frame_home";
    }
    const collisionResult = parseCanonicalProjection(crossTargetFrameCollision);
    expect(collisionResult.ok).toBe(false);
    if (collisionResult.ok) throw new Error("Expected ID collision");
    expect(collisionResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.region_frame_id_conflict",
        path: "/targets/0/regions/0/nodeId",
        actual: "frame_home",
      }),
    );

    const invalidRegionGraph = fixture();
    invalidRegionGraph.targets[0].regions[0].parentId = "later_region";
    invalidRegionGraph.targets[0].regions.push({
      nodeId: "later_region",
      name: "Later Region",
      role: "content",
      parentId: "frame_home",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const graphResult = parseCanonicalProjection(invalidRegionGraph);
    expect(graphResult.ok).toBe(false);
    if (graphResult.ok) throw new Error("Expected region graph failure");
    expect(graphResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.region_parent_not_available",
        path: "/targets/0/regions/0/parentId",
        actual: "later_region",
      }),
    );

    const overflowingRegion = fixture();
    overflowingRegion.targets[0].regions[0].width = 400;
    const overflowResult = parseCanonicalProjection(overflowingRegion);
    expect(overflowResult.ok).toBe(false);
    if (overflowResult.ok) throw new Error("Expected region overflow");
    expect(overflowResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.region_bounds_exceeded",
        path: "/targets/0/regions/0",
      }),
    );

    const unplannedRegion = fixture();
    for (const element of unplannedRegion.firstSlice.stages[0].elements) {
      element.parentId = "home_intro";
    }
    const unplannedResult = parseCanonicalProjection(unplannedRegion);
    expect(unplannedResult.ok).toBe(false);
    if (unplannedResult.ok) throw new Error("Expected parent failure");
    expect(unplannedResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.parent_not_available",
        path: "/firstSlice/stages/0/elements/0/parentId",
        actual: "home_intro",
      }),
    );
  });

  it("accepts the 25-element two-stage production login slice that previously failed before any revision", () => {
    const input = fixture();
    input.firstSlice.stages.push({
      stageId: "auth_stage",
      label: "Build editable authentication controls",
      elements: Array.from({ length: 23 }, (_, index) => ({
        id: `auth_control_${index}`,
        kind: "rectangle" as const,
        name: `Auth Control ${index}`,
        parentId: "home_hero",
        x: 8 + (index % 11) * 20,
        y: 160 + Math.floor(index / 11) * 24,
        width: 16,
        height: 16,
        ...solidAppearance("#7C3AED"),
      })),
    });

    expect(
      input.firstSlice.stages.reduce(
        (total, stage) => total + stage.elements.length,
        0,
      ),
    ).toBe(25);
    expect(parseCanonicalProjection(input).ok).toBe(true);
  });

  it("compiles a 35-element login first screen with nested host-owned regions in one call", () => {
    const input = fixture();
    input.targets[0].regions = [
      {
        nodeId: "auth_region",
        name: "Authentication",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 80,
        width: 342,
        height: 620,
      },
      {
        nodeId: "form_region",
        name: "Form",
        role: "interaction",
        parentId: "auth_region",
        x: 24,
        y: 160,
        width: 294,
        height: 380,
      },
      {
        nodeId: "footer_region",
        name: "Footer",
        role: "typography",
        parentId: "frame_home",
        x: 24,
        y: 724,
        width: 342,
        height: 72,
      },
    ];
    input.firstSlice.stages = [
      {
        stageId: "login_screen",
        label: "Build the real login screen",
        elements: [
          {
            ...input.firstSlice.stages[0].elements[1],
            id: "auth_title",
            name: "Authentication Title",
            parentId: "auth_region",
          },
          ...Array.from({ length: 33 }, (_, index) => ({
            id: `form_element_${index}`,
            kind: "rectangle" as const,
            name: `Form Element ${index}`,
            parentId: "form_region",
            x: (index % 3) * 92,
            y: Math.floor(index / 3) * 30,
            width: 80,
            height: 24,
            ...solidAppearance("#F8FAFC"),
            cornerRadius: 6,
          })),
          {
            ...input.firstSlice.stages[0].elements[1],
            id: "footer_copy",
            name: "Footer Copy",
            parentId: "footer_region",
            x: 0,
            y: 0,
            width: 342,
            height: 24,
          },
        ],
      },
    ];

    expect(input.firstSlice.stages[0].elements).toHaveLength(35);
    const normalized = parsedFirstSlice(providerInput(input));
    expect(normalized).toBeDefined();
    if (!normalized) throw new Error("Expected parsed 35-element input");
    const compiled = compileDesignFirstSliceToolInput(normalized);
    const compiledRegions = compiled.plan.targets[0]?.composition.regions ?? [];
    expect(compiledRegions).toMatchObject([
      { nodeId: "auth_region" },
      { nodeId: "form_region", parentId: "auth_region" },
      { nodeId: "footer_region" },
    ]);
    expect(compiledRegions[0]).not.toHaveProperty("parentId");
    expect(compiledRegions[2]).not.toHaveProperty("parentId");
    expect(compiled.apply.commands).toHaveLength(35);
    expect(compiled.apply.commands[0]).toMatchObject({
      parentId: "auth_region",
      node: { id: "auth_title" },
    });
    expect(compiled.insertedNodeIds).toContain("footer_copy");
  });

  it("accepts a coherent 49-element first slice and rejects only the shared transaction overflow", () => {
    const beyondLegacyQuota = fixture();
    const stage = beyondLegacyQuota.firstSlice.stages[0];
    for (let index = 0; index < 47; index += 1) {
      stage.elements.push({
        id: `support_${index}`,
        kind: "rectangle",
        name: `Support ${index}`,
        parentId: "home_hero",
        x: 8 + index,
        y: 160,
        width: 8,
        height: 8,
        ...solidAppearance("#7C3AED"),
      });
    }
    expect(parseCanonicalProjection(beyondLegacyQuota).ok).toBe(true);

    const overTransactionLimit = fixture();
    overTransactionLimit.firstSlice.stages.push({
      stageId: "overflow_content",
      label: "Overflow content",
      elements: Array.from(
        { length: MAX_TRANSACTION_COMMANDS - 1 },
        (_, index) => ({
          id: `overflow_${index}`,
          kind: "rectangle" as const,
          name: `Overflow ${index}`,
          parentId: "home_hero",
          x: 8 + index,
          y: 180,
          width: 8,
          height: 8,
          ...solidAppearance("#7C3AED"),
        }),
      ),
    });
    const overflowResult = parseCanonicalProjection(overTransactionLimit);
    expect(overflowResult.ok).toBe(false);
    if (overflowResult.ok)
      throw new Error("Expected transaction limit failure");
    expect(overflowResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.transaction_limit_exceeded",
        path: "/firstSlice/stages",
        expected: MAX_TRANSACTION_COMMANDS,
        actual: MAX_TRANSACTION_COMMANDS + 1,
      }),
    );

    const multipleRegions = fixture();
    multipleRegions.targets[0].regions.push({
      nodeId: "home_navigation",
      name: "Navigation",
      role: "interaction",
      parentId: "frame_home",
      x: 24,
      y: 24,
      width: 342,
      height: 40,
    });
    multipleRegions.firstSlice.stages.push({
      stageId: "navigation_stage",
      label: "Build navigation",
      elements: [
        {
          id: "navigation_mark",
          kind: "rectangle",
          name: "Navigation Mark",
          parentId: "home_navigation",
          x: 0,
          y: 0,
          width: 40,
          height: 40,
          ...solidAppearance("#7C3AED"),
        },
      ],
    });
    expect(parseCanonicalProjection(multipleRegions).ok).toBe(true);
  });
});

function providerInput(
  input: DesignFirstSliceToolInput,
): Record<string, unknown> {
  const value = structuredClone(input) as unknown as Record<string, unknown>;
  for (const key of [
    "version",
    "objective",
    "skillRefs",
    "briefFidelity",
    "referenceStrategy",
  ]) {
    Reflect.deleteProperty(value, key);
  }
  for (const target of value.targets as Array<Record<string, unknown>>) {
    Reflect.deleteProperty(target, "qualityProfile");
    Reflect.deleteProperty(target, "targetId");
    Reflect.deleteProperty(target, "label");
    Reflect.deleteProperty(target, "pageId");
    Reflect.deleteProperty(target, "objective");
    Reflect.deleteProperty(target, "layout");
    Reflect.deleteProperty(target, "spacing");
    const frame = target.frame as Record<string, unknown>;
    const frameId = frame.frameId;
    Reflect.deleteProperty(frame, "frameId");
    Reflect.deleteProperty(frame, "x");
    Reflect.deleteProperty(frame, "y");
    for (const region of target.regions as Array<Record<string, unknown>>) {
      if (region.parentId === frameId)
        Reflect.deleteProperty(region, "parentId");
    }
  }
  Reflect.deleteProperty(
    value.firstSlice as Record<string, unknown>,
    "targetId",
  );
  if (value.logoExploration) {
    Reflect.deleteProperty(value.logoExploration, "targetId");
  }
  return value;
}

function providerInputWithoutHostFields(
  input: DesignFirstSliceToolInput,
): Record<string, unknown> {
  return providerInput(input);
}

function hostTarget(input: DesignFirstSliceToolInput) {
  const target = input.targets[0];
  return {
    targetId: target.targetId,
    label: target.label,
    objective: target.objective,
    pageId: target.pageId,
    frame: { ...target.frame },
  };
}

function parsedFirstSlice(
  input: unknown,
  context: {
    authoritativePrompt?: string;
    newNodeIdPrefix?: string;
    target?: ReturnType<typeof hostTarget>;
  } = {},
): DesignFirstSliceToolInput | undefined {
  const modelTarget = (
    input && typeof input === "object" && "targets" in input
      ? (
          input as {
            targets?: Array<{ frame?: { width?: number; height?: number } }>;
          }
        ).targets?.[0]
      : undefined
  )?.frame;
  const fallback = hostTarget(fixture());
  const result = FirstSliceContract.parse(input, {
    ...context,
    target: context.target ?? {
      ...fallback,
      frame: {
        ...fallback.frame,
        width: modelTarget?.width ?? fallback.frame.width,
        height: modelTarget?.height ?? fallback.frame.height,
      },
    },
  });
  return result.ok ? result.value : undefined;
}

function parseCanonicalProjection(input: DesignFirstSliceToolInput) {
  return FirstSliceContract.parse(providerInput(input), {
    target: hostTarget(input),
  });
}

export function fixture(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create the Home screen",
    designIntent: {
      subject: "A mobile product for maintaining creative momentum",
      audience: "Independent designers managing focused daily work",
      primaryJob: "See the next meaningful task and continue it immediately",
      calibration: {
        surfaceMode: "operate",
        expressiveness: "expressive",
        density: "balanced",
      },
      visualThesis:
        "Momentum is expressed as a directional editorial system rather than a generic mobile card stack.",
      signatureDecision:
        "A cropped directional panel and offset type axis create a recognizable motion cue.",
      typographyLanguage:
        "Editorial display type creates pace while compact neutral body type preserves clarity.",
      colorMaterialLanguage:
        "Deep ink surfaces and one electric violet signal use paper-like tonal separation.",
      compositionTension:
        "Offset alignment, decisive scale contrast, and cropped edges pull attention forward.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No repeated same-radius feature tiles",
        "No generic purple gradient used as the only identity",
      ],
    },
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    briefFidelity: {
      requiredContent: ["Home product screen"],
      preservedSemantics: [
        "Home remains a product overview and Profile remains an account overview",
      ],
      prohibitedAdditions: ["No unrequested workflow or run features"],
      assumptions: ["Use a mobile viewport for both requested screens"],
    },
    targets: [
      {
        targetId: "home",
        label: "Home",
        pageId: "page_1",
        objective: "A focused product overview",
        frame: {
          frameId: "frame_home",
          x: 80,
          y: 40,
          width: 390,
          height: 844,
        },
        layout: "Vertical mobile composition",
        spacing: "8px base with 24px section rhythm",
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          input: "touch",
          insets: [59, 0, 34, 0],
          safeNodeIds: ["hero_title"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "home_hero",
            name: "Hero",
            role: "content",
            parentId: "frame_home",
            x: 24,
            y: 80,
            width: 342,
            height: 260,
          },
        ],
      },
    ],
    visualSystem: {
      formLanguage: "Calm editorial geometry",
      palette: ["#0F172A", "#F8FAFC", "#7C3AED"],
      surfaceAndDepth: "Flat hierarchy with one elevated focal surface",
      typography: ["Inter Bold 32/38", "Inter Regular 16/24"],
    },
    rasterAssetRoles: [],
    firstSlice: {
      targetId: "home",
      label: "Create Home hero",
      stages: [
        {
          stageId: "hero_stage",
          label: "Build real hero",
          elements: [
            {
              id: "hero_panel",
              kind: "rectangle",
              name: "Hero Panel",
              parentId: "home_hero",
              x: 0,
              y: 0,
              width: 342,
              height: 260,
              ...solidAppearance("#EDE9FE"),
              cornerRadius: 24,
            },
            {
              id: "hero_title",
              kind: "text",
              name: "Hero Title",
              parentId: "home_hero",
              x: 24,
              y: 28,
              width: 294,
              height: 92,
              ...solidAppearance("#0F172A"),
              text: {
                content: "Design with momentum",
                fontFamily: "Inter",
                fontStyleName: "Bold",
                fontWeight: 700,
                fontSlant: "normal",
                fontSize: 32,
                lineHeight: 38,
                textResize: "auto-height",
              },
            },
          ],
        },
      ],
    },
  };
}

function logoDirection(
  conceptId: string,
  principle: "negative-space" | "modular-system" | "typographic-relationship",
  prefix: string,
) {
  const paletteByPrinciple = {
    "negative-space": ["#FF5A5F", "#121826", "#FFF7F2"],
    "modular-system": ["#2563EB", "#0B1F4B", "#E8F1FF"],
    "typographic-relationship": ["#7C3AED", "#24113F", "#F5EDFF"],
  } as const;
  return {
    conceptId,
    principle,
    thesis: `${prefix} construction creates a materially different brand silhouette.`,
    constructionLogic: `${prefix} uses a deliberate contour and counterform whose asymmetric aperture remains recognizable at 16 px.`,
    colorSystem: {
      palette: [...paletteByPrinciple[principle]],
      rationale: `${prefix} uses a distinct chromatic hierarchy tied to its construction rather than a cosmetic hue swap.`,
    },
    rootNodeId: `${prefix}_root`,
    masterNodeId: `${prefix}_master`,
  };
}

function logoDirectionElements(
  prefix: string,
  regionId: string,
  color: string,
): DesignFirstSliceToolInput["firstSlice"]["stages"][number]["elements"] {
  return [
    {
      id: `${prefix}_root`,
      kind: "frame",
      name: `${prefix} concept`,
      parentId: regionId,
      x: 0,
      y: 0,
      width: 342,
      height: 220,
      ...solidAppearance("#FFF7F2"),
    },
    {
      id: `${prefix}_master`,
      kind: "path",
      name: `${prefix} master symbol`,
      parentId: `${prefix}_root`,
      x: 24,
      y: 24,
      width: 96,
      height: 96,
      path: "M 0 0 H 96 V 28 H 28 V 96 H 0 Z",
      ...solidAppearance(color),
    },
  ];
}

function solidAppearance(color: string) {
  return {
    fills: [{ type: "solid" as const, color, opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  };
}
