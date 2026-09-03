import { describe, expect, it } from "vitest";
import { snapGuideLinePath } from "./snap-guide-overlay-controller.js";

describe("snapGuideLinePath", () => {
  it("projects axis, segment, and exact-point smart guides", () => {
    expect(
      snapGuideLinePath({
        axis: "x",
        position: 12,
        range: { start: 4, end: 18 },
        source: "guide",
      }),
    ).toBe("M 12 4 L 12 18");
    expect(
      snapGuideLinePath({
        kind: "segment",
        start: { x: 2, y: 3 },
        end: { x: 17, y: 29 },
        source: "guide",
      }),
    ).toBe("M 2 3 L 17 29");
    expect(
      snapGuideLinePath({
        kind: "point",
        position: { x: 20, y: 30 },
        radius: 3,
        source: "geometry",
      }),
    ).toBe("M 17 30 A 3 3 0 1 0 23 30 A 3 3 0 1 0 17 30");
  });
});
