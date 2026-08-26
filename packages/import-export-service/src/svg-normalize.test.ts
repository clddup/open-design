import type { DesignNode } from "@opendesign/design-contracts";
import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_IMPORTED_SVG_STYLE,
  importedSvgGroupBounds,
  readImportedSvgStyle,
  readSvgElementTransform,
  readSvgLength,
  readSvgOpacity,
  readSvgStyleOrAttribute,
  rebaseImportedSvgChildren,
} from "./svg-normalize.js";

describe("SVG import normalization family", () => {
  it("normalizes inherited presentation attributes and reports unsupported inline CSS", () => {
    const element = parseElement(
      '<rect fill="#2563eb" style="stroke: #0f172a; stroke-width: 2px; fill-opacity: 40%; mix-blend-mode: multiply"/>',
    );
    const issues: Parameters<typeof readImportedSvgStyle>[2] = [];

    expect(
      readImportedSvgStyle(element, DEFAULT_IMPORTED_SVG_STYLE, issues),
    ).toEqual({
      fill: "#2563eb",
      fillOpacity: 0.4,
      fillRule: "nonzero",
      stroke: "#0f172a",
      strokeCap: "none",
      strokeJoin: "miter",
      strokeOpacity: 1,
      strokeWidth: 2,
      dashPattern: [],
    });
    expect(issues).toEqual([
      expect.objectContaining({
        code: "unsupported-css",
        severity: "warning",
        sourceElement: "rect",
      }),
    ]);
    expect(readSvgStyleOrAttribute(element, "stroke")).toBe("#0f172a");
  });

  it("normalizes transforms and local group bounds without changing document identity", () => {
    const issues: Parameters<typeof readSvgElementTransform>[1] = [];
    expect(
      readSvgElementTransform(
        parseElement('<g transform="translate(12 18) scale(2)"></g>'),
        issues,
      ),
    ).toEqual([2, 0, 0, 2, 12, 18]);
    expect(issues).toEqual([]);

    const invalidIssues: Parameters<typeof readSvgElementTransform>[1] = [];
    expect(
      readSvgElementTransform(
        parseElement('<g transform="translate(nope)"></g>'),
        invalidIssues,
      ),
    ).toEqual([1, 0, 0, 1, 0, 0]);
    expect(invalidIssues[0]).toMatchObject({
      code: "invalid-transform",
      severity: "error",
    });

    const child = rectangle("child", [1, 0, 0, 1, 20, 30], {
      width: 40,
      height: 10,
    });
    const nodes: DesignNode[] = [child];
    expect(importedSvgGroupBounds(nodes, [child.id])).toEqual({
      x: 20,
      y: 30,
      width: 40,
      height: 10,
    });
    rebaseImportedSvgChildren(nodes, [child.id], 20, 30);
    expect(child.transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it("normalizes bounded lengths and opacity while preserving explicit failures", () => {
    const element = parseElement('<rect width="120px" height="40%"/>');
    const issues: Parameters<typeof readSvgLength>[3] = [];
    expect(readSvgLength(element, "width", null, issues)).toBe(120);
    expect(readSvgLength(element, "height", null, issues)).toBeNull();
    expect(issues).toEqual([
      expect.objectContaining({
        code: "invalid-dimension",
        severity: "error",
        sourceElement: "rect",
      }),
    ]);
    expect(readSvgOpacity("160%", 0)).toBe(1);
    expect(readSvgOpacity("-0.5", 1)).toBe(0);
    expect(readSvgOpacity("invalid", 0.75)).toBe(0.75);
  });
});

function parseElement(source: string): Element {
  return new DOMParser().parseFromString(source, "image/svg+xml")
    .documentElement;
}

function rectangle(
  id: string,
  transform: [number, number, number, number, number, number],
  size: { width: number; height: number },
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform,
    size,
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}
