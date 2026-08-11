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
      version: 1,
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

    expect(
      diagnoseDesignTargetLayout(document, "page_layout", "artboard").issues,
    ).toContainEqual(
      expect.objectContaining({
        code: "node-fully-outside-artboard",
        nodeId: "nested_outside",
      }),
    );
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
