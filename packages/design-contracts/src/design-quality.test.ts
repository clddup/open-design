import { describe, expect, it } from "vitest";
import {
  designTargetQualityProfilesEqual,
  minimumInteractiveTargetSize,
  qualityProfileNodeIds,
  type DesignTargetQualityProfile,
} from "./design-quality.js";

describe("design quality policy", () => {
  const profile: Extract<DesignTargetQualityProfile, { kind: "ui" }> = {
    kind: "ui",
    platform: "ios",
    interactionMode: "touch",
    safeAreaInsets: { top: 59, right: 0, bottom: 34, left: 0 },
    safeAreaNodeIds: ["header", "primary_action"],
    interactiveNodeIds: ["primary_action"],
  };

  it("owns platform minimum target sizes independently of model input", () => {
    expect(minimumInteractiveTargetSize(profile)).toMatchObject({
      width: 44,
      height: 44,
    });
    expect(
      minimumInteractiveTargetSize({ ...profile, platform: "android" }),
    ).toMatchObject({ width: 48, height: 48 });
    expect(
      minimumInteractiveTargetSize({
        ...profile,
        platform: "web",
        interactionMode: "pointer",
      }),
    ).toMatchObject({ width: 24, height: 24 });
  });

  it("returns each declared quality node once", () => {
    expect(qualityProfileNodeIds(profile)).toEqual([
      "header",
      "primary_action",
    ]);
  });

  it("compares profile semantics without depending on JSON key or ID order", () => {
    expect(
      designTargetQualityProfilesEqual(profile, {
        interactiveNodeIds: ["primary_action"],
        safeAreaNodeIds: ["primary_action", "header"],
        safeAreaInsets: { left: 0, bottom: 34, right: 0, top: 59 },
        interactionMode: "touch",
        platform: "ios",
        kind: "ui",
      }),
    ).toBe(true);
    expect(
      designTargetQualityProfilesEqual(profile, {
        ...profile,
        platform: "android",
      }),
    ).toBe(false);
  });
});
