import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { componentProjectionId } from "@opendesign/component-service";
import { describe, expect, it } from "vitest";
import { createEmptyDesignDocument } from "./document.js";
import {
  DesignLayoutQualityReportContract,
  diagnoseDesignTargetLayout,
  isDesignLayoutQualityReport,
} from "./layout-quality.js";
import { planRepairDeliveryOverflow } from "./layout-overflow-repair.js";

describe("deterministic delivery layout quality", () => {
  it("accepts visible material contained by a clipping delivery Frame", () => {
    const document = layoutDocument();
    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );

    expect(report).toMatchObject({
      version: 7,
      checkedNodeCount: 1,
      checkedQualityNodeCount: 0,
      checkedTextNodeCount: 0,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });
    expect(isDesignLayoutQualityReport(report)).toBe(true);
    expect(
      isDesignLayoutQualityReport({ ...report, untrustedPayload: true }),
    ).toBe(false);
  });

  it("reports count and nested measurement failures through one contract", () => {
    const report = diagnoseDesignTargetLayout(
      layoutDocument(),
      "page_layout",
      "artboard",
    );
    expect(
      DesignLayoutQualityReportContract.issues({
        ...report,
        warningCount: 1,
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design.layout_quality_report_warning_count_mismatch",
        path: "/warningCount",
      }),
    );

    const malformed = {
      ...report,
      errorCount: 1,
      issues: [
        {
          code: "interactive-target-overlap",
          severity: "error",
          nodeId: "button",
          message: "Overlap",
          relatedNodeIds: [],
          measurement: {
            kind: "interaction-overlap",
            intersectionArea: 10,
            overlapRatio: 0.5,
          },
        },
      ],
    };
    expect(DesignLayoutQualityReportContract.issues(malformed)[0]?.path).toBe(
      "/issues/0/measurement/otherNodeId",
    );
  });

  it("reports clipping policy, partial, excessive, and fully outside geometry", () => {
    const document = layoutDocument(false);
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const nodes: DesignNode[] = [
      rectangle("partial", "artboard", [1, 0, 0, 1, 270, 20], 40, 40),
      rectangle("excessive", "artboard", [1, 0, 0, 1, 270, 80], 80, 40),
      rectangle("outside", "artboard", [1, 0, 0, 1, 340, 120], 30, 30),
      {
        ...rectangle("hidden", "artboard", [1, 0, 0, 1, 500, 500], 30, 30),
        visible: false,
      },
    ];
    artboard.childIds.push(...nodes.map((node) => node.id));
    nodes.forEach((node) => (document.nodesById[node.id] = node));

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );

    expect(report.errorCount).toBe(2);
    expect(report.warningCount).toBe(2);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "artboard-clipping-disabled" }),
        expect.objectContaining({
          code: "node-partial-artboard-overflow",
          nodeId: "partial",
        }),
        expect.objectContaining({
          code: "node-excessive-artboard-overflow",
          nodeId: "excessive",
        }),
        expect.objectContaining({
          code: "node-fully-outside-artboard",
          nodeId: "outside",
          outsideRatio: 1,
          geometry: {
            coordinateSpace: "world",
            constraint: "artboard",
            nodeBounds: { x: 440, y: 200, width: 30, height: 30 },
            artboardBounds: { x: 100, y: 80, width: 300, height: 200 },
            constraintBounds: { x: 100, y: 80, width: 300, height: 200 },
            parentId: "artboard",
            currentLocalPosition: { x: 340, y: 120 },
            recommendedLocalDelta: { x: -70, y: 0 },
            recommendedLocalPosition: { x: 270, y: 120 },
            requiresResize: false,
          },
        }),
      ]),
    );
    expect(report.issues.some((issue) => issue.nodeId === "hidden")).toBe(
      false,
    );
  });

  it("warns about one high-confidence spacing outlier in repeated UI siblings", () => {
    const document = layoutDocument();
    addRepeatedRow(document, [20, 80, 140, 206], [80, 80, 80, 80]);

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(),
    );

    expect(report).toMatchObject({
      version: 7,
      errorCount: 0,
      warningCount: 1,
    });
    const spacingIssue = report.issues.find(
      (issue) => issue.code === "repeated-layer-spacing-outlier",
    );
    expect(spacingIssue).toMatchObject({
      severity: "warning",
      nodeId: "repeated_3",
      relatedNodeIds: ["artboard", "repeated_2"],
      measurement: {
        kind: "layout-spacing-outlier",
        axis: "horizontal",
        actualGap: 26,
        expectedGap: 20,
        delta: -6,
        tolerance: 1,
        confidence: 0.666667,
        peerNodeIds: ["repeated_0", "repeated_1", "repeated_2", "repeated_3"],
      },
    });
    const malformed = structuredClone(report);
    const measurement = malformed.issues[0]?.measurement;
    if (measurement?.kind !== "layout-spacing-outlier") {
      throw new Error("Missing spacing measurement");
    }
    measurement.delta = 6;
    expect(DesignLayoutQualityReportContract.issues(malformed)).toContainEqual(
      expect.objectContaining({
        code: "design.layout_quality_consistency_delta_invalid",
        path: "/issues/0/measurement/delta",
      }),
    );
  });

  it("warns about one high-confidence cross-axis alignment outlier", () => {
    const document = layoutDocument();
    addRepeatedRow(document, [20, 80, 140, 200], [80, 80, 80, 83]);

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(),
    );

    expect(report).toMatchObject({ errorCount: 0, warningCount: 1 });
    const alignmentIssue = report.issues.find(
      (issue) => issue.code === "repeated-layer-alignment-outlier",
    );
    expect(alignmentIssue).toMatchObject({
      severity: "warning",
      nodeId: "repeated_3",
      relatedNodeIds: ["artboard"],
      measurement: {
        kind: "layout-alignment-outlier",
        axis: "y",
        anchor: "start",
        actualPosition: 163,
        expectedPosition: 160,
        delta: -3,
        tolerance: 1,
        confidence: 0.75,
      },
    });
  });

  it("accepts Figma-style one-pixel rounding and does not infer graphic or Auto Layout intent", () => {
    const roundedDocument = layoutDocument();
    addRepeatedRow(roundedDocument, [20, 80, 139, 199], [80, 80, 80, 80]);
    expect(
      diagnoseDesignTargetLayout(
        roundedDocument,
        "page_layout",
        "artboard",
        uiQualityProfile(),
      ).issues.some((issue) => issue.code.includes("layer-spacing-outlier")),
    ).toBe(false);

    const graphicDocument = layoutDocument();
    addRepeatedRow(graphicDocument, [20, 80, 140, 206], [80, 80, 80, 80]);
    expect(
      diagnoseDesignTargetLayout(graphicDocument, "page_layout", "artboard", {
        kind: "graphic",
      }).issues.some((issue) => issue.code.includes("layer-spacing-outlier")),
    ).toBe(false);

    const autoLayoutDocument = layoutDocument();
    const artboard = autoLayoutDocument.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    artboard.properties.autoLayout = {
      mode: "horizontal",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 20,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    addRepeatedRow(autoLayoutDocument, [20, 80, 140, 206], [80, 80, 80, 80]);
    expect(
      diagnoseDesignTargetLayout(
        autoLayoutDocument,
        "page_layout",
        "artboard",
        uiQualityProfile(),
      ).issues.some((issue) => issue.code.includes("layer-spacing-outlier")),
    ).toBe(false);
  });

  it("does not guess intent for multiple outliers or rotated freeform siblings", () => {
    const multipleOutliers = layoutDocument();
    addRepeatedRow(multipleOutliers, [20, 80, 146, 218], [80, 80, 80, 80]);
    expect(
      diagnoseDesignTargetLayout(
        multipleOutliers,
        "page_layout",
        "artboard",
        uiQualityProfile(),
      ).issues.some((issue) => issue.code.startsWith("repeated-layer-")),
    ).toBe(false);

    const rotated = layoutDocument();
    addRepeatedRow(rotated, [20, 80, 140, 206], [80, 80, 80, 80]);
    const rotatedNode = rotated.nodesById.repeated_3;
    if (!rotatedNode) throw new Error("Missing repeated node");
    const angle = Math.PI / 12;
    rotatedNode.transform = [
      Math.cos(angle),
      Math.sin(angle),
      -Math.sin(angle),
      Math.cos(angle),
      206,
      80,
    ];
    expect(
      diagnoseDesignTargetLayout(
        rotated,
        "page_layout",
        "artboard",
        uiQualityProfile(),
      ).issues.some((issue) => issue.code.startsWith("repeated-layer-")),
    ).toBe(false);
  });

  it("rejects missing, non-Frame, and wrong-Page targets", () => {
    const document = layoutDocument();
    expect(
      diagnoseDesignTargetLayout(document, "page_layout", "inside").issues,
    ).toContainEqual(expect.objectContaining({ code: "target-frame-invalid" }));
    expect(
      diagnoseDesignTargetLayout(document, "missing_page", "artboard").issues,
    ).toContainEqual(expect.objectContaining({ code: "target-frame-invalid" }));
    expect(isDesignLayoutQualityReport({ version: 1 })).toBe(false);
    const hiddenDocument = layoutDocument();
    const hiddenArtboard = hiddenDocument.nodesById.artboard;
    if (hiddenArtboard?.kind !== "frame") throw new Error("Missing artboard");
    hiddenArtboard.visible = false;
    expect(
      diagnoseDesignTargetLayout(hiddenDocument, "page_layout", "artboard")
        .issues,
    ).toContainEqual(expect.objectContaining({ code: "artboard-not-visible" }));
  });

  it("fails closed when the bounded issue list is truncated", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    for (let index = 0; index < 132; index += 1) {
      const node = rectangle(
        `outside_${index}`,
        "artboard",
        [1, 0, 0, 1, 400 + index, 400],
        20,
        20,
      );
      artboard.childIds.push(node.id);
      document.nodesById[node.id] = node;
    }

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );

    expect(report.issues).toHaveLength(128);
    expect(report.issues.at(-1)).toMatchObject({
      code: "quality-scan-truncated",
      severity: "error",
    });
    expect(isDesignLayoutQualityReport(report)).toBe(true);
  });

  it("resolves nested container transforms before testing overflow", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    document.nodesById.nested_group = {
      id: "nested_group",
      kind: "group",
      name: "Nested group",
      parentId: "artboard",
      childIds: ["nested_outside"],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 250, 0],
      size: { width: 100, height: 100 },
      exportSettings: [],
      opacity: 1,
      properties: {},
      extensions: {},
    };
    document.nodesById.nested_outside = rectangle(
      "nested_outside",
      "nested_group",
      [1, 0, 0, 1, 100, 20],
      30,
      30,
    );
    artboard.childIds.push("nested_group");

    const issue = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    ).issues.find((candidate) => candidate.nodeId === "nested_outside");
    expect(issue?.code).toBe("node-fully-outside-artboard");
    expect(issue?.geometry).toMatchObject({
      parentId: "nested_group",
      currentLocalPosition: { x: 100, y: 20 },
      recommendedLocalPosition: { x: 20, y: 20 },
    });
  });

  it("blocks clipped Component projection content with a stable instance source path", () => {
    const document = layoutDocument();
    addClippedComponentInstance(document);

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );
    const projectedRootId = "logo_instance";
    const projectedMarkId = componentProjectionId("logo_instance", [
      "logo_mark",
    ]);

    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "component-node-clipped-by-ancestor",
          severity: "error",
          nodeId: projectedRootId,
          componentTarget: {
            instanceId: "logo_instance",
            sourcePath: ["logo_main"],
          },
          relatedNodeIds: ["artboard", "logo_lockup"],
        }),
        expect.objectContaining({
          code: "component-node-clipped-by-ancestor",
          severity: "error",
          nodeId: projectedMarkId,
          componentTarget: {
            instanceId: "logo_instance",
            sourcePath: ["logo_mark"],
          },
          relatedNodeIds: ["artboard", "logo_lockup"],
        }),
      ]),
    );
    expect(isDesignLayoutQualityReport(report)).toBe(true);
    const malformed = structuredClone(report);
    const componentIssue = malformed.issues.find(
      (issue) => issue.componentTarget !== undefined,
    );
    if (!componentIssue?.componentTarget) {
      throw new Error("Missing Component target issue");
    }
    componentIssue.componentTarget.sourcePath = [];
    expect(isDesignLayoutQualityReport(malformed)).toBe(false);
  });

  it("expands a persistent clipping Frame in one deterministic repair plan", () => {
    const document = layoutDocument();
    addClippedComponentInstance(document);

    const plan = planRepairDeliveryOverflow(
      document,
      "page_layout",
      "artboard",
      "repair_logo",
    );

    expect(plan).toMatchObject({
      ok: true,
      resizedFrameIds: ["logo_lockup"],
      commands: [
        {
          commandId: "repair_logo_expand_0",
          type: "update_properties",
          nodeId: "logo_lockup",
          size: { width: 120, height: 130 },
        },
      ],
    });
    if (!plan.ok) throw new Error(plan.message);
    for (const command of plan.commands) {
      if (command.type !== "update_properties" || !command.size) continue;
      document.nodesById[command.nodeId]!.size = structuredClone(command.size);
    }
    const repaired = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );
    expect(
      repaired.issues.some(
        (issue) => issue.code === "component-node-clipped-by-ancestor",
      ),
    ).toBe(false);
  });

  it("expands the delivery artboard for trailing-edge overflow", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const overflow = rectangle(
      "trailing_overflow",
      "artboard",
      [1, 0, 0, 1, 280, 180],
      50,
      40,
    );
    artboard.childIds.push(overflow.id);
    document.nodesById[overflow.id] = overflow;

    expect(
      planRepairDeliveryOverflow(
        document,
        "page_layout",
        "artboard",
        "repair_artboard",
      ),
    ).toMatchObject({
      ok: true,
      resizedFrameIds: ["artboard"],
      commands: [
        {
          nodeId: "artboard",
          size: { width: 330, height: 220 },
        },
      ],
    });
  });

  it("fails closed instead of shifting leading-edge overflow implicitly", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const overflow = rectangle(
      "leading_overflow",
      "artboard",
      [1, 0, 0, 1, -20, 20],
      50,
      40,
    );
    artboard.childIds.push(overflow.id);
    document.nodesById[overflow.id] = overflow;

    const plan = planRepairDeliveryOverflow(
      document,
      "page_layout",
      "artboard",
      "repair_leading",
    );
    expect(plan).toMatchObject({ ok: false, code: "unsafe-overflow" });
    if (plan.ok) throw new Error("Leading-edge repair must fail closed");
    expect(plan.message).toContain("leading-edge expansion");
  });

  it("returns the observed footer recovery as a parent-local position", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    artboard.size = { width: 1_440, height: 1_500 };
    const footer = rectangle(
      "product_footer_region",
      "artboard",
      [1, 0, 0, 1, 72, 2_100],
      1_296,
      180,
    );
    artboard.childIds.push(footer.id);
    document.nodesById[footer.id] = footer;

    const issue = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    ).issues.find((candidate) => candidate.nodeId === footer.id);
    expect(issue?.code).toBe("node-fully-outside-artboard");
    expect(issue?.geometry).toMatchObject({
      currentLocalPosition: { x: 72, y: 2_100 },
      recommendedLocalDelta: { x: 0, y: -780 },
      recommendedLocalPosition: { x: 72, y: 1_320 },
      requiresResize: false,
    });
  });

  it("checks interactive hit areas against the safe area without duplicate declarations", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const action = rectangle(
      "bottom_navigation_action",
      "artboard",
      [1, 0, 0, 1, 20, 160],
      32,
      32,
    );
    artboard.childIds.push(action.id);
    document.nodesById[action.id] = action;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      {
        kind: "ui",
        platform: "ios",
        interactionMode: "touch",
        safeAreaInsets: { top: 10, right: 0, bottom: 30, left: 0 },
        safeAreaNodeIds: ["inside"],
        interactiveNodeIds: [action.id],
      },
    );

    expect(report).toMatchObject({
      version: 7,
      checkedQualityNodeCount: 2,
      checkedTextNodeCount: 0,
      errorCount: 2,
      qualityProfile: { kind: "ui", platform: "ios" },
    });
    const safeAreaIssue = report.issues.find(
      (issue) => issue.code === "node-outside-safe-area",
    );
    expect(safeAreaIssue).toMatchObject({
      nodeId: action.id,
      geometry: {
        constraint: "safe-area",
        constraintBounds: { x: 100, y: 90, width: 300, height: 160 },
        recommendedLocalPosition: { x: 20, y: 138 },
      },
    });
    const targetSizeIssue = report.issues.find(
      (issue) => issue.code === "interactive-target-too-small",
    );
    expect(targetSizeIssue).toMatchObject({
      nodeId: action.id,
      measurement: {
        kind: "minimum-interactive-size",
        actualSize: { width: 32, height: 32 },
        requiredSize: { width: 44, height: 44 },
        source: "Apple 44pt",
      },
    });
    expect(isDesignLayoutQualityReport(report)).toBe(true);
  });

  it("treats a legacy artboard quality self reference as a no-op", () => {
    const report = diagnoseDesignTargetLayout(
      layoutDocument(),
      "page_layout",
      "artboard",
      {
        kind: "ui",
        platform: "web",
        interactionMode: "pointer",
        safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
        safeAreaNodeIds: ["artboard", "inside"],
        interactiveNodeIds: [],
      },
    );

    expect(report.checkedQualityNodeCount).toBe(1);
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "quality-node-missing" && issue.nodeId === "artboard",
      ),
    ).toBe(false);
  });

  it("accepts an Android 48dp hit area inside the declared safe area", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const action = rectangle(
      "primary_action",
      "artboard",
      [1, 0, 0, 1, 20, 120],
      48,
      48,
    );
    artboard.childIds.push(action.id);
    document.nodesById[action.id] = action;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      {
        kind: "ui",
        platform: "android",
        interactionMode: "touch",
        safeAreaInsets: { top: 8, right: 8, bottom: 8, left: 8 },
        safeAreaNodeIds: [action.id],
        interactiveNodeIds: [action.id],
      },
    );

    expect(report).toMatchObject({
      checkedQualityNodeCount: 1,
      checkedTextNodeCount: 0,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });
  });

  it("blocks intersecting declared hit areas using their transformed polygons", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const primary = rectangle(
      "primary_action",
      "artboard",
      [1, 0, 0, 1, 20, 120],
      48,
      48,
    );
    const secondary = rectangle(
      "secondary_action",
      "artboard",
      [1, 0, 0, 1, 50, 120],
      48,
      48,
    );
    artboard.childIds.push(primary.id, secondary.id);
    document.nodesById[primary.id] = primary;
    document.nodesById[secondary.id] = secondary;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(primary.id, secondary.id),
    );

    expect(report.errorCount).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "interactive-target-overlap",
        severity: "error",
        nodeId: primary.id,
        relatedNodeIds: ["artboard", secondary.id],
        measurement: {
          kind: "interaction-overlap",
          intersectionArea: 864,
          overlapRatio: 0.375,
          otherNodeId: secondary.id,
        },
      }),
    );
    expect(isDesignLayoutQualityReport(report)).toBe(true);
    const issueIndex = report.issues.findIndex(
      (issue) => issue.code === "interactive-target-overlap",
    );
    const malformed = structuredClone(report);
    const measurement = malformed.issues[issueIndex]?.measurement;
    if (measurement?.kind !== "interaction-overlap") {
      throw new Error("Missing interaction overlap measurement");
    }
    measurement.overlapRatio = 1.1;
    expect(isDesignLayoutQualityReport(malformed)).toBe(false);
  });

  it("does not treat edge contact within tolerance as overlapping actions", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const primary = rectangle(
      "primary_action",
      "artboard",
      [1, 0, 0, 1, 20, 120],
      48,
      48,
    );
    const secondary = rectangle(
      "secondary_action",
      "artboard",
      [1, 0, 0, 1, 68, 120],
      48,
      48,
    );
    artboard.childIds.push(primary.id, secondary.id);
    document.nodesById[primary.id] = primary;
    document.nodesById[secondary.id] = secondary;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(primary.id, secondary.id),
    );

    expect(report.errorCount).toBe(0);
    expect(
      report.issues.some(
        (issue) => issue.code === "interactive-target-overlap",
      ),
    ).toBe(false);
  });

  it("does not report rotated targets whose world AABBs overlap but polygons do not", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const rotation = Math.SQRT1_2;
    const primary = rectangle(
      "rotated_primary",
      "artboard",
      [rotation, rotation, -rotation, rotation, 80, 40],
      48,
      48,
    );
    const secondary = rectangle(
      "rotated_secondary",
      "artboard",
      [rotation, rotation, -rotation, rotation, 120, 80],
      48,
      48,
    );
    artboard.childIds.push(primary.id, secondary.id);
    document.nodesById[primary.id] = primary;
    document.nodesById[secondary.id] = secondary;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(primary.id, secondary.id),
    );

    expect(
      report.issues.some(
        (issue) => issue.code === "interactive-target-overlap",
      ),
    ).toBe(false);
  });

  it("blocks a hit area fully covered by an opaque later sibling", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const action = rectangle(
      "covered_action",
      "artboard",
      [1, 0, 0, 1, 20, 120],
      48,
      48,
    );
    const cover = rectangle(
      "opaque_cover",
      "artboard",
      [1, 0, 0, 1, 10, 110],
      68,
      68,
    );
    artboard.childIds.push(action.id, cover.id);
    document.nodesById[action.id] = action;
    document.nodesById[cover.id] = cover;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(action.id),
    );

    expect(report.errorCount).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "interactive-target-fully-occluded",
        severity: "error",
        nodeId: action.id,
        relatedNodeIds: ["artboard", cover.id],
        measurement: {
          kind: "interaction-occlusion",
          coveredRatio: 1,
          occluderNodeId: cover.id,
          proof: "opaque-later-sibling",
        },
      }),
    );
  });

  it("does not claim full occlusion for translucent, rounded, or earlier siblings", () => {
    const documents = [layoutDocument(), layoutDocument(), layoutDocument()];
    documents.forEach((document, index) => {
      const artboard = document.nodesById.artboard;
      if (artboard?.kind !== "frame") throw new Error("Missing artboard");
      const action = rectangle(
        `action_${index}`,
        "artboard",
        [1, 0, 0, 1, 20, 120],
        48,
        48,
      );
      const cover = rectangle(
        `cover_${index}`,
        "artboard",
        [1, 0, 0, 1, 10, 110],
        68,
        68,
      );
      if (index === 0) cover.properties.fills[0]!.opacity = 0.5;
      if (index === 1) cover.properties.cornerRadius = 8;
      artboard.childIds.push(
        ...(index === 2 ? [cover.id, action.id] : [action.id, cover.id]),
      );
      document.nodesById[action.id] = action;
      document.nodesById[cover.id] = cover;
    });

    for (const [index, document] of documents.entries()) {
      const report = diagnoseDesignTargetLayout(
        document,
        "page_layout",
        "artboard",
        uiQualityProfile(`action_${index}`),
      );
      expect(
        report.issues.some(
          (issue) => issue.code === "interactive-target-fully-occluded",
        ),
      ).toBe(false);
    }
  });

  it("fails closed for a degenerate transformed interaction polygon", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const action = rectangle(
      "degenerate_action",
      "artboard",
      [1, 1, 1, 1, 20, 20],
      48,
      48,
    );
    artboard.childIds.push(action.id);
    document.nodesById[action.id] = action;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      uiQualityProfile(action.id),
    );

    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "interaction-geometry-unavailable",
        severity: "error",
        nodeId: action.id,
      }),
    );
  });

  it("blocks provider-proven silent clipping of canonical text content", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const copy = text("body_copy", "artboard", 160, 40);
    artboard.childIds.push(copy.id);
    document.nodesById[copy.id] = copy;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      undefined,
      textEvidence(document, copy.id, {
        overflow: { horizontal: false, vertical: true },
        truncated: false,
        fullContentSize: { width: 160, height: 84 },
        displayedContentSize: { width: 160, height: 84 },
      }),
    );

    expect(report).toMatchObject({
      version: 7,
      checkedTextNodeCount: 1,
      errorCount: 1,
      warningCount: 0,
    });
    expect(
      report.issues.find((issue) => issue.code === "text-content-clipped"),
    ).toMatchObject({
      code: "text-content-clipped",
      severity: "error",
      nodeId: copy.id,
      measurement: {
        kind: "text-layout",
        provider: "test-text",
        boxSize: { width: 160, height: 40 },
        fullContentSize: { width: 160, height: 84 },
      },
    });
    expect(isDesignLayoutQualityReport(report)).toBe(true);
  });

  it("reports explicit ending truncation without treating it as silent loss", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const copy = text("summary", "artboard", 160, 40);
    copy.properties.textTruncation = "ending";
    copy.properties.maxLines = 2;
    artboard.childIds.push(copy.id);
    document.nodesById[copy.id] = copy;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
      undefined,
      textEvidence(document, copy.id, {
        overflow: { horizontal: false, vertical: true },
        truncated: true,
        fullContentSize: { width: 160, height: 84 },
        displayedContentSize: { width: 160, height: 40 },
      }),
    );

    expect(report.errorCount).toBe(0);
    expect(report.warningCount).toBe(1);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "text-ending-truncation-active",
        severity: "warning",
        nodeId: copy.id,
      }),
    );
  });

  it("fails closed when visible text lacks exact-revision shaping evidence", () => {
    const document = layoutDocument();
    const artboard = document.nodesById.artboard;
    if (artboard?.kind !== "frame") throw new Error("Missing artboard");
    const copy = text("body_copy", "artboard", 160, 40);
    artboard.childIds.push(copy.id);
    document.nodesById[copy.id] = copy;

    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );

    expect(report.checkedTextNodeCount).toBe(0);
    expect(report.issues).toContainEqual(
      expect.objectContaining({
        code: "text-layout-evidence-unavailable",
        severity: "error",
        nodeId: copy.id,
      }),
    );
  });
});

