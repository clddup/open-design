export type DesignQualityPlatform =
  "web" | "macos" | "windows" | "ios" | "ipados" | "android" | "other";

export type DesignQualityInteractionMode = "pointer" | "touch" | "mixed";

export type DesignSafeAreaInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type DesignTargetQualityProfile =
  | { kind: "graphic" }
  | {
      kind: "ui";
      platform: DesignQualityPlatform;
      interactionMode: DesignQualityInteractionMode;
      safeAreaInsets: DesignSafeAreaInsets;
      safeAreaNodeIds: string[];
      interactiveNodeIds: string[];
    };

export function isDesignTargetQualityProfile(
  value: unknown,
  frameSize?: { width: number; height: number },
): value is DesignTargetQualityProfile {
  if (!isRecord(value)) return false;
  if (value.kind === "graphic") return exactKeys(value, ["kind"]);
  const safeAreaNodeIds = value.safeAreaNodeIds;
  const interactiveNodeIds = value.interactiveNodeIds;
  if (
    value.kind !== "ui" ||
    !isDesignQualityPlatform(value.platform) ||
    !["pointer", "touch", "mixed"].includes(String(value.interactionMode)) ||
    !isSafeAreaInsets(value.safeAreaInsets) ||
    !boundedUniqueIds(safeAreaNodeIds, 0, 64) ||
    !boundedUniqueIds(interactiveNodeIds, 0, 64) ||
    !exactKeys(value, [
      "kind",
      "platform",
      "interactionMode",
      "safeAreaInsets",
      "safeAreaNodeIds",
      "interactiveNodeIds",
    ])
  ) {
    return false;
  }
  if (!frameSize) return true;
  return (
    value.safeAreaInsets.left + value.safeAreaInsets.right < frameSize.width &&
    value.safeAreaInsets.top + value.safeAreaInsets.bottom < frameSize.height
  );
}

export function minimumInteractiveTargetSize(
  profile: Extract<DesignTargetQualityProfile, { kind: "ui" }>,
): { width: number; height: number; source: string } {
  if (profile.platform === "android") {
    return { width: 48, height: 48, source: "Android 48dp" };
  }
  if (profile.platform === "ios" || profile.platform === "ipados") {
    return { width: 44, height: 44, source: "Apple 44pt" };
  }
  if (profile.platform === "macos") {
    return { width: 28, height: 28, source: "Apple macOS 28pt" };
  }
  if (profile.interactionMode !== "pointer") {
    return { width: 44, height: 44, source: "mixed/touch 44px" };
  }
  return { width: 24, height: 24, source: "WCAG 2.2 AA 24px" };
}

export function qualityProfileNodeIds(
  profile: DesignTargetQualityProfile | undefined,
): string[] {
  return profile?.kind === "ui"
    ? [...new Set([...profile.safeAreaNodeIds, ...profile.interactiveNodeIds])]
    : [];
}

export function designTargetQualityProfilesEqual(
  left: DesignTargetQualityProfile | null | undefined,
  right: DesignTargetQualityProfile | null | undefined,
): boolean {
  if (left == null || right == null) return left == null && right == null;
  if (left.kind !== right.kind) return false;
  if (left.kind === "graphic" || right.kind === "graphic") return true;
  return (
    left.platform === right.platform &&
    left.interactionMode === right.interactionMode &&
    left.safeAreaInsets.top === right.safeAreaInsets.top &&
    left.safeAreaInsets.right === right.safeAreaInsets.right &&
    left.safeAreaInsets.bottom === right.safeAreaInsets.bottom &&
    left.safeAreaInsets.left === right.safeAreaInsets.left &&
    sameStringSet(left.safeAreaNodeIds, right.safeAreaNodeIds) &&
    sameStringSet(left.interactiveNodeIds, right.interactiveNodeIds)
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value) => right.includes(value))
  );
}

function isDesignQualityPlatform(
  value: unknown,
): value is DesignQualityPlatform {
  return [
    "web",
    "macos",
    "windows",
    "ios",
    "ipados",
    "android",
    "other",
  ].includes(String(value));
}

function isSafeAreaInsets(value: unknown): value is DesignSafeAreaInsets {
  return (
    isRecord(value) &&
    [value.top, value.right, value.bottom, value.left].every(
      (inset) =>
        typeof inset === "number" &&
        Number.isFinite(inset) &&
        inset >= 0 &&
        inset <= 10_000,
    ) &&
    exactKeys(value, ["top", "right", "bottom", "left"])
  );
}

function boundedUniqueIds(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every(safeId) &&
    new Set(value).size === value.length
  );
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    actual.every((key) => expected.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
