import { describe, expect, it } from "vitest";
import {
  LAYOUT_SERVICE_CONTRACT_VERSION,
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

describe("layout-service linear Auto Layout v1", () => {
  it("places horizontal children with padding, gap, and two-axis alignment", () => {
    expect(
      solveLinearAutoLayout({
        version: 1,
        direction: "horizontal",
        frame: { width: 300, height: 120 },
        padding: { top: 10, right: 20, bottom: 10, left: 20 },
        gap: 10,
        primaryAlignment: "center",
        counterAlignment: "end",
        children: [
          { id: "one", width: 40, height: 20 },
          { id: "two", width: 60, height: 30 },
        ],
      }),
    ).toEqual({
      ok: true,
      placements: [
        { id: "one", x: 95, y: 90 },
        { id: "two", x: 145, y: 80 },
      ],
    });
  });

  it("places vertical children in order and allows deterministic overflow", () => {
    expect(
      solveLinearAutoLayout({
        version: 1,
        direction: "vertical",
        frame: { width: 80, height: 50 },
        padding: { top: 5, right: 5, bottom: 5, left: 5 },
        gap: 8,
        primaryAlignment: "end",
        counterAlignment: "center",
        children: [
          { id: "one", width: 20, height: 30 },
          { id: "two", width: 40, height: 30 },
        ],
      }),
    ).toEqual({
      ok: true,
      placements: [
        { id: "one", x: 30, y: -23 },
        { id: "two", x: 20, y: 15 },
      ],
    });
  });

  it("excludes no children implicitly and rejects malformed requests", () => {
    expect(
      solveLinearAutoLayout({
        version: 1,
        direction: "vertical",
        frame: { width: 100, height: 100 },
        padding: { top: 8, right: 8, bottom: 8, left: 8 },
        gap: 4,
        primaryAlignment: "start",
        counterAlignment: "start",
        children: [],
      }),
    ).toEqual({ ok: true, placements: [] });
    expect(
      solveLinearAutoLayout({
        version: 1,
        direction: "horizontal",
        frame: { width: 100, height: 100 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        gap: -1,
        primaryAlignment: "start",
        counterAlignment: "start",
        children: [],
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});