function text(
  id: string,
  parentId: string,
  width: number,
  height: number,
): Extract<DesignNode, { kind: "text" }> {
  return {
    id,
    kind: "text",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 80],
    size: { width, height },
    exportSettings: [],
    opacity: 1,
    properties: {
      content: "Canonical text that requires more than the fixed text box.",
      fontFamily: "Inter",
      fontStyleName: null,
      fontSize: 16,
      fontWeight: 400,
      fontSlant: "normal",
      lineHeight: 20,
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
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "clip",
      textTruncation: "disabled",
      maxLines: null,
      fills: [{ type: "solid", color: "#111111", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
    extensions: {},
  };
}

function textEvidence(
  document: DesignDocument,
  nodeId: string,
  measurement: {
    overflow: { horizontal: boolean; vertical: boolean };
    truncated: boolean;
    fullContentSize: { width: number; height: number };
    displayedContentSize: { width: number; height: number };
  },
) {
  const node = document.nodesById[nodeId];
  if (!node) throw new Error("Missing Text node");
  return {
    version: 1 as const,
    documentId: document.documentId,
    revision: document.revision,
    pageId: "page_layout",
    measurements: [
      {
        status: "measured" as const,
        nodeId,
        provider: "test-text",
        providerVersion: "1",
        boxSize: structuredClone(node.size),
        ...measurement,
      },
    ],
  };
}

function layoutDocument(clipsContent = true): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("document_layout", "page_layout"),
  );
  document.nodesById.artboard = {
    id: "artboard",
    kind: "frame",
    name: "Delivery artboard",
    parentId: null,
    childIds: ["inside"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 100, 80],
    size: { width: 300, height: 200 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent,
    },
    extensions: {},
  };
  document.nodesById.inside = rectangle(
    "inside",
    "artboard",
    [1, 0, 0, 1, 20, 20],
    80,
    40,
  );
  document.pagesById.page_layout!.rootNodeIds = ["artboard"];
  return document;
}

