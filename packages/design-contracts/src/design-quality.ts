import {
  defineContract,
  type ValidationIssue,
} from "@opendesign/contract-runtime";
import { Type, type Static } from "@sinclair/typebox";

const QualityProfileIdSchema = Type.String({
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
});
const SafeAreaInsetSchema = Type.Number({ minimum: 0, maximum: 10_000 });

export const DesignSafeAreaInsetsSchema = Type.Object(
  {
    top: SafeAreaInsetSchema,
    right: SafeAreaInsetSchema,
    bottom: SafeAreaInsetSchema,
    left: SafeAreaInsetSchema,
  },
  { additionalProperties: false },
);

const UiQualityProfileSchema = Type.Object(
  {
    kind: Type.Literal("ui"),
    platform: Type.Union([
      Type.Literal("web"),
      Type.Literal("macos"),
      Type.Literal("windows"),
      Type.Literal("ios"),
      Type.Literal("ipados"),
      Type.Literal("android"),
      Type.Literal("other"),
    ]),
    interactionMode: Type.Union([
      Type.Literal("pointer"),
      Type.Literal("touch"),
      Type.Literal("mixed"),
    ]),
    safeAreaInsets: DesignSafeAreaInsetsSchema,
    safeAreaNodeIds: Type.Array(QualityProfileIdSchema, {
      maxItems: 64,
      uniqueItems: true,
    }),
    interactiveNodeIds: Type.Array(QualityProfileIdSchema, {
      maxItems: 64,
      uniqueItems: true,
    }),
  },
  {
    additionalProperties: false,
    description:
      "Executable UI geometry policy. safeAreaInsets are parent-local artboard insets, safeAreaNodeIds name foreground descendants that must remain inside them, and interactiveNodeIds independently name actual descendant hit-area Frames or layers—not the delivery artboard itself and not merely their visible icon children. Do not duplicate interactiveNodeIds into safeAreaNodeIds; the host automatically checks both sets against the safe area, then applies platform minimum hit sizes to interactiveNodeIds.",
  },
);

export const DesignTargetQualityProfileSchema = Type.Union([
  Type.Object(
    { kind: Type.Literal("graphic") },
    {
      additionalProperties: false,
      description:
        "Use for posters, logos, brand assets, illustrations and other non-interface graphics. Device safe-area and interaction-target checks do not apply.",
    },
  ),
  UiQualityProfileSchema,
]);

export type DesignQualityPlatform = Static<
  typeof UiQualityProfileSchema
>["platform"];
export type DesignQualityInteractionMode = Static<
  typeof UiQualityProfileSchema
>["interactionMode"];
export type DesignSafeAreaInsets = Static<typeof DesignSafeAreaInsetsSchema>;
export type DesignTargetQualityProfile = Static<
  typeof DesignTargetQualityProfileSchema
>;

type QualityProfileFrameSize = { width: number; height: number };

export const DesignTargetQualityProfileContract = defineContract<
  DesignTargetQualityProfile,
  DesignTargetQualityProfile,
  QualityProfileFrameSize | undefined
>({
  schema: DesignTargetQualityProfileSchema,
  code: "design.quality_profile_structure_invalid",
  subject: "design target quality profile",
  refine: qualityProfileFrameIssues,
  clone: false,
});

export function isDesignTargetQualityProfile(
  value: unknown,
  frameSize?: QualityProfileFrameSize,
): value is DesignTargetQualityProfile {
  return DesignTargetQualityProfileContract.parse(value, frameSize).ok;
}

function qualityProfileFrameIssues(
  profile: DesignTargetQualityProfile,
  frameSize: QualityProfileFrameSize | undefined,
): ValidationIssue[] {
  if (!frameSize || profile.kind === "graphic") return [];
  const horizontal = profile.safeAreaInsets.left + profile.safeAreaInsets.right;
  const vertical = profile.safeAreaInsets.top + profile.safeAreaInsets.bottom;
  if (horizontal < frameSize.width && vertical < frameSize.height) return [];
  return [
    {
      code: "design.quality_profile_safe_area_invalid",
      path: "/safeAreaInsets",
      message:
        "Safe-area insets must leave a positive interior inside the target frame",
      expected: { width: frameSize.width, height: frameSize.height },
      actual: { width: horizontal, height: vertical },
      recovery:
        "Reduce the insets so each opposing pair sums to less than the frame dimension.",
    },
  ];
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
