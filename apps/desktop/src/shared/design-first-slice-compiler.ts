import type { DesignNode, DesignOperation } from "@opendesign/design-contracts";
import type { DesignApplyToolInput } from "./design-apply-input";
import type { DesignPlanComponentStrategy } from "./design-plan-component-strategy";
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
  const targets = input.targets.map((target, index) =>
    compileTarget(
      target,
      index === 0
        ? input.firstSlice.stages.map((stage) => ({
            stepId: stage.stageId,
            label: stage.label,
          }))
        : undefined,
    ),
  );
  const componentStrategy: DesignPlanComponentStrategy = {
    summary:
      "Component decisions are made from the inspected real hierarchy after the first material revision.",
    candidates: [],
  };
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
    ...(input.logoColorStrategy === undefined
      ? {}
      : { logoColorStrategy: structuredClone(input.logoColorStrategy) }),
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
                logoEvidenceNodeIds(direction.masterNodeId);
              return {
                conceptId: direction.conceptId,
                label: direction.conceptId,
                principle: direction.principle,
                thesis: direction.thesis,
                constructionLogic: direction.constructionLogic,
                colorSystem: structuredClone(direction.colorSystem),
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
  const generatedEvidence = compileLogoEvidence(input, childCounts, ordinal);
  commands.push(...generatedEvidence.commands);
  const finalStep = steps.at(-1);
  if (finalStep) finalStep.commandIds.push(...generatedEvidence.commandIds);
  return {
    plan,
    apply: {
      label: input.firstSlice.label,
      summary:
        "Create the first meaningful editable design slice inside the allocated artboard",
      steps,
      commands,
    },
    insertedNodeIds: [
      ...input.firstSlice.stages.flatMap((stage) =>
        stage.elements.map((element) => element.id),
      ),
      ...generatedEvidence.nodeIds,
    ],
  };
}

const LOGO_EVIDENCE_VARIANTS = [
  { key: "mono", size: 64, monochrome: true },
  { key: "32", size: 32, monochrome: false },
  { key: "24", size: 24, monochrome: false },
  { key: "16", size: 16, monochrome: false },
] as const;

function logoEvidenceNodeIds(
  masterNodeId: string,
): [string, string, string, string] {
  return LOGO_EVIDENCE_VARIANTS.map(({ key }) =>
    derivedEvidenceNodeId(masterNodeId, key),
  ) as [string, string, string, string];
}

function compileLogoEvidence(
  input: DesignFirstSliceToolInput,
  childCounts: Map<string, number>,
  startingOrdinal: number,
): { commands: DesignOperation[]; commandIds: string[]; nodeIds: string[] } {
  if (!input.logoExploration) {
    return { commands: [], commandIds: [], nodeIds: [] };
  }
  const elements = input.firstSlice.stages.flatMap((stage) => stage.elements);
  const elementsById = new Map(
    elements.map((element) => [element.id, element]),
  );
  const parentById = new Map(
    elements.map((element) => [element.id, element.parentId]),
  );
  const commands: DesignOperation[] = [];
  for (const direction of input.logoExploration.directions) {
    const evidenceRoot = elementsById.get(direction.evidenceRootNodeId);
    const master = elementsById.get(direction.masterNodeId);
    if (!evidenceRoot || !master) continue;
    const subtree = elements.filter((element) =>
      belongsToSubtree(element.id, direction.masterNodeId, parentById),
    );
    for (const [variantIndex, variant] of LOGO_EVIDENCE_VARIANTS.entries()) {
      const placement = evidencePlacement(evidenceRoot, master, variantIndex);
      for (const element of subtree) {
        const commandId = `first_slice_${startingOrdinal + commands.length + 1}`;
        const node = compileEvidenceNode(
          element,
          direction,
          variant,
          placement,
        );
        const parentId = node.parentId;
        if (!parentId)
          throw new Error("Generated Logo evidence requires a parent");
        const index = childCounts.get(parentId) ?? 0;
        childCounts.set(parentId, index + 1);
        commands.push({
          commandId,
          type: "insert_element",
          pageId: input.targets[0].pageId,
          parentId,
          index,
          node,
        });
      }
    }
  }
  return {
    commands,
    commandIds: commands.map((command) => command.commandId),
    nodeIds: commands.flatMap((command) =>
      command.type === "insert_element" ? [command.node.id] : [],
    ),
  };
}

