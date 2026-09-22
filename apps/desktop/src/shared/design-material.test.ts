import { describe, expect, it } from "vitest";
import type { DesignNode } from "@opendesign/design-contracts";
import { compileDesignGenerationElement } from "./design-generation-compiler";
import {
  isVisibleDesignProgress,
  subtreeHasContentLayer,
} from "./design-material";

function nodeWith<T extends DesignNode>(node: T, patch: Partial<T>): T {
  return { ...node, ...patch };
}

function frame(id: string, fills: { color: string; opacity: number }[] = []) {
  return compileDesignGenerationElement({
    id,
    name: id,
    parentId: "artboard",
    kind: "frame",
    x: 0,
    y: 0,
    width: 200,
    height: 120,
    fills: fills.map((fill) => ({ type: "solid" as const, ...fill })),
    strokes: [],
    strokeWidth: 0,
  });
}

function rectangle(id: string) {
  return compileDesignGenerationElement({
    id,
    name: id,
    parentId: "artboard",
    kind: "rectangle",
    x: 0,
    y: 0,
    width: 40,
    height: 24,
    fills: [{ type: "solid" as const, color: "#224466", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  });
}

function text(id: string, content: string) {
  return compileDesignGenerationElement({
    id,
    name: id,
    parentId: "artboard",
    kind: "text",
    x: 0,
    y: 0,
    width: 120,
    height: 24,
    text: {
      content,
      fontFamily: "Inter",
      fontStyleName: "Regular",
      fontWeight: 400,
      fontSlant: "normal",
      fontSize: 16,
      lineHeight: 20,
      textResize: "fixed",
      align: "left",
    },
    fills: [{ type: "solid" as const, color: "#111111", opacity: 1 }],
    strokes: [],
    strokeWidth: 0,
  });
}

function inspected(kind: string, childIds: string[] = []) {
  return { childIds, kind };
}

describe("visible design progress", () => {
  it("counts a painted section Frame as visible layout progress", () => {
    expect(
      isVisibleDesignProgress(
        frame("header", [{ color: "#E8EDF2", opacity: 1 }]),
      ),
    ).toBe(true);
  });

  it("counts a visible border on an unpainted Frame as progress", () => {
    const bordered = frame("header");
    const withStroke = nodeWith(bordered, {
      properties: {
        ...bordered.properties,
        strokes: [{ type: "solid", color: "#333333", opacity: 1 }],
        strokeWidth: 1,
      },
    });
    expect(isVisibleDesignProgress(withStroke)).toBe(true);
  });

  it("rejects blank and unpainted Frames", () => {
    expect(isVisibleDesignProgress(frame("header"))).toBe(false);
    expect(
      isVisibleDesignProgress(
        frame("header", [{ color: "#E8EDF2", opacity: 0 }]),
      ),
    ).toBe(false);
    const blank = frame("header");
    expect(
      isVisibleDesignProgress(
        nodeWith(blank, { properties: { ...blank.properties, fills: [] } }),
      ),
    ).toBe(false);
  });

  it("rejects invisible, transparent, and zero-size progress", () => {
    const painted = frame("header", [{ color: "#E8EDF2", opacity: 1 }]);
    expect(isVisibleDesignProgress(nodeWith(painted, { visible: false }))).toBe(
      false,
    );
    expect(isVisibleDesignProgress(nodeWith(painted, { opacity: 0 }))).toBe(
      false,
    );
    expect(
      isVisibleDesignProgress(
        nodeWith(painted, { size: { width: 0, height: 120 } }),
      ),
    ).toBe(false);
  });

  it("rejects a hidden paint on an otherwise visible node", () => {
    const painted = frame("header", [{ color: "#E8EDF2", opacity: 1 }]);
    expect(
      isVisibleDesignProgress(
        nodeWith(painted, {
          properties: {
            ...painted.properties,
            fills: [
              { type: "solid", color: "#E8EDF2", opacity: 1, visible: false },
            ],
          },
        }),
      ),
    ).toBe(false);
  });

  it("does not treat containers as progress", () => {
    expect(
      isVisibleDesignProgress(
        compileDesignGenerationElement({
          id: "header_group",
          name: "header_group",
          parentId: "artboard",
          kind: "group",
          x: 0,
          y: 0,
          width: 200,
          height: 120,
          fills: [],
          strokes: [],
          strokeWidth: 0,
        }),
      ),
    ).toBe(false);
  });

  it("treats painted content layers as progress and whitespace text as nothing", () => {
    expect(isVisibleDesignProgress(rectangle("panel"))).toBe(true);
    expect(isVisibleDesignProgress(text("label", "Continue"))).toBe(true);
    const blank = text("label", "Continue");
    expect(
      isVisibleDesignProgress(
        nodeWith(blank, {
          properties: { ...blank.properties, content: "   " },
        }),
      ),
    ).toBe(false);
  });
});

describe("subtree content layer", () => {
  const nodesById = new Map<string, { childIds: string[]; kind: string }>([
    ["artboard", inspected("frame", ["header", "main", "footer"])],
    ["header", inspected("frame", [])],
    ["main", inspected("frame", ["main_group"])],
    ["main_group", inspected("group", ["main_content"])],
    ["main_content", inspected("rectangle", [])],
    ["footer", inspected("frame", [])],
  ]);

  it("finds content layers nested under Frames and Groups", () => {
    expect(subtreeHasContentLayer(nodesById, "artboard")).toBe(true);
    expect(subtreeHasContentLayer(nodesById, "main")).toBe(true);
    expect(subtreeHasContentLayer(nodesById, "main_group")).toBe(true);
  });

  it("reports no content layer for a framework-only subtree", () => {
    expect(subtreeHasContentLayer(nodesById, "header")).toBe(false);
    expect(subtreeHasContentLayer(nodesById, "footer")).toBe(false);
    expect(
      subtreeHasContentLayer(
        new Map([["artboard", inspected("frame", ["header"])]]),
        "artboard",
      ),
    ).toBe(false);
  });

  it("reports no content layer for a missing root", () => {
    expect(subtreeHasContentLayer(nodesById, "absent")).toBe(false);
  });
});
