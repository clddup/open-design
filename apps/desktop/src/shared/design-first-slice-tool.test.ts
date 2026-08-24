import { describe, expect, it } from "vitest";
import { schemaValidationIssues } from "@opendesign/design-contracts";
import {
  BUILTIN_GRAPHIC_DESIGN_SKILL_REFS,
  BUILTIN_LOGO_DESIGN_SKILL_REFS,
  BUILTIN_UI_DESIGN_SKILL_REFS,
} from "@opendesign/design-skills";
import {
  compileDesignFirstSliceToolInput,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  FirstSliceContract,
  logoBriefRequiresExploration,
  type DesignFirstSliceToolInput,
} from "./design-first-slice-tool";
import { DesignApplyContract, DesignPlanContract } from "./design-agent-tools";

describe("compact first-slice tool", () => {
  it("keeps Provider schema budgets aligned with runtime validation", () => {
    const properties = DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA.properties;
    expect(properties.firstSlice.properties.stages.maxItems).toBe(3);
    expect(Object.keys(properties).sort()).toEqual(
      [
        "deliverable",
        "designIntent",
        "firstSlice",
        "logoExploration",
        "logoOutputs",
        "objective",
        "rasterAssetRoles",
        "semanticObjects",
        "targets",
        "version",
        "visualSystem",
      ].sort(),
    );
    expect(JSON.stringify(properties)).not.toContain('"qualityProfile"');
    expect(JSON.stringify(properties)).not.toContain('"briefFidelity"');
    expect(JSON.stringify(properties)).not.toContain('"skillRefs"');
    expect(
      properties.firstSlice.properties.stages.items.properties.elements
        .maxItems,
    ).toBe(48);
    expect(properties.firstSlice.properties.stages.description).toContain(
      "total across all stages",
    );
    expect(properties.designIntent.description).toContain(
      "not a per-element rationale",
    );
    expect(properties.designIntent.properties.visualThesis.maxLength).toBe(320);
    expect(properties.designIntent.properties.antiPatterns.maxItems).toBe(5);
    expect(properties.targets.items.properties.layout.maxLength).toBe(320);
    expect(properties.visualSystem.properties.typography.maxItems).toBe(4);
    expect(DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA.required).toEqual([
      "version",
      "deliverable",
      "objective",
      "designIntent",
      "targets",
      "visualSystem",
      "rasterAssetRoles",
      "firstSlice",
    ]);
    const valid = providerInput(fixture());
    expect(
      schemaValidationIssues(DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA, valid),
    ).toHaveLength(0);
    expect(FirstSliceContract.parse(valid).ok).toBe(true);
    const unexpected = { ...valid, hiddenLimit: 32 };
    expect(
      schemaValidationIssues(DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA, unexpected),
    ).not.toHaveLength(0);
    expect(FirstSliceContract.parse(unexpected).ok).toBe(false);
  });

  it("preserves the model's brief-specific direction while binding only trusted host metadata", () => {
    const modelInput = providerInput(fixture());
    const normalized = parsedFirstSlice(modelInput);
    expect(normalized).toBeDefined();
    expect(normalized?.designIntent.visualThesis).toBe(
      fixture().designIntent.visualThesis,
    );
    expect(normalized?.briefFidelity.requiredContent).toEqual([
      "Create Home and Profile screens",
    ]);
    expect(normalized?.visualSystem.palette).toContain("#0F172A");
    expect(normalized?.targets[0]).toMatchObject({
      objective: "A focused product overview",
      layout: "Vertical mobile composition",
      spacing: "8px base with 24px section rhythm",
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

  it("rejects drawing without a prior concrete visual direction", () => {
    const modelInput = providerInput(fixture());
    Reflect.deleteProperty(modelInput, "designIntent");

    const result = FirstSliceContract.parse(modelInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected missing design intent failure");
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "first_slice.schema_invalid",
          path: "/designIntent",
        }),
      ]),
    );
  });

  it("carries image roles and reusable semantic objects into the executable Plan", () => {
    const modelInput = providerInput(fixture());
    modelInput.rasterAssetRoles = ["hero", "supporting-content"];
    modelInput.semanticObjects = [
      {
        decisionId: "shared_navigation",
        label: "Shared bottom navigation",
        decision: "component",
        componentId: "component_bottom_navigation",
        main: { targetId: "home", nodeId: "home_bottom_navigation" },
        instances: [
          { targetId: "profile", nodeId: "profile_bottom_navigation" },
        ],
      },
    ];

    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.rasterAssetRoles).toEqual([
      "hero",
      "supporting-content",
    ]);
    expect(normalized?.semanticObjects).toEqual(modelInput.semanticObjects);
    expect(
      normalized && compileDesignFirstSliceToolInput(normalized).plan,
    ).toMatchObject({
      rasterAssetRoles: ["hero", "supporting-content"],
      componentStrategy: {
        candidates: [
          {
            decision: "component",
            componentId: "component_bottom_navigation",
          },
        ],
      },
    });
  });

  it("uses the element kind discriminator to report the concrete invalid field", () => {
    const modelInput = providerInput(fixture());
    const firstSlice = modelInput.firstSlice as {
      stages: Array<{ elements: Array<Record<string, unknown>> }>;
    };
    Reflect.deleteProperty(firstSlice.stages[0].elements[0], "fill");

    const result = FirstSliceContract.parse(modelInput);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected element schema failure");
    expect(result.issues[0]).toMatchObject({
      code: "first_slice.schema_invalid",
      path: "/firstSlice/stages/0/elements/0/fill",
    });
    expect(result.issues[0]?.message).not.toContain("union");
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

  it("recognizes explicit multi-direction Logo briefs without treating focused marks as exploration", () => {
    expect(
      logoBriefRequiresExploration(
        "Concept Exploration 提供 3 个真正不同的设计方向",
      ),
    ).toBe(true);
    expect(
      logoBriefRequiresExploration(
        "Create three genuinely different logo directions with optical tests",
      ),
    ).toBe(true);
    expect(
      logoBriefRequiresExploration("Create one focused Logo and App Icon"),
    ).toBe(false);
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
    input.semanticObjects = [
      {
        decisionId: "catalog-navigation",
        label: "Product navigation",
        decision: "reuse-component",
        componentId: "component_catalog_navigation",
        instances: [
          { targetId: "profile", nodeId: "profile_navigation_instance" },
        ],
      },
    ];
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
        signatureMotif:
          "A cropped directional panel and offset type axis create a recognizable motion cue.",
      },
      briefFidelity: {
        requiredContent: ["Home and Profile product screens"],
        prohibitedAdditions: ["No unrequested workflow or run features"],
      },
      referenceStrategy: input.referenceStrategy,
      componentStrategy: {
        candidates: [
          {
            decision: "reuse-component",
            componentId: "component_catalog_navigation",
            instances: [
              {
                targetId: "profile",
                nodeId: "profile_navigation_instance",
              },
            ],
          },
        ],
      },
    });
    expect(
      compiled.plan.targets.map((target) => target.artboard.frameId),
    ).toEqual(["frame_home", "frame_profile"]);
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
    input.logoOutputs = ["symbol", "app-icon"];
    input.targets = input.targets.map((target) => ({
      ...target,
      qualityProfile: { kind: "graphic" },
    }));
    input.targets[0].regions.push(
      {
        nodeId: "negative_root",
        name: "Negative Space Direction",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 80,
        width: 342,
        height: 220,
      },
      {
        nodeId: "modular_root",
        name: "Modular Direction",
        role: "content",
        parentId: "frame_home",
        x: 24,
        y: 324,
        width: 342,
        height: 220,
      },
      {
        nodeId: "typographic_root",
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
    input.firstSlice.stages[0].elements[0] = {
      id: "hero_panel",
      kind: "path",
      name: "Editable Identity Contour",
      parentId: "negative_root",
      x: 24,
      y: 24,
      width: 160,
      height: 160,
      path: "M 0 0 H 160 V 48 H 48 V 160 H 0 Z",
      fill: { color: "#0F172A" },
    };
    input.firstSlice.stages[0].elements[1].parentId = "negative_root";

    const modelInput = providerInput(input);
    const normalized = parsedFirstSlice(modelInput);
    expect(normalized?.skillRefs).toEqual(BUILTIN_LOGO_DESIGN_SKILL_REFS);
    expect(
      normalized &&
        compileDesignFirstSliceToolInput(normalized).apply.commands[0],
    ).toMatchObject({
      node: {
        kind: "path",
        properties: {
          path: "M 0 0 H 160 V 48 H 48 V 160 H 0 Z",
          fillRule: "nonzero",
        },
      },
    });

    if (!normalized) throw new Error("Expected parsed Logo input");
    const aliasedPlan = compileDesignFirstSliceToolInput(normalized).plan;
    const firstDirection = aliasedPlan.logoExploration?.directions[0];
    if (!firstDirection) throw new Error("Expected compiled Logo exploration");
    firstDirection.monochromeNodeId = firstDirection.smallSizeNodeIds[0];
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
    expect(FirstSliceContract.parse(duplicatePrinciple).ok).toBe(false);

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
    expect(FirstSliceContract.parse(unplannedConceptRoot).ok).toBe(false);

    const laterTargetExploration = structuredClone(modelInput) as {
      logoExploration?: NonNullable<
        DesignFirstSliceToolInput["logoExploration"]
      >;
    };
    if (!laterTargetExploration.logoExploration) {
      throw new Error("Expected Logo exploration fixture");
    }
    laterTargetExploration.logoExploration.targetId = "profile";
    expect(FirstSliceContract.parse(laterTargetExploration).ok).toBe(false);

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
    expect(parseCanonicalProjection(wrongTarget).ok).toBe(false);

    const crossTargetFrameCollision = fixture();
    crossTargetFrameCollision.targets[0].regions[0].nodeId = "frame_profile";
    for (const element of crossTargetFrameCollision.firstSlice.stages[0]
      .elements) {
      element.parentId = "frame_profile";
    }
    const collisionResult = parseCanonicalProjection(crossTargetFrameCollision);
    expect(collisionResult.ok).toBe(false);
    if (collisionResult.ok) throw new Error("Expected ID collision");
    expect(collisionResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.region_frame_id_conflict",
        path: "/targets/0/regions/0/nodeId",
        actual: "frame_profile",
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
        fill: { color: "#7C3AED" },
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
            fill: { color: "#F8FAFC" },
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

  it("bounds the first visible write to planned regions, three stages and 48 model elements with a field-level recovery", () => {
    const tooManyElements = fixture();
    const stage = tooManyElements.firstSlice.stages[0];
    for (let index = 0; index < 23; index += 1) {
      stage.elements.push({
        id: `support_${index}`,
        kind: "rectangle",
        name: `Support ${index}`,
        parentId: "home_hero",
        x: 8 + index,
        y: 160,
        width: 8,
        height: 8,
        fill: { color: "#7C3AED" },
      });
    }
    tooManyElements.firstSlice.stages.push({
      stageId: "secondary_content",
      label: "Build secondary content",
      elements: Array.from({ length: 24 }, (_, index) => ({
        id: `secondary_${index}`,
        kind: "rectangle" as const,
        name: `Secondary ${index}`,
        parentId: "home_hero",
        x: 8 + index,
        y: 180,
        width: 8,
        height: 8,
        fill: { color: "#7C3AED" },
      })),
    });
    const tooManyResult = parseCanonicalProjection(tooManyElements);
    expect(tooManyResult.ok).toBe(false);
    if (tooManyResult.ok) throw new Error("Expected element budget failure");
    expect(tooManyResult.issues).toContainEqual(
      expect.objectContaining({
        code: "first_slice.element_limit_exceeded",
        path: "/firstSlice/stages",
        expected: 48,
        actual: 49,
      }),
    );

    const tooManyStages = fixture();
    for (let index = 0; index < 3; index += 1) {
      tooManyStages.firstSlice.stages.push({
        stageId: `extra_stage_${index}`,
        label: `Extra stage ${index}`,
        elements: [
          {
            id: `extra_${index}`,
            kind: "rectangle",
            name: `Extra ${index}`,
            parentId: "home_hero",
            x: 12 + index * 12,
            y: 180,
            width: 8,
            height: 8,
            fill: { color: "#7C3AED" },
          },
        ],
      });
    }
    expect(parseCanonicalProjection(tooManyStages).ok).toBe(false);

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
          fill: { color: "#7C3AED" },
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
  for (const key of ["skillRefs", "briefFidelity", "referenceStrategy"]) {
    Reflect.deleteProperty(value, key);
  }
  for (const target of value.targets as Array<Record<string, unknown>>) {
    Reflect.deleteProperty(target, "qualityProfile");
  }
  return value;
}

function parsedFirstSlice(
  input: unknown,
  context: { authoritativePrompt?: string } = {},
): DesignFirstSliceToolInput | undefined {
  const result = FirstSliceContract.parse(input, context);
  return result.ok ? result.value : undefined;
}

function parseCanonicalProjection(input: DesignFirstSliceToolInput) {
  return FirstSliceContract.parse(providerInput(input));
}

export function fixture(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create Home and Profile screens",
    designIntent: {
      subject: "A mobile product for maintaining creative momentum",
      audience: "Independent designers managing focused daily work",
      primaryJob: "See the next meaningful task and continue it immediately",
      visualThesis:
        "Momentum is expressed as a directional editorial system rather than a generic mobile card stack.",
      signatureMotif:
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
      requiredContent: ["Home and Profile product screens"],
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
      {
        targetId: "profile",
        label: "Profile",
        pageId: "page_1",
        objective: "A clear account overview",
        frame: {
          frameId: "frame_profile",
          x: 510,
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
          safeNodeIds: ["profile_header"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "profile_header",
            name: "Profile Header",
            role: "content",
            parentId: "frame_profile",
            x: 24,
            y: 80,
            width: 342,
            height: 220,
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
              fill: { color: "#EDE9FE" },
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
              text: {
                content: "Design with momentum",
                fontFamily: "Inter",
                fontStyleName: "Bold",
                fontWeight: 700,
                fontSlant: "normal",
                fontSize: 32,
                lineHeight: 38,
                color: "#0F172A",
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
  return {
    conceptId,
    principle,
    thesis: `${prefix} construction creates a materially different brand silhouette.`,
    constructionLogic: `${prefix} uses a deliberate contour and counterform whose asymmetric aperture remains recognizable at 16 px.`,
    rootNodeId: `${prefix}_root`,
    evidenceNodeIds: [
      `${prefix}_mono`,
      `${prefix}_32`,
      `${prefix}_24`,
      `${prefix}_16`,
    ] as [string, string, string, string],
  };
}