function belongsToSubtree(
  nodeId: string,
  rootNodeId: string,
  parentById: ReadonlyMap<string, string>,
): boolean {
  let current: string | undefined = nodeId;
  while (current) {
    if (current === rootNodeId) return true;
    current = parentById.get(current);
  }
  return false;
}

function evidencePlacement(
  evidenceRoot: DesignFirstSliceElement,
  master: DesignFirstSliceElement,
  variantIndex: number,
): { scale: number; x: number; y: number } {
  const variant = LOGO_EVIDENCE_VARIANTS[variantIndex];
  const totalWidth = 172;
  const precedingWidth = LOGO_EVIDENCE_VARIANTS.slice(0, variantIndex).reduce(
    (sum, item) => sum + item.size + 12,
    0,
  );
  const scale = variant.size / Math.max(master.width, master.height);
  const slotX =
    Math.max(0, (evidenceRoot.width - totalWidth) / 2) + precedingWidth;
  return {
    scale,
    x: slotX + (variant.size - master.width * scale) / 2,
    y: Math.max(0, (evidenceRoot.height - master.height * scale) / 2),
  };
}

function compileEvidenceNode(
  element: DesignFirstSliceElement,
  direction: NonNullable<
    DesignFirstSliceToolInput["logoExploration"]
  >["directions"][number],
  variant: (typeof LOGO_EVIDENCE_VARIANTS)[number],
  placement: { scale: number; x: number; y: number },
): DesignNode {
  const node = compileElement(element);
  const root = element.id === direction.masterNodeId;
  node.id = derivedEvidenceNodeId(element.id, variant.key);
  node.parentId = root
    ? direction.evidenceRootNodeId
    : derivedEvidenceNodeId(element.parentId, variant.key);
  if (root) {
    node.name = `${element.name} · ${variant.monochrome ? "Monochrome" : `${variant.size}px`}`;
    node.transform = [
      placement.scale,
      0,
      0,
      placement.scale,
      placement.x,
      placement.y,
    ];
  }
  return variant.monochrome ? monochromeNode(node) : node;
}

function derivedEvidenceNodeId(sourceNodeId: string, variant: string): string {
  return `${sourceNodeId}__evidence_${variant}`;
}

function monochromeNode(node: DesignNode): DesignNode {
  const properties = node.properties;
  if ("fills" in properties && properties.fills.length > 0) {
    properties.fills = [{ type: "solid", color: "#111111", opacity: 1 }];
  }
  if ("strokes" in properties && properties.strokes.length > 0) {
    properties.strokes = [{ type: "solid", color: "#111111", opacity: 1 }];
  }
  return node;
}

function compileTarget(
  target: DesignFirstSliceToolInput["targets"][number],
  firstSliceSteps?: readonly DesignPlanTarget["implementationSteps"][number][],
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
      regions: target.regions.map((region) => ({
        nodeId: region.nodeId,
        name: region.name,
        role: region.role,
        ...(region.parentId === target.frame.frameId
          ? {}
          : { parentId: region.parentId }),
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
      })),
      assetIntegration:
        "Use editable typography, native vectors and shapes; raster assets are limited to the explicitly declared roles.",
      spacingRhythm: target.spacing,
    },
    editableLayers: unique([...regionNames, "Typography and controls"]),
    implementationSteps:
      firstSliceSteps?.map((step) => ({ ...step })) ??
      regionNames.map((name, index) => ({
        stepId: `${target.targetId}.region.${index + 1}`,
        label: `Build ${name}`,
      })),
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
    ...(element.blendMode === undefined
      ? {}
      : { blendMode: element.blendMode }),
    ...(element.effects === undefined
      ? {}
      : { effects: structuredClone(element.effects) }),
    extensions: { generatedBy: "compact-first-slice" },
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
      textDecorationStyle: null,
      textDecorationOffset: null,
      textDecorationThickness: null,
      textDecorationColor: null,
      textDecorationSkipInk: null,
      textAlignHorizontal: element.text.align ?? ("left" as const),
      textAlignVertical: "top" as const,
      textOverflow: "visible" as const,
      textTruncation: "disabled" as const,
      maxLines: null,
      fills: structuredClone(element.fills),
      strokes: structuredClone(element.strokes),
      strokeWidth: element.strokeWidth,
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
        fills: structuredClone(element.fills),
        strokes: structuredClone(element.strokes),
        strokeWidth: element.strokeWidth,
        path: element.path,
        fillRule: "nonzero" as const,
      },
    };
  }
  const shape = {
    fills: structuredClone(element.fills),
    strokes: structuredClone(element.strokes),
    strokeWidth: element.strokeWidth,
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
