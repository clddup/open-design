import { describe, expect, it } from "vitest";
import {
  LAYOUT_SERVICE_CONTRACT_VERSION,
  AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
  solveConstraints,
  solveLinearAutoLayout,
  type HorizontalConstraint,
  type VerticalConstraint,
} from "./index.js";

describe("layout-service constraints v1", () => {
  it.each<[HorizontalConstraint, number, number]>([
    ["left", 20, 40],
    ["right", 120, 40],
    ["left-right", 20, 140],
    ["center", 70, 40],
    ["scale", 40, 80],
  ])("solves horizontal %s", (horizontal, x, width) => {
    const result = solveConstraints({
      version: LAYOUT_SERVICE_CONTRACT_VERSION,
      constraints: { horizontal, vertical: "top" },
      child: { x: 20, y: 30, width: 40, height: 50 },
      previousParent: { width: 100, height: 100 },
      nextParent: { width: 200, height: 100 },
    });
    expect(result).toEqual({
      ok: true,
      rect: { x, y: 30, width, height: 50 },
    });
  });

  it.each<[VerticalConstraint, number, number]>([
    ["top", 30, 50],
    ["bottom", 130, 50],
    ["top-bottom", 30, 150],
    ["center", 80, 50],
    ["scale", 60, 100],
  ])("solves vertical %s", (vertical, y, height) => {
    const result = solveConstraints({
      version: 1,
      constraints: { horizontal: "left", vertical },
      child: { x: 20, y: 30, width: 40, height: 50 },
      previousParent: { width: 100, height: 100 },
      nextParent: { width: 100, height: 200 },
    });
    expect(result).toEqual({
      ok: true,
      rect: { x: 20, y, width: 40, height },
    });
  });

  it("clamps stretched extents and rejects zero-sized source parents", () => {
    expect(
      solveConstraints({
        version: 1,
        constraints: { horizontal: "left-right", vertical: "top-bottom" },
        child: { x: 20, y: 20, width: 40, height: 40 },
        previousParent: { width: 100, height: 100 },
        nextParent: { width: 10, height: 10 },
      }),
    ).toEqual({
      ok: true,
      rect: { x: 20, y: 20, width: 0, height: 0 },
    });
    expect(
      solveConstraints({
        version: 1,
        constraints: { horizontal: "scale", vertical: "top" },
        child: { x: 0, y: 0, width: 1, height: 1 },
        previousParent: { width: 0, height: 100 },
        nextParent: { width: 100, height: 100 },
      }),
    ).toMatchObject({ ok: false, code: "zero-parent-size" });
  });
});