function uiQualityProfile(...interactiveNodeIds: string[]) {
  return {
    kind: "ui" as const,
    platform: "android" as const,
    interactionMode: "touch" as const,
    safeAreaInsets: { top: 8, right: 8, bottom: 8, left: 8 },
    safeAreaNodeIds: [...interactiveNodeIds],
    interactiveNodeIds: [...interactiveNodeIds],
  };
}

function addRepeatedRow(
  document: DesignDocument,
  xPositions: number[],
  yPositions: number[],
): void {
  const artboard = document.nodesById.artboard;
  if (artboard?.kind !== "frame") throw new Error("Missing artboard");
  xPositions.forEach((x, index) => {
    const node = rectangle(
      `repeated_${index}`,
      "artboard",
      [1, 0, 0, 1, x, yPositions[index] ?? 80],
      40,
      40,
    );
    artboard.childIds.push(node.id);
    document.nodesById[node.id] = node;
  });
}

function rectangle(
  id: string,
  parentId: string,
  transform: [number, number, number, number, number, number],
  width: number,
  height: number,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform,
    size: { width, height },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#2563eb", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}

function addClippedComponentInstance(document: DesignDocument): void {
  const artboard = document.nodesById.artboard;
  if (artboard?.kind !== "frame") throw new Error("Missing artboard");
  document.nodesById.logo_lockup = {
    id: "logo_lockup",
    kind: "frame",
    name: "Logo lockup preview",
    parentId: "artboard",
    childIds: ["logo_instance"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 120, 20],
    size: { width: 120, height: 100 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#111111", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
      clipsContent: true,
    },
    extensions: {},
  };
  document.nodesById.logo_instance = {
    id: "logo_instance",
    kind: "instance",
    name: "Logo instance",
    parentId: "logo_lockup",
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 20, 50],
    size: { width: 80, height: 80 },
    exportSettings: [],
    opacity: 1,
    properties: {
      componentId: "logo_component",
      componentProperties: {},
      overrides: [],
    },
    extensions: {},
  };
  document.nodesById.logo_main = {
    id: "logo_main",
    kind: "frame",
    name: "Logo Main",
    parentId: null,
    childIds: ["logo_mark"],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 450, 80],
    size: { width: 80, height: 80 },
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
  };
  document.nodesById.logo_mark = rectangle(
    "logo_mark",
    "logo_main",
    [1, 0, 0, 1, 0, 0],
    80,
    80,
  );
  document.componentsById.logo_component = {
    id: "logo_component",
    name: "Logo",
    rootNodeId: "logo_main",
    componentPropertyOrder: [],
    componentPropertyDefinitions: {},
    variantProperties: {},
    extensions: {},
  };
  artboard.childIds.push("logo_lockup");
  document.pagesById.page_layout!.rootNodeIds.push("logo_main");
}
