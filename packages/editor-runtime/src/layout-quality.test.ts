import type { DesignDocument, DesignNode } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createEmptyDesignDocument } from "./document.js";
import {
  diagnoseDesignTargetLayout,
  isDesignLayoutQualityReport,
} from "./layout-quality.js";

describe("deterministic delivery layout quality", () => {
  it("accepts visible material contained by a clipping delivery Frame", () => {
    const document = layoutDocument();
    const report = diagnoseDesignTargetLayout(
      document,
      "page_layout",
      "artboard",
    );

    expect(report).toMatchObject({
      version: 2,
      checkedNodeCount: 1,
      errorCount: 0,
      warningCount: 0,
      issues: [],
    });
    expect(isDesignLayoutQualityReport(report)).toBe(true);
    expect(
      isDesignLayoutQualityReport({ ...report, untrustedPayload: true }),
    ).toBe(false);
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
            nodeBounds: { x: 440, y: 200, width: 30, height: 30 },
            artboardBounds: { x: 100, y: 80, width: 300, height: 200 },
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
});

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
