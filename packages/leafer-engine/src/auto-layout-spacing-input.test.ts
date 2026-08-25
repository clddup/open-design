import { describe, expect, it } from "vitest";
import { autoLayoutSpacingChangeFromInput } from "./auto-layout-spacing-input.js";

const padding = { top: 8, right: 12, bottom: 16, left: 20 };

describe("Auto Layout spacing numeric input", () => {
  it("updates one padding side, its opposite, or all sides", () => {
    expect(
      autoLayoutSpacingChangeFromInput(
        { kind: "padding-left", padding, paddingScope: "single" },
        24,
      ),
    ).toEqual({
      kind: "padding",
      value: { top: 8, right: 12, bottom: 16, left: 24 },
    });
    expect(
      autoLayoutSpacingChangeFromInput(
        { kind: "padding-left", padding, paddingScope: "opposite" },
        24,
      ),
    ).toEqual({
      kind: "padding",
      value: { top: 8, right: 24, bottom: 16, left: 24 },
    });
    expect(
      autoLayoutSpacingChangeFromInput(
        { kind: "padding-left", padding, paddingScope: "all" },
        24,
      ),
    ).toEqual({
      kind: "padding",
      value: { top: 24, right: 24, bottom: 24, left: 24 },
    });
  });

  it("returns semantic main and counter gap changes", () => {
    expect(
      autoLayoutSpacingChangeFromInput(
        { kind: "gap", padding, paddingScope: "single" },
        18,
      ),
    ).toEqual({ kind: "gap", value: 18 });
    expect(
      autoLayoutSpacingChangeFromInput(
        { kind: "counter-gap", padding, paddingScope: "single" },
        22,
      ),
    ).toEqual({ kind: "counter-gap", value: 22 });
  });

  it("rejects non-finite, negative, and excessive values", () => {
    const input = {
      kind: "gap" as const,
      padding,
      paddingScope: "single" as const,
    };
    expect(autoLayoutSpacingChangeFromInput(input, Number.NaN)).toBeNull();
    expect(autoLayoutSpacingChangeFromInput(input, -1)).toBeNull();
    expect(autoLayoutSpacingChangeFromInput(input, 1_000_001)).toBeNull();
  });
});