describe("layout-service linear Auto Layout v6", () => {
  it("places horizontal children with padding, gap, and two-axis alignment", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 300, height: 120 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 10,
        primaryAlignment: "center",
        counterAlignment: "end",
        frameSizing: fixedFrame,
        children: [child("one", 40, 20), child("two", 60, 30)],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 300, height: 120 },
      placements: [
        { id: "one", x: 95, y: 90, width: 40, height: 20 },
        { id: "two", x: 145, y: 80, width: 60, height: 30 },
      ],
    });
  });

  it("places vertical children in order and allows deterministic overflow", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 80, height: 50 },
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        gap: 8,
        primaryAlignment: "end",
        counterAlignment: "center",
        frameSizing: fixedFrame,
        children: [child("one", 20, 30), child("two", 40, 30)],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 80, height: 50 },
      placements: [
        { id: "one", x: 30, y: -23, width: 20, height: 30 },
        { id: "two", x: 20, y: 15, width: 40, height: 30 },
      ],
    });
  });

  it("distributes fixed-frame free space as a non-negative Auto gap", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 300, height: 80 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 99,
        primaryAlignment: "space-between",
        counterAlignment: "center",
        frameSizing: fixedFrame,
        children: [
          child("one", 40, 20),
          child("two", 60, 30),
          child("three", 20, 10),
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 300, height: 80 },
      placements: [
        { id: "one", x: 20, y: 30, width: 40, height: 20 },
        { id: "two", x: 130, y: 25, width: 60, height: 30 },
        { id: "three", x: 260, y: 35, width: 20, height: 10 },
      ],
    });

    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 100, height: 50 },
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        gap: 40,
        primaryAlignment: "space-between",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [child("one", 20, 30), child("two", 20, 30)],
      }),
    ).toMatchObject({
      ok: true,
      placements: [
        { id: "one", y: 5 },
        { id: "two", y: 35 },
      ],
    });
  });

  it("starts single children and collapses Auto gap on Hug axes", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 300, height: 80 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 32,
        primaryAlignment: "space-between",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [child("one", 40, 20)],
      }),
    ).toMatchObject({
      ok: true,
      placements: [{ id: "one", x: 20 }],
    });

    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 300, height: 80 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 32,
        primaryAlignment: "space-between",
        counterAlignment: "start",
        frameSizing: { horizontal: "hug", vertical: "fixed" },
        children: [child("one", 40, 20), child("two", 60, 20)],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 140, height: 80 },
      placements: [
        { id: "one", x: 20, y: 10, width: 40, height: 20 },
        { id: "two", x: 60, y: 10, width: 60, height: 20 },
      ],
    });
  });

  it("assigns bounded Fill first and returns its unused remainder to Auto gap", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 360, height: 80 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 24,
        primaryAlignment: "space-between",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [
          child("fixed", 40, 20),
          {
            ...child("bounded_fill", 0, 20, "fill"),
            limits: { maxWidth: 100 },
          },
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 360, height: 80 },
      placements: [
        { id: "fixed", x: 10, y: 10, width: 40, height: 20 },
        { id: "bounded_fill", x: 250, y: 10, width: 100, height: 20 },
      ],
    });
  });

  it("excludes no children implicitly and rejects malformed requests", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 100, height: 100 },
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 100, height: 100 },
      placements: [],
    });
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 100, height: 100 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: -1,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [],
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });

  it("excludes explicitly absolute children from flow and Hug sizing", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 400, height: 100 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 12,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "hug", vertical: "hug" },
        children: [
          child("flow", 80, 30),
          { ...child("badge", 300, 90), positioning: "absolute" },
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 120, height: 50 },
      placements: [{ id: "flow", x: 20, y: 10, width: 80, height: 30 }],
    });
  });

  it("hugs content and distributes main-axis fill space deterministically", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 300, height: 100 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 10,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "fixed", vertical: "hug" },
        children: [
          child("fixed", 40, 20),
          child("fill_one", 1, 30, "fill", "fixed"),
          child("fill_two", 1, 40, "fill", "fixed"),
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 300, height: 60 },
      placements: [
        { id: "fixed", x: 20, y: 10, width: 40, height: 20 },
        { id: "fill_one", x: 70, y: 10, width: 100, height: 30 },
        { id: "fill_two", x: 180, y: 10, width: 100, height: 40 },
      ],
    });
  });

  it("keeps an empty zero-padding Hug Frame stable at zero size", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 0, height: 0 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "hug", vertical: "hug" },
        children: [],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 0, height: 0 },
      placements: [],
    });
  });

  it("fills the counter axis and rejects fill on a hugged axis", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 120, height: 100 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "end",
        frameSizing: fixedFrame,
        children: [child("fill", 20, 30, "fill", "fixed")],
      }),
    ).toMatchObject({
      ok: true,
      placements: [{ id: "fill", x: 10, width: 100 }],
    });
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "vertical",
        frame: { width: 120, height: 100 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "hug", vertical: "fixed" },
        children: [child("fill", 20, 30, "fill", "fixed")],
      }),
    ).toMatchObject({ ok: false, code: "sizing-conflict" });
  });

  it("clamps Hug and Fixed dimensions while always preserving Frame padding", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 50, height: 20 },
        frameLimits: { maxWidth: 55, minHeight: 70 },
        padding: { top: 30, right: 30, bottom: 30, left: 30 },
        gap: 0,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "fixed", vertical: "hug" },
        children: [
          {
            ...child("bounded", 100, 10),
            limits: { minWidth: 120, maxWidth: 140, maxHeight: 8 },
          },
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 60, height: 70 },
      placements: [{ id: "bounded", x: 30, y: 30, width: 120, height: 8 }],
    });
  });

  it("redistributes Fill space after siblings reach min and max limits", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 360, height: 80 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 10,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        children: [
          { ...child("small", 0, 20, "fill"), limits: { maxWidth: 60 } },
          {
            ...child("minimum", 0, 20, "fill"),
            limits: { minWidth: 120 },
          },
          child("flexible", 0, 20, "fill"),
        ],
      }),
    ).toMatchObject({
      ok: true,
      placements: [
        { id: "small", width: 60 },
        { id: "minimum", width: 130 },
        { id: "flexible", width: 130 },
      ],
    });
  });

  it("rejects inverted, negative, and empty dimension limits", () => {
    const request = {
      version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
      direction: "horizontal" as const,
      frame: { width: 200, height: 100 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start" as const,
      counterAlignment: "start" as const,
      frameSizing: fixedFrame,
      children: [child("one", 60, 20)],
    };
    expect(
      solveLinearAutoLayout({
        ...request,
        frameLimits: { minWidth: 200, maxWidth: 100 },
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      solveLinearAutoLayout({
        ...request,
        children: [{ ...request.children[0]!, limits: { minHeight: -1 } }],
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      solveLinearAutoLayout({ ...request, frameLimits: {} }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });

  it("wraps fixed-width children into aligned rows and hugs their total height", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 220, height: 10 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 10,
        primaryAlignment: "center",
        counterAlignment: "center",
        frameSizing: { horizontal: "fixed", vertical: "hug" },
        wrap: { mode: "wrap", counterGap: 12 },
        children: [
          child("one", 80, 20),
          child("two", 90, 30),
          child("three", 60, 25),
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 220, height: 87 },
      placements: [
        { id: "one", x: 20, y: 15, width: 80, height: 20 },
        { id: "two", x: 110, y: 10, width: 90, height: 30 },
        { id: "three", x: 80, y: 52, width: 60, height: 25 },
      ],
    });
  });

  it("resolves Auto gap independently for every wrapped row", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 220, height: 100 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 40,
        primaryAlignment: "space-between",
        counterAlignment: "start",
        frameSizing: fixedFrame,
        wrap: { mode: "wrap", counterGap: 10 },
        children: [
          child("one", 80, 20),
          child("two", 90, 30),
          child("three", 60, 25),
        ],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 220, height: 100 },
      placements: [
        { id: "one", x: 10, y: 10, width: 80, height: 20 },
        { id: "two", x: 120, y: 10, width: 90, height: 30 },
        { id: "three", x: 10, y: 50, width: 60, height: 25 },
      ],
    });
  });

  it("aligns the complete row block in fixed height and preserves oversized overflow", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 120, height: 150 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 8,
        primaryAlignment: "start",
        counterAlignment: "end",
        frameSizing: fixedFrame,
        wrap: { mode: "wrap", counterGap: 6 },
        children: [child("oversized", 140, 20), child("next", 60, 30)],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 120, height: 150 },
      placements: [
        { id: "oversized", x: 10, y: 84, width: 140, height: 20 },
        { id: "next", x: 10, y: 110, width: 60, height: 30 },
      ],
    });
  });

  it("distributes wrapped rows across fixed counter-axis space", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 140, height: 160 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 8,
        primaryAlignment: "start",
        counterAlignment: "center",
        frameSizing: fixedFrame,
        wrap: {
          mode: "wrap",
          counterGap: 6,
          counterAxisAlignContent: "space-between",
        },
        children: [child("one", 60, 20), child("two", 60, 30)],
      }),
    ).toEqual({
      ok: true,
      frame: { width: 140, height: 160 },
      placements: [
        { id: "one", x: 10, y: 10, width: 60, height: 20 },
        { id: "two", x: 10, y: 120, width: 60, height: 30 },
      ],
    });
  });

  it("collapses automatic counter-axis distribution in a hugged Frame", () => {
    expect(
      solveLinearAutoLayout({
        version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
        direction: "horizontal",
        frame: { width: 140, height: 160 },
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        gap: 8,
        primaryAlignment: "start",
        counterAlignment: "start",
        frameSizing: { horizontal: "fixed", vertical: "hug" },
        frameLimits: { minHeight: 120 },
        wrap: {
          mode: "wrap",
          counterGap: 6,
          counterAxisAlignContent: "space-between",
        },
        children: [child("one", 60, 20), child("two", 60, 30)],
      }),
    ).toMatchObject({
      ok: true,
      frame: { width: 140, height: 120 },
      placements: [
        { id: "one", y: 10 },
        { id: "two", y: 30 },
      ],
    });
  });

  it("rejects vertical wrap, Hug width, Fill children, and malformed counter gap", () => {
    const request = {
      version: AUTO_LAYOUT_SERVICE_CONTRACT_VERSION,
      direction: "horizontal" as const,
      frame: { width: 200, height: 100 },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start" as const,
      counterAlignment: "start" as const,
      frameSizing: fixedFrame,
      wrap: { mode: "wrap" as const, counterGap: 8 },
      children: [child("one", 60, 20)],
    };
    expect(
      solveLinearAutoLayout({ ...request, direction: "vertical" }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      solveLinearAutoLayout({
        ...request,
        frameSizing: { horizontal: "hug", vertical: "fixed" },
      }),
    ).toMatchObject({ ok: false, code: "sizing-conflict" });
    expect(
      solveLinearAutoLayout({
        ...request,
        children: [child("fill", 1, 20, "fill", "fixed")],
      }),
    ).toMatchObject({ ok: false, code: "sizing-conflict" });
    expect(
      solveLinearAutoLayout({
        ...request,
        wrap: { mode: "wrap", counterGap: -1 },
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      solveLinearAutoLayout({
        ...request,
        wrap: {
          mode: "wrap",
          counterGap: 8,
          counterAxisAlignContent: "space-evenly" as "auto",
        },
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});

const fixedFrame = { horizontal: "fixed", vertical: "fixed" } as const;

function child(
  id: string,
  width: number,
  height: number,
  horizontal: "fixed" | "fill" = "fixed",
  vertical: "fixed" | "fill" = "fixed",
) {
  return {
    id,
    positioning: "flow" as const,
    width,
    height,
    sizing: { horizontal, vertical },
  };
}
