import { builtinDesignSkillRefsForDeliverable } from "@opendesign/design-skills";
import type { DesignBriefFidelity } from "./design-brief-fidelity";
import type { DesignGenerationModelInput } from "./design-generation-tool-schema";
import type {
  DesignGenerationContractContext,
  DesignGenerationToolInput,
} from "./design-generation-tool";

export function bindDesignGenerationHostContext(
  input: DesignGenerationModelInput,
  context: DesignGenerationContractContext,
): DesignGenerationToolInput {
  const objective = (
    context.authoritativePrompt ?? "Create the requested visual deliverable"
  ).trim();
  const target = bindDesignGenerationTarget(
    input.targets[0],
    context,
    objective,
  );
  const targetId = target.targetId;
  const stableId = (localId: string) =>
    context.newNodeIdPrefix && !localId.startsWith("odr_")
      ? `${context.newNodeIdPrefix}${targetId.length}_${targetId}_${localId}`
      : localId;
  const frameId = target.frame.frameId;
  const authoredElements = input.designGeneration.elements.map((element) => ({
    ...element,
    id: stableId(element.id),
    parentId:
      element.parentId === undefined ? frameId : stableId(element.parentId),
    strokes: element.strokes ?? [],
    strokeWidth: element.strokeWidth ?? 0,
  }));
  return {
    ...input,
    version: 2,
    objective,
    designIntent:
      input.designIntent ?? defaultDesignIntent(input.deliverable, objective),
    visualSystem:
      input.visualSystem ?? defaultVisualSystem(input, input.deliverable),
    skillRefs: builtinDesignSkillRefsForDeliverable(input.deliverable),
    briefFidelity: defaultBriefFidelity(
      context.authoritativePrompt ?? objective,
    ),
    targets: [
      {
        ...target,
        qualityProfile: bindQualityProfile(input, stableId),
      },
    ],
    designGeneration: {
      ...input.designGeneration,
      targetId,
      elements: authoredElements,
    },
    ...(input.logoExploration === undefined
      ? {}
      : {
          logoExploration: {
            ...input.logoExploration,
            targetId,
            directions: input.logoExploration.directions.map((direction) => ({
              ...direction,
              rootNodeId: stableId(direction.rootNodeId),
              masterNodeId: stableId(direction.masterNodeId),
            })),
          },
        }),
    rasterAssetRoles: [...input.rasterAssetRoles],
  } as DesignGenerationToolInput;
}

function bindDesignGenerationTarget(
  submitted: DesignGenerationModelInput["targets"][number] | undefined,
  context: DesignGenerationContractContext,
  fallbackObjective: string,
): Omit<DesignGenerationToolInput["targets"][number], "qualityProfile"> {
  const host = context.target;
  return {
    targetId: host?.targetId ?? "",
    label: host?.label ?? "Design",
    pageId: host?.pageId ?? "",
    objective: host?.objective ?? fallbackObjective,
    frame: {
      frameId: host?.frame.frameId ?? "",
      x: host?.frame.x ?? Number.NaN,
      y: host?.frame.y ?? Number.NaN,
      width: host?.frame.width ?? submitted?.frame.width ?? Number.NaN,
      height: host?.frame.height ?? submitted?.frame.height ?? Number.NaN,
    },
    layout: "Authored from the submitted element hierarchy",
    spacing: "Defined by authored coordinates and Auto Layout",
  };
}

function defaultDesignIntent(
  deliverable: DesignGenerationToolInput["deliverable"],
  objective: string,
): DesignGenerationToolInput["designIntent"] {
  const subject = objective.slice(0, 500);
  return {
    subject,
    audience: "The audience described by the user brief",
    primaryJob: subject,
    calibration: {
      surfaceMode: deliverable === "ui" ? "operate" : "graphic",
      expressiveness: "balanced",
      density: "balanced",
    },
    visualThesis: "Judge the authored visual result against the user brief",
    signatureDecision:
      "Use the submitted composition itself; do not invent a decorative motif",
    typographyLanguage: "Derived from the submitted editable text layers",
    colorMaterialLanguage: "Derived from the submitted paints and effects",
    compositionTension: "Derived from the submitted spatial relationships",
    antiPatterns: ["Do not replace design meaning with generic decoration"],
  };
}

function defaultVisualSystem(
  input: DesignGenerationModelInput,
  deliverable: DesignGenerationToolInput["deliverable"],
): DesignGenerationToolInput["visualSystem"] {
  const textStyles = input.designGeneration.elements
    .filter((element) => element.kind === "text")
    .map(
      (element) =>
        `${element.text.fontFamily} ${element.text.fontStyleName} ${element.text.fontSize}/${element.text.lineHeight}`,
    );
  return {
    formLanguage: "Derived from the submitted editable geometry",
    palette: ["Authored node paints"],
    surfaceAndDepth: "Derived from the submitted layers and effects",
    typography:
      textStyles.length > 0
        ? [...new Set(textStyles)].slice(0, 4)
        : [
            deliverable === "ui"
              ? "Interface typography"
              : "Graphic typography",
          ],
    effects: [],
  };
}

function bindQualityProfile(
  input: DesignGenerationModelInput,
  stableId: (localId: string) => string,
): DesignGenerationToolInput["targets"][number]["qualityProfile"] {
  const profile = input.targets[0]?.qualityProfile;
  if (profile?.kind === "graphic") return { kind: "graphic" };
  if (profile?.kind === "ui") {
    const { top, right, bottom, left } = profile.safeAreaInsets;
    return {
      kind: "ui",
      platform: profile.platform,
      input: profile.interactionMode,
      insets: [top, right, bottom, left],
      safeNodeIds: profile.safeAreaNodeIds.map(stableId),
      hitNodeIds: profile.interactiveNodeIds.map(stableId),
    };
  }
  if (input.deliverable !== "ui") return { kind: "graphic" };
  return {
    kind: "ui",
    platform: "other",
    input: "mixed",
    insets: [0, 0, 0, 0],
    safeNodeIds: [],
    hitNodeIds: [],
  };
}

function defaultBriefFidelity(objective: string): DesignBriefFidelity {
  return {
    requiredContent: chunkRequiredContent(
      objective || "The requested visual deliverable",
    ),
    preservedSemantics: [],
    prohibitedAdditions: [
      "Do not invent unrequested content, features, or delivery targets",
    ],
    assumptions: [],
  };
}

function chunkRequiredContent(value: string): string[] {
  const normalized = value.replaceAll(/\r\n?/g, "\n").trim();
  if (!normalized) return ["The requested visual deliverable"];
  const chunks: string[] = [];
  let current = "";
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length > 500) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let offset = 0; offset < line.length; offset += 500) {
        chunks.push(line.slice(offset, offset + 500));
      }
      continue;
    }
    const combined = current ? `${current}\n${line}` : line;
    if (combined.length > 500) {
      chunks.push(current);
      current = line;
    } else {
      current = combined;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 24);
}
