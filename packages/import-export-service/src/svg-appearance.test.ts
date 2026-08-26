import type { DesignNode } from "@opendesign/design-contracts";
import { DOMImplementation } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import {
  applyExportNodeAppearance,
  applyExportShapeAppearance,
  collectSvgGradientDefinitions,
  importSvgShapeProperties,
  type SvgAppearanceExportContext,
} from "./svg-appearance.js";
import {
  DEFAULT_IMPORTED_SVG_STYLE,
  readImportedSvgStyle,
} from "./svg-normalize.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

describe("SVG appearance family", () => {
  it("serializes and reimports one editable gradient appearance", () => {
    const document = new DOMImplementation().createDocument(
      SVG_NAMESPACE,
      "svg",
      null,
    );
    const definitions = document.createElementNS(SVG_NAMESPACE, "defs");
    const element = document.createElementNS(SVG_NAMESPACE, "rect");
    const context: SvgAppearanceExportContext = {
      definitions,
      document,
      filterSequence: 0,
      gradientSequence: 0,
      issues: [],
    };

    applyExportShapeAppearance(context, element, "hero", {
      fills: [
        {
          type: "linear-gradient",
          opacity: 0.8,
          stops: [
            { offset: 0, color: "#2563eb", opacity: 1 },
            { offset: 1, color: "#7c3aed", opacity: 0.6 },
          ],
          from: { x: 0, y: 0.5 },
          to: { x: 1, y: 0.5 },
          rotation: 15,
        },
      ],
      strokes: [],
      strokeWidth: 0,
      strokeAlign: "center",
      strokeCap: "none",
      strokeJoin: "miter",
      dashPattern: [],
    });
    document.documentElement.appendChild(definitions);
    document.documentElement.appendChild(element);

    expect(element.getAttribute("fill")).toMatch(/^url\(#od_gradient_/);
    expect(element.getAttribute("fill-opacity")).toBe("0.8");
    expect(context.issues).toEqual([]);

    const issues: Parameters<typeof readImportedSvgStyle>[2] = [];
    const imported = importSvgShapeProperties(
      {
        gradientDefinitions: collectSvgGradientDefinitions(
          document.documentElement,
        ),
        issues,
      },
      element,
      readImportedSvgStyle(element, DEFAULT_IMPORTED_SVG_STYLE, issues),
      "hero",
    );
    expect(imported?.fills).toEqual([
      expect.objectContaining({
        type: "linear-gradient",
        opacity: 0.8,
        rotation: 15,
        stops: [
          { offset: 0, color: "#2563eb", opacity: 1 },
          { offset: 1, color: "#7c3aed", opacity: 0.6 },
        ],
      }),
    ]);
    expect(issues).toEqual([]);
  });

  it("owns node visibility, blend and unpaired mask fidelity", () => {
    const document = new DOMImplementation().createDocument(
      SVG_NAMESPACE,
      "svg",
      null,
    );
    const element = document.createElementNS(SVG_NAMESPACE, "rect");
    const context: SvgAppearanceExportContext = {
      definitions: document.createElementNS(SVG_NAMESPACE, "defs"),
      document,
      filterSequence: 0,
      gradientSequence: 0,
      issues: [],
    };
    const node = rectangle();
    node.visible = false;
    node.opacity = 0.5;
    node.blendMode = "multiply";
    node.maskMode = "alpha";

    applyExportNodeAppearance(context, element, node, false);

    expect(element.getAttribute("display")).toBe("none");
    expect(element.getAttribute("opacity")).toBe("0.5");
    expect(element.getAttribute("style")).toBe("mix-blend-mode:multiply");
    expect(context.issues).toEqual([
      expect.objectContaining({
        code: "mask-omitted",
        severity: "warning",
        nodeId: node.id,
      }),
    ]);
  });
});

function rectangle(): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id: "hero",
    kind: "rectangle",
    name: "Hero",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 80 },
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
