import { describe, expect, it } from "vitest";
import { snapGuideLinePath } from "./snap-guide-overlay-controller.js";

describe("snapGuideLinePath", () => {
  it("projects axis and arbitrary segment smart guides", () => {
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
  });
});
