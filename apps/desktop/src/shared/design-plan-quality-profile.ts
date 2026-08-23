export {
  isDesignTargetQualityProfile,
  minimumInteractiveTargetSize,
  qualityProfileNodeIds,
  type DesignQualityInteractionMode,
  type DesignQualityPlatform,
  type DesignSafeAreaInsets,
  type DesignTargetQualityProfile,
} from "@opendesign/design-contracts";

const ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^[^\\u0000-\\u001F\\u007F]+$",
} as const;
const INSET_SCHEMA = {
  type: "number",
  minimum: 0,
  maximum: 10_000,
} as const;

export const DESIGN_TARGET_QUALITY_PROFILE_SCHEMA = {
  anyOf: [
    {
      type: "object",
      description:
        "Use for posters, logos, brand assets, illustrations and other non-interface graphics. Device safe-area and interaction-target checks do not apply.",
      properties: { kind: { const: "graphic" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      description:
        "Executable UI geometry policy. safeAreaInsets are parent-local artboard insets, safeAreaNodeIds name foreground descendants that must remain inside them, and interactiveNodeIds independently name actual descendant hit-area Frames or layers—not the delivery artboard itself and not merely their visible icon children. Do not duplicate interactiveNodeIds into safeAreaNodeIds; the host automatically checks both sets against the safe area, then applies platform minimum hit sizes to interactiveNodeIds.",
      properties: {
        kind: { const: "ui" },
        platform: {
          enum: [
            "web",
            "macos",
            "windows",
            "ios",
            "ipados",
            "android",
            "other",
          ],
        },
        interactionMode: { enum: ["pointer", "touch", "mixed"] },
        safeAreaInsets: {
          type: "object",
          properties: {
            top: INSET_SCHEMA,
            right: INSET_SCHEMA,
            bottom: INSET_SCHEMA,
            left: INSET_SCHEMA,
          },
          required: ["top", "right", "bottom", "left"],
          additionalProperties: false,
        },
        safeAreaNodeIds: {
          type: "array",
          maxItems: 64,
          uniqueItems: true,
          items: ID_SCHEMA,
        },
        interactiveNodeIds: {
          type: "array",
          maxItems: 64,
          uniqueItems: true,
          items: ID_SCHEMA,
        },
      },
      required: [
        "kind",
        "platform",
        "interactionMode",
        "safeAreaInsets",
        "safeAreaNodeIds",
        "interactiveNodeIds",
      ],
      additionalProperties: false,
    },
  ],
} as const;
