import { describe, expect, it } from "vitest";
import {
  alignItems,
  distributeItems,
  GEOMETRY_SERVICE_CONTRACT_VERSION,
  MAX_ARRANGEMENT_SPACING,
  measureItemSpacing,
  setItemSpacing,
  tidyUpItems,
  type ArrangementItem,
} from "./index.js";

const items = (
  ...values: Array<[string, number, number, number, number]>
): ArrangementItem[] =>
  values.map(([id, x, y, width, height]) => ({
    id,
    bounds: { x, y, width, height },
  }));

describe("geometry arrangement", () => {
  it("exposes a stable service contract version", () => {
    expect(GEOMETRY_SERVICE_CONTRACT_VERSION).toBe(7);
  });

  it("aligns unequal items against the requested selection edge or center", () => {
    const source = items(["one", 10, 20, 20, 10], ["two", 50, 70, 40, 30]);
    expect(alignItems(source, "align-left")).toMatchObject({
      ok: true,
      axis: "horizontal",
      placements: [
        { id: "one", delta: { x: 0, y: 0 } },
        { id: "two", delta: { x: -40, y: 0 } },
      ],
    });
    expect(alignItems(source, "align-vertical-center")).toMatchObject({
      ok: true,
      axis: "vertical",
      placements: [
        { id: "one", delta: { x: 0, y: 35 } },
        { id: "two", delta: { x: 0, y: -25 } },
      ],
    });
  });

  it("distributes spacing while preserving distinct outermost layers", () => {
    const plan = distributeItems(
      items(
        ["left", 10, 0, 20, 10],
        ["middle", 90, 0, 40, 10],
        ["right", 200, 0, 30, 10],
      ),
      "horizontal",
    );
    expect(plan).toMatchObject({
      ok: true,
      orderedIds: ["left", "middle", "right"],
      resolvedSpacing: 65,
      placements: [
        { id: "left", targetLeadingEdge: 10, delta: { x: 0, y: 0 } },
        { id: "middle", targetLeadingEdge: 95, delta: { x: 5, y: 0 } },
        { id: "right", targetLeadingEdge: 200, delta: { x: 0, y: 0 } },
      ],
    });
  });

  it("sets explicit positive or negative spacing from the leading layer", () => {
    const source = items(
      ["one", 0, 0, 40, 10],
      ["two", 70, 0, 20, 10],
      ["three", 140, 0, 30, 10],
    );
    expect(setItemSpacing(source, "horizontal", 12)).toMatchObject({
      ok: true,
      resolvedSpacing: 12,
      placements: [
        { id: "one", targetLeadingEdge: 0 },
        { id: "two", targetLeadingEdge: 52 },
        { id: "three", targetLeadingEdge: 84 },
      ],
    });
    expect(setItemSpacing(source, "horizontal", -8)).toMatchObject({
      ok: true,
      resolvedSpacing: -8,
      placements: [
        { id: "one", targetLeadingEdge: 0 },
        { id: "two", targetLeadingEdge: 32 },
        { id: "three", targetLeadingEdge: 44 },
      ],
    });
  });

  it("measures uniform spacing and only reports a mode when one repeats", () => {
    expect(
      measureItemSpacing(
        items(
          ["one", 0, 0, 10, 10],
          ["two", 20, 0, 10, 10],
          ["three", 40, 0, 10, 10],
        ),
        "horizontal",
      ),
    ).toMatchObject({ ok: true, gaps: [10, 10], uniform: true, value: 10 });
    expect(
      measureItemSpacing(
        items(
          ["one", 0, 0, 10, 10],
          ["two", 20, 0, 10, 10],
          ["three", 45, 0, 10, 10],
        ),
        "horizontal",
      ),
    ).toMatchObject({ ok: true, gaps: [10, 15], uniform: false, value: null });
  });

  it("tidies a one-dimensional row using the leading gap mode without changing y", () => {
    expect(
      tidyUpItems(
        items(
          ["one", 10, 20, 20, 20],
          ["two", 50, 24, 30, 18],
          ["three", 110, 18, 10, 24],
          ["four", 170, 22, 40, 16],
        ),
      ),
    ).toMatchObject({
      ok: true,
      dimension: "horizontal",
      horizontalSpacing: 20,
      orderedIds: ["one", "two", "three", "four"],
      placements: [
        { id: "one", target: { x: 10, y: 20 } },
        { id: "two", target: { x: 50, y: 24 } },
        { id: "three", target: { x: 100, y: 18 } },
        { id: "four", target: { x: 130, y: 22 } },
      ],
    });
  });

  it("tidies an unequal two-dimensional grid from the top-left anchor", () => {
    expect(
      tidyUpItems(
        items(
          ["a", 10, 20, 30, 20],
          ["b", 60, 22, 40, 30],
          ["c", 120, 18, 20, 25],
          ["d", 12, 80, 20, 40],
          ["e", 62, 88, 30, 20],
          ["f", 130, 82, 50, 35],
        ),
      ),
    ).toMatchObject({
      ok: true,
      dimension: "grid",
      horizontalSpacing: 20,
      verticalSpacing: 40,
      orderedIds: ["a", "b", "c", "d", "e", "f"],
      placements: [
        { id: "a", target: { x: 10, y: 18 } },
        { id: "b", target: { x: 60, y: 18 } },
        { id: "c", target: { x: 120, y: 18 } },
        { id: "d", target: { x: 10, y: 88 } },
        { id: "e", target: { x: 60, y: 88 } },
        { id: "f", target: { x: 120, y: 88 } },
      ],
    });
  });

  it("supports sparse grids and deterministic leading-gap ties", () => {
    expect(
      tidyUpItems(
        items(
          ["a", 0, 0, 30, 30],
          ["b", 50, 0, 30, 30],
          ["c", 0, 50, 30, 30],
          ["d", 50, 130, 30, 30],
        ),
      ),
    ).toMatchObject({
      ok: true,
      dimension: "grid",
      horizontalSpacing: 20,
      verticalSpacing: 20,
      orderedIds: ["a", "b", "c", "d"],
      placements: [
        { id: "a" },
        { id: "b" },
        { id: "c" },
        { id: "d", target: { x: 50, y: 100 } },
      ],
    });
  });

  it("supports negative one-dimensional spacing", () => {
    expect(
      tidyUpItems(
        items(
          ["a", 0, 0, 30, 30],
          ["b", 20, 2, 30, 30],
          ["c", 55, 0, 30, 30],
          ["d", 75, 3, 30, 30],
        ),
      ),
    ).toMatchObject({
      ok: true,
      dimension: "horizontal",
      horizontalSpacing: -10,
      placements: [
        { id: "a", target: { x: 0, y: 0 } },
        { id: "b", target: { x: 20, y: 2 } },
        { id: "c", target: { x: 40, y: 0 } },
        { id: "d", target: { x: 60, y: 3 } },
      ],
    });
  });

  it("keeps touching zero-gap rows and columns distinct", () => {
    expect(
      tidyUpItems(
        items(
          ["a", 0, 0, 10, 10],
          ["b", 10, 0, 10, 10],
          ["c", 0, 10, 10, 10],
          ["d", 12, 12, 10, 10],
        ),
      ),
    ).toMatchObject({
      ok: true,
      dimension: "grid",
      horizontalSpacing: 0,
      verticalSpacing: 0,
      placements: [
        { id: "a", target: { x: 0, y: 0 } },
        { id: "b", target: { x: 10, y: 0 } },
        { id: "c", target: { x: 0, y: 10 } },
        { id: "d", target: { x: 10, y: 10 } },
      ],
    });
  });

  it("rejects diagonal, bridging, fully overlapping, and already tidy layouts", () => {
    expect(
      tidyUpItems(
        items(
          ["a", 0, 0, 10, 10],
          ["b", 20, 20, 10, 10],
          ["c", 40, 40, 10, 10],
        ),
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-anchors" });
    expect(
      tidyUpItems(
        items(
          ["top", 0, 0, 20, 20],
          ["bridge", 30, 10, 20, 40],
          ["bottom", 60, 40, 20, 20],
        ),
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-anchors" });
    expect(
      tidyUpItems(
        items(["a", 0, 0, 20, 20], ["b", 0, 0, 20, 20], ["c", 0, 0, 20, 20]),
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-anchors" });
    expect(
      tidyUpItems(
        items(["a", 0, 0, 10, 10], ["b", 20, 0, 10, 10], ["c", 40, 0, 10, 10]),
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
  });

  it("rejects no-op, non-finite, duplicate, and ambiguous selections", () => {
    const even = items(
      ["one", 0, 0, 10, 10],
      ["two", 20, 0, 10, 10],
      ["three", 40, 0, 10, 10],
    );
    expect(distributeItems(even, "horizontal")).toMatchObject({
      ok: false,
      code: "no-op",
    });
    expect(setItemSpacing(even, "horizontal", Number.NaN)).toMatchObject({
      ok: false,
      code: "invalid-input",
    });
    expect(
      setItemSpacing(even, "horizontal", MAX_ARRANGEMENT_SPACING + 1),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(
      alignItems(
        items(
          ["huge", Number.MAX_VALUE, 0, Number.MAX_VALUE, 10],
          ["normal", 0, 0, 10, 10],
        ),
        "align-right",
      ),
    ).toMatchObject({ ok: false, code: "invalid-input" });
    expect(alignItems([even[0]!, { ...even[0]! }], "align-left")).toMatchObject(
      { ok: false, code: "invalid-input" },
    );
    expect(
      distributeItems(
        items(
          ["outer", 0, 0, 100, 10],
          ["middle", 20, 0, 10, 10],
          ["inner", 40, 0, 10, 10],
        ),
        "horizontal",
      ),
    ).toMatchObject({ ok: false, code: "ambiguous-anchors" });
  });
});
