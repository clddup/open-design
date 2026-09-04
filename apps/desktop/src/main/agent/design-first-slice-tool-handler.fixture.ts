import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";
import type { DesignFirstSliceToolInput } from "@/shared/design-agent-tools.js";

export function firstSliceModelInput(
  input: DesignFirstSliceToolInput,
): Record<string, unknown> {
  const value = structuredClone(input) as unknown as Record<string, unknown>;
  for (const key of [
    "version",
    "objective",
    "skillRefs",
    "briefFidelity",
    "referenceStrategy",
  ]) {
    Reflect.deleteProperty(value, key);
  }
  for (const target of value.targets as Array<Record<string, unknown>>) {
    Reflect.deleteProperty(target, "qualityProfile");
    Reflect.deleteProperty(target, "targetId");
    Reflect.deleteProperty(target, "label");
    Reflect.deleteProperty(target, "pageId");
    Reflect.deleteProperty(target, "objective");
    Reflect.deleteProperty(target, "layout");
    Reflect.deleteProperty(target, "spacing");
    const frame = target.frame as Record<string, unknown>;
    const frameId = frame.frameId;
    Reflect.deleteProperty(frame, "frameId");
    Reflect.deleteProperty(frame, "x");
    Reflect.deleteProperty(frame, "y");
    for (const region of target.regions as Array<Record<string, unknown>>) {
      if (region.parentId === frameId)
        Reflect.deleteProperty(region, "parentId");
    }
  }
  const firstSlice = value.firstSlice as Record<string, unknown>;
  Reflect.deleteProperty(firstSlice, "targetId");
  if (value.logoExploration) {
    Reflect.deleteProperty(value.logoExploration, "targetId");
  }
  return value;
}

export function firstSliceInput(): DesignFirstSliceToolInput {
  return {
    version: 1,
    deliverable: "ui",
    objective: "Create a focused home screen",
    designIntent: {
      subject: "A mobile product home for focused creative work",
      audience: "Independent designers continuing time-sensitive work",
      primaryJob: "Recognize the next task and continue it immediately",
      calibration: {
        surfaceMode: "operate",
        expressiveness: "expressive",
        density: "balanced",
      },
      visualThesis:
        "A directional editorial field expresses momentum instead of a generic mobile card stack.",
      signatureDecision:
        "One cropped signal rail connects identity, next action, and progress.",
      typographyLanguage:
        "Editorial display type sets pace while compact neutral text preserves clarity.",
      colorMaterialLanguage:
        "Tinted ink planes and one electric signal color create controlled hierarchy.",
      compositionTension:
        "Offset alignment and decisive scale contrast pull attention toward action.",
      antiPatterns: [
        "No centered card floating on a decorative background",
        "No equal grid of same-radius feature tiles",
        "No generic purple gradient used as the only identity",
      ],
    },
    skillRefs: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
      ...reference,
    })),
    briefFidelity: {
      requiredContent: ["Focused home screen"],
      preservedSemantics: [],
      prohibitedAdditions: ["No unrequested product capability"],
      assumptions: ["Use an iOS mobile viewport"],
    },
    targets: [
      {
        targetId: "home",
        label: "Home",
        pageId: "page_1",
        objective: "Show the product value immediately",
        frame: {
          frameId: "frame_home",
          x: 80,
          y: 40,
          width: 390,
          height: 844,
        },
        layout: "Vertical mobile composition",
        spacing: "8px base with 24px sections",
        qualityProfile: {
          kind: "ui",
          platform: "ios",
          input: "touch",
          insets: [59, 0, 34, 0],
          safeNodeIds: ["home_hero"],
          hitNodeIds: [],
        },
        regions: [
          {
            nodeId: "home_hero",
            name: "Hero",
            role: "content",
            parentId: "frame_home",
            x: 24,
            y: 80,
            width: 342,
            height: 240,
          },
        ],
      },
    ],
    visualSystem: {
      formLanguage: "Calm editorial geometry",
      palette: ["#0F172A", "#F8FAFC", "#7C3AED"],
      surfaceAndDepth: "Flat with one elevated focal surface",
      typography: ["Inter Bold 32/38", "Inter Regular 16/24"],
    },
    rasterAssetRoles: [],
    firstSlice: {
      targetId: "home",
      label: "Create Home hero",
      stages: [
        {
          stageId: "hero",
          label: "Build hero",
          elements: [
            {
              id: "hero_title",
              kind: "text",
              name: "Hero Title",
              parentId: "home_hero",
              x: 24,
              y: 24,
              width: 294,
              height: 84,
              fills: [{ type: "solid", color: "#0F172A", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
              text: {
                content: "Design with momentum",
                fontFamily: "Inter",
                fontStyleName: "Bold",
                fontWeight: 700,
                fontSlant: "normal",
                fontSize: 32,
                lineHeight: 38,
                textResize: "auto-height",
              },
            },
          ],
        },
      ],
    },
  };
}
