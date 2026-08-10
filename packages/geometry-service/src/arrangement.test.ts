import { describe, expect, it } from "vitest";
import {
  alignItems,
  distributeItems,
  GEOMETRY_SERVICE_CONTRACT_VERSION,
  MAX_ARRANGEMENT_SPACING,
  measureItemSpacing,
  setItemSpacing,
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
    expect(GEOMETRY_SERVICE_CONTRACT_VERSION).toBe(1);
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
