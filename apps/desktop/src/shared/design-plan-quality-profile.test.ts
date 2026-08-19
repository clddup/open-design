import { describe, expect, it } from "vitest";
import {
  isDesignTargetQualityProfile,
  minimumInteractiveTargetSize,
  qualityProfileNodeIds,
  type DesignTargetQualityProfile,
} from "./design-plan-quality-profile";

describe("design target quality profile", () => {
  const uiProfile: Extract<DesignTargetQualityProfile, { kind: "ui" }> = {
    kind: "ui",
    platform: "ios",
    interactionMode: "touch",
    safeAreaInsets: { top: 59, right: 0, bottom: 34, left: 0 },
    safeAreaNodeIds: ["header", "primary_action"],
    interactiveNodeIds: ["primary_action"],
  };

  it("accepts explicit UI policy and derives platform-owned target sizes", () => {
    expect(
      isDesignTargetQualityProfile(uiProfile, { width: 390, height: 844 }),
    ).toBe(true);
    expect(minimumInteractiveTargetSize(uiProfile)).toEqual({
      width: 44,
      height: 44,
      source: "Apple 44pt",
    });
    expect(
      minimumInteractiveTargetSize({
        ...uiProfile,
        platform: "android",
      }),
    ).toMatchObject({ width: 48, height: 48 });
    expect(
      minimumInteractiveTargetSize({
        ...uiProfile,
        platform: "web",
        interactionMode: "pointer",
      }),
    ).toMatchObject({ width: 24, height: 24 });
  });

  it("rejects unsafe insets and duplicate IDs while keeping quality concerns independent", () => {
    expect(
      isDesignTargetQualityProfile(
        {
          ...uiProfile,
          safeAreaInsets: { top: 500, right: 0, bottom: 500, left: 0 },
        },
        { width: 390, height: 844 },
      ),
    ).toBe(false);
    expect(
      isDesignTargetQualityProfile({
        ...uiProfile,
        safeAreaNodeIds: ["header", "header"],
      }),
    ).toBe(false);
    expect(
      isDesignTargetQualityProfile({
        ...uiProfile,
        interactiveNodeIds: ["undeclared_action"],
      }),
    ).toBe(true);
  });

  it("keeps graphics explicit and returns a bounded unique node set", () => {
    expect(isDesignTargetQualityProfile({ kind: "graphic" })).toBe(true);
    expect(
      isDesignTargetQualityProfile({ kind: "graphic", platform: "web" }),
    ).toBe(false);
    expect(qualityProfileNodeIds(uiProfile)).toEqual([
      "header",
      "primary_action",
    ]);
    expect(qualityProfileNodeIds({ kind: "graphic" })).toEqual([]);
  });
});
