import type { DesignNode, DesignOperation } from "@opendesign/design-contracts";
import type { DesignApplyToolInput } from "./design-apply-input";
import type {
  DesignPlanComponentCandidate,
  DesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
import type {
  DesignPlanTarget,
  DesignPlanToolInput,
} from "./design-agent-tools";
import type {
  DesignFirstSliceElement,
  DesignFirstSliceToolInput,
} from "./design-first-slice-tool";

export function compileValidatedDesignFirstSliceToolInput(
  input: DesignFirstSliceToolInput,
): {
  plan: DesignPlanToolInput;
  apply: DesignApplyToolInput;
  insertedNodeIds: string[];
} {
  const targets = input.targets.map(compileTarget);
  const componentStrategy = compileComponentStrategy(
    input.semanticObjects ?? [],
  );
  const plan: DesignPlanToolInput = {
    version: 1,
    deliverable: input.deliverable,
    objective: input.objective,
    outputMode: "editable-composition" as const,
    targets,
    visualSystem: {
      avoidances: [
        "generic repeated card grids without information hierarchy",
        "decorative effects that do not support the composition",
      ],
      formLanguage: input.visualSystem.formLanguage,
      palette: [...input.visualSystem.palette],
      surfaceAndDepth: input.visualSystem.surfaceAndDepth,
      typography: [...input.visualSystem.typography],
      effects: [...(input.visualSystem.effects ?? [])],
    },
    rasterAssetRoles: [...input.rasterAssetRoles],
    componentStrategy,
    briefFidelity: structuredClone(input.briefFidelity),
    designIntent: structuredClone(input.designIntent),
    ...(input.referenceStrategy === undefined
      ? {}
      : { referenceStrategy: structuredClone(input.referenceStrategy) }),
    skillRefs: structuredClone(input.skillRefs),
    ...(input.logoOutputs === undefined
      ? {}
      : { logoOutputs: [...input.logoOutputs] }),
    ...(input.logoExploration === undefined
      ? {}
      : {
          logoExploration: {
            targetId: input.logoExploration.targetId,
            directions: input.logoExploration.directions.map((direction) => {
              const [monochromeNodeId, size32, size24, size16] =
                direction.evidenceNodeIds;
              return {
                conceptId: direction.conceptId,
                label: direction.conceptId,
                principle: direction.principle,
                thesis: direction.thesis,
                constructionLogic: `${direction.thesis} The editable construction uses the ${direction.principle} principle.`,
                rootNodeId: direction.rootNodeId,
                monochromeNodeId,
                smallSizeNodeIds: [size32, size24, size16] as [
                  string,
                  string,
                  string,
                ],
              };
            }),
          },
        }),
  };
  const childCounts = new Map<string, number>();
  const commands: DesignOperation[] = [];
  const steps: NonNullable<DesignApplyToolInput["steps"]> = [];
  let ordinal = 0;
  for (const stage of input.firstSlice.stages) {
    const commandIds: string[] = [];
    for (const element of stage.elements) {
      ordinal += 1;
      const commandId = `first_slice_${ordinal}`;
      commandIds.push(commandId);
      const index = childCounts.get(element.parentId) ?? 0;
      childCounts.set(element.parentId, index + 1);
      commands.push({
        commandId,
        type: "insert_element",
        pageId: targets[0].pageId,
        parentId: element.parentId,
        index,
        node: compileElement(element),
      });
    }
    steps.push({
      stepId: stage.stageId,
      label: stage.label,
      commandIds,
    });
  }
  return {
    plan,
    apply: {
      label: input.firstSlice.label,
      summary:
        "Create the first meaningful editable design slice inside the allocated artboard",
      steps,
      commands,
    },
    insertedNodeIds: input.firstSlice.stages.flatMap((stage) =>
      stage.elements.map((element) => element.id),
    ),
  };
}

function compileTarget(
  target: DesignFirstSliceToolInput["targets"][number],
): DesignPlanTarget {
  const regionNames = target.regions.map((region) => region.name);
  return {
    targetId: target.targetId,
    label: target.label,
    pageId: target.pageId,
    objective: target.objective,
    artboard: { mode: "create", ...target.frame },
    composition: {
      direction: target.layout,
      hierarchy: [target.label, ...regionNames],
      regions: target.regions.map((region) => ({ ...region })),
      assetIntegration:
        "Use editable typography, native vectors and shapes; raster assets are limited to the explicitly declared roles.",
      spacingRhythm: target.spacing,
    },
    editableLayers: unique([...regionNames, "Typography and controls"]),
    implementationSteps: unique([
      ...regionNames.map((name) => `Build ${name}`),
      "Review and refine the rendered target",
    ]),
    validationChecks: [
      "All visible material remains inside the delivery artboard with intentional spacing.",
      "Typography, hierarchy, reusable structure and contrast remain coherent after rendering.",
    ],
    qualityProfile: compileQualityProfile(target.qualityProfile),
  };
}

function compileQualityProfile(
  profile: DesignFirstSliceToolInput["targets"][number]["qualityProfile"],
): DesignPlanTarget["qualityProfile"] {
  if (profile.kind === "graphic") return { kind: "graphic" };
  const [top, right, bottom, left] = profile.insets;
  return {
    kind: "ui",
    platform: profile.platform,
    interactionMode: profile.input,
    safeAreaInsets: { top, right, bottom, left },
    safeAreaNodeIds: [...profile.safeNodeIds],
    interactiveNodeIds: [...profile.hitNodeIds],
  };
}

function compileComponentStrategy(
  objects: NonNullable<DesignFirstSliceToolInput["semanticObjects"]>,
): DesignPlanComponentStrategy {
  const candidates: DesignPlanComponentCandidate[] = objects.map((object) => {
    if (object.decision === "ordinary") {
      return {
        decisionId: object.decisionId,
        label: object.label,
        decision: "ordinary",
        rationale: `${object.label} remains ordinary because this delivery does not require centralized reusable instance behavior.`,
        occurrences: object.occurrences.map((occurrence) => ({
          ...occurrence,
        })),
      };
    }
    if (object.decision === "reuse-component") {
      return {
        decisionId: object.decisionId,
        label: object.label,
        decision: "reuse-component",
        rationale: `${object.label} reuses a compatible Component Main already available in the Design File.`,
        componentId: object.componentId,
        instances: object.instances.map((instance) => ({ ...instance })),
      };
    }
    return {
      decisionId: object.decisionId,
      label: object.label,
      decision: "component",
      rationale: `${object.label} is reusable and should preserve centralized structure with explicit instances.`,
      componentId: object.componentId,
      main: { ...object.main, mode: "create" },
      instances: object.instances.map((instance) => ({ ...instance })),
    };
  });
  return {
    summary:
      candidates.length === 0
        ? "No reusable semantic object is justified in this generated delivery."
        : "Reusable semantic objects are declared only where stable identity and centralized updates improve the delivery.",
    candidates,
  };
}

function compileElement(element: DesignFirstSliceElement): DesignNode {
  const base = {
    id: element.id,
    name: element.name,
    parentId: element.parentId,
    childIds: [] as string[],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, element.x, element.y] as [
      number,
      number,
      number,
      number,
      number,
      number,
    ],
    size: { width: element.width, height: element.height },
    exportSettings: [],
    opacity: element.opacity ?? 1,
    extensions: { generatedBy: "compact-first-slice-v1" },
  };
  if (element.kind === "group") {
    return { ...base, kind: "group" as const, properties: {} };
  }
  if (element.kind === "text") {
    const sharedText = {
      content: element.text.content,
      fontFamily: element.text.fontFamily,
      fontStyleName: element.text.fontStyleName,
      fontWeight: element.text.fontWeight,
      fontSlant: element.text.fontSlant,
      fontSize: element.text.fontSize,
      lineHeight: element.text.lineHeight,
      letterSpacing: element.text.letterSpacing ?? 0,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      listSpacing: 0,
      hangingList: false,
      textCase: "original" as const,
      textDecoration: "none" as const,
      textAlignHorizontal: element.text.align ?? ("left" as const),
      textAlignVertical: "top" as const,
      textOverflow: "visible" as const,
      textTruncation: "disabled" as const,
      maxLines: null,
      fills: [
        { type: "solid" as const, color: element.text.color, opacity: 1 },
      ],
      strokes: [],
      strokeWidth: 0,
    };
    const properties =
      element.text.textResize === "auto-width"
        ? {
            ...sharedText,
            textResize: "auto-width" as const,
            textWrap: "none" as const,
          }
        : element.text.textResize === "auto-height"
          ? {
              ...sharedText,
              textResize: "auto-height" as const,
              textWrap: "word" as const,
            }
          : {
              ...sharedText,
              textResize: "fixed" as const,
              textWrap: "word" as const,
            };
    return { ...base, kind: "text", properties };
  }
  if (element.kind === "path") {
    return {
      ...base,
      kind: "path" as const,
      properties: {
        fills: [
          {
            type: "solid" as const,
            color: element.fill.color,
            opacity: element.fill.opacity ?? 1,
          },
        ],
        strokes: [],
        strokeWidth: 0,
        path: element.path,
        fillRule: "nonzero" as const,
      },
    };
  }
  const strokes = element.stroke
    ? [
        {
          type: "solid" as const,
          color: element.stroke.color,
          opacity: element.stroke.opacity ?? 1,
        },
      ]
    : [];
  const shape = {
    fills: element.fill
      ? [
          {
            type: "solid" as const,
            color: element.fill.color,
            opacity: element.fill.opacity ?? 1,
          },
        ]
      : [],
    strokes,
    strokeWidth: element.stroke?.width ?? 0,
  };
  if (element.kind === "frame") {
    return {
      ...base,
      kind: "frame" as const,
      properties: {
        ...shape,
        cornerRadius: element.cornerRadius ?? 0,
        clipsContent: element.clipsContent ?? false,
      },
    };
  }
  if (element.kind === "rectangle") {
    return {
      ...base,
      kind: "rectangle" as const,
      properties: { ...shape, cornerRadius: element.cornerRadius ?? 0 },
    };
  }
  return { ...base, kind: "ellipse" as const, properties: shape };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
