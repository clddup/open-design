import {
  isBuiltinUiDesignSkillRefs,
  type BuiltinDesignSkillRef,
} from "@opendesign/design-skills";
import type { DesignIntent, RasterAssetRole } from "./design-agent-tools";
import {
  isDesignBriefFidelity,
  type DesignBriefFidelity,
} from "./design-brief-fidelity";
import { compileValidatedDesignFirstSliceToolInput } from "./design-first-slice-compiler";
import {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";

export { DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA } from "./design-first-slice-tool-schema";
export {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";

type CompactPaint = {
  color: string;
  opacity?: number;
};

type CompactStroke = CompactPaint & { width: number };

type CompactElementBase = {
  id: string;
  name: string;
  parentId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
};

export type DesignFirstSliceElement =
  | (CompactElementBase & { kind: "group" })
  | (CompactElementBase & {
      kind: "frame";
      fill?: CompactPaint;
      stroke?: CompactStroke;
      cornerRadius?: number;
      clipsContent?: boolean;
    })
  | (CompactElementBase & {
      kind: "rectangle";
      fill: CompactPaint;
      stroke?: CompactStroke;
      cornerRadius?: number;
    })
  | (CompactElementBase & {
      kind: "ellipse";
      fill: CompactPaint;
      stroke?: CompactStroke;
    })
  | (CompactElementBase & {
      kind: "text";
      text: {
        content: string;
        fontFamily: string;
        fontStyleName: string;
        fontWeight: number;
        fontSlant: "normal" | "italic";
        fontSize: number;
        lineHeight: number;
        letterSpacing?: number;
        color: string;
        textResize: "auto-width" | "auto-height" | "fixed";
        align?: "left" | "center" | "right" | "justify";
      };
    });

export type DesignFirstSliceQualityProfile =
  | { kind: "graphic" }
  | {
      kind: "ui";
      platform:
        "web" | "macos" | "windows" | "ios" | "ipados" | "android" | "other";
      input: "pointer" | "touch" | "mixed";
      insets: [number, number, number, number];
      safeNodeIds: string[];
      hitNodeIds: string[];
    };

export type DesignFirstSliceToolInput = {
  version: 1;
  deliverable:
    | "ui"
    | "poster"
    | "logo"
    | "brand-asset"
    | "illustration"
    | "presentation-visual"
    | "other";
  objective: string;
  designIntent: DesignIntent;
  skillRefs: BuiltinDesignSkillRef[];
  briefFidelity: DesignBriefFidelity;
  targets: Array<{
    targetId: string;
    label: string;
    pageId: string;
    objective: string;
    frame: {
      frameId: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };
    layout: string;
    spacing: string;
    qualityProfile: DesignFirstSliceQualityProfile;
    regions: Array<{
      nodeId: string;
      name: string;
      role:
        | "structure"
        | "content"
        | "typography"
        | "media"
        | "graphic"
        | "decoration"
        | "interaction"
        | "other";
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  }>;
  visualSystem: {
    formLanguage: string;
    palette: string[];
    surfaceAndDepth: string;
    typography: string[];
    effects?: string[];
  };
  rasterAssetRoles: RasterAssetRole[];
  semanticObjects?: Array<
    | {
        decisionId: string;
        label: string;
        decision: "ordinary";
        occurrences: Array<{ targetId: string; nodeId: string }>;
      }
    | {
        decisionId: string;
        label: string;
        decision: "component";
        componentId: string;
        main: { targetId: string; nodeId: string };
        instances: Array<{ targetId: string; nodeId: string }>;
      }
  >;
  firstSlice: {
    targetId: string;
    label: string;
    stages: Array<{
      stageId: string;
      label: string;
      elements: DesignFirstSliceElement[];
    }>;
  };
};

export function isDesignFirstSliceToolInput(
  value: unknown,
): value is DesignFirstSliceToolInput {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isDesignBriefFidelity(value.briefFidelity) ||
    !isCompactDesignIntent(value.designIntent) ||
    (value.deliverable === "ui"
      ? !isBuiltinUiDesignSkillRefs(value.skillRefs)
      : !Array.isArray(value.skillRefs) || value.skillRefs.length !== 0)
  )
    return false;
  if (
    ![
      "ui",
      "poster",
      "logo",
      "brand-asset",
      "illustration",
      "presentation-visual",
      "other",
    ].includes(String(value.deliverable)) ||
    !text(value.objective, 1, 2_000) ||
    !Array.isArray(value.targets) ||
    value.targets.length < 1 ||
    value.targets.length > 32 ||
    !value.targets.every(isTarget) ||
    !isVisualSystem(value.visualSystem) ||
    !isRasterRoles(value.rasterAssetRoles) ||
    (value.semanticObjects !== undefined &&
      (!Array.isArray(value.semanticObjects) ||
        value.semanticObjects.length > 24)) ||
    !isFirstSlice(value.firstSlice)
  ) {
    return false;
  }
  if (
    !exactKeys(value, [
      "version",
      "deliverable",
      "objective",
      "designIntent",
      "skillRefs",
      "briefFidelity",
      "targets",
      "visualSystem",
      "rasterAssetRoles",
      ...(value.semanticObjects === undefined ? [] : ["semanticObjects"]),
      "firstSlice",
    ])
  ) {
    return false;
  }
  const targets = value.targets as DesignFirstSliceToolInput["targets"];
  if (
    targets.some((target) =>
      value.deliverable === "ui"
        ? target.qualityProfile.kind !== "ui"
        : target.qualityProfile.kind !== "graphic",
    )
  ) {
    return false;
  }
  const targetIds = new Set(targets.map((target) => target.targetId));
  const frameIds = new Set(targets.map((target) => target.frame.frameId));
  const regionIds = targets.flatMap((target) =>
    target.regions.map((region) => region.nodeId),
  );
  if (
    targetIds.size !== targets.length ||
    frameIds.size !== targets.length ||
    new Set(regionIds).size !== regionIds.length ||
    targets.some((target) =>
      target.regions.some(
        (region) =>
          region.nodeId === target.frame.frameId ||
          region.x + region.width > target.frame.width ||
          region.y + region.height > target.frame.height,
      ),
    )
  ) {
    return false;
  }
  const firstSlice =
    value.firstSlice as DesignFirstSliceToolInput["firstSlice"];
  if (firstSlice.targetId !== targets[0]?.targetId) return false;
  const firstTarget = targets[0];
  if (!firstTarget) return false;
  const allElements = firstSlice.stages.flatMap((stage) => stage.elements);
  const elementIds = new Set<string>();
  const parentById = new Map<string, string>();
  for (const element of allElements) {
    if (
      elementIds.has(element.id) ||
      frameIds.has(element.id) ||
      (!elementIds.has(element.parentId) &&
        element.parentId !== firstTarget.frame.frameId)
    ) {
      return false;
    }
    elementIds.add(element.id);
    parentById.set(element.id, element.parentId);
  }
  const materializedRegions = new Set(
    allElements.flatMap((element) =>
      firstTarget.regions.some((region) => region.nodeId === element.id) &&
      (element.kind === "group" || element.kind === "frame")
        ? [element.id]
        : [],
    ),
  );
  if (materializedRegions.size !== 1) return false;
  if (
    ![...materializedRegions].some((regionId) =>
      allElements.some(
        (element) =>
          element.id !== regionId &&
          parentChainReaches(element.parentId, regionId, parentById),
      ),
    )
  ) {
    return false;
  }
  if (!allElements.some(isMaterialElement)) return false;
  const semanticObjects = value.semanticObjects as
    DesignFirstSliceToolInput["semanticObjects"] | undefined;
  if (semanticObjects && !isSemanticObjects(semanticObjects, targetIds)) {
    return false;
  }
  return true;
}

function isCompactDesignIntent(value: unknown): value is DesignIntent {
  if (!isRecord(value)) return false;
  const antiPatterns = value.antiPatterns;
  return (
    text(value.subject, 8, 500) &&
    text(value.audience, 8, 500) &&
    text(value.primaryJob, 8, 500) &&
    text(value.visualThesis, 16, 1_000) &&
    text(value.signatureMotif, 16, 1_000) &&
    text(value.typographyLanguage, 12, 1_000) &&
    text(value.colorMaterialLanguage, 12, 1_000) &&
    text(value.compositionTension, 12, 1_000) &&
    textArray(antiPatterns, 3, 12, 256) &&
    Array.isArray(antiPatterns) &&
    antiPatterns.every(
      (item) => typeof item === "string" && item.trim().length >= 8,
    ) &&
    new Set(antiPatterns).size === antiPatterns.length &&
    exactKeys(value, [
      "subject",
      "audience",
      "primaryJob",
      "visualThesis",
      "signatureMotif",
      "typographyLanguage",
      "colorMaterialLanguage",
      "compositionTension",
      "antiPatterns",
    ])
  );
}

export function compileDesignFirstSliceToolInput(
  input: DesignFirstSliceToolInput,
): ReturnType<typeof compileValidatedDesignFirstSliceToolInput> {
  if (!isDesignFirstSliceToolInput(input)) {
    throw new TypeError("Invalid compact first-slice input");
  }
  return compileValidatedDesignFirstSliceToolInput(input);
}

function isTarget(value: unknown): boolean {
  if (!isRecord(value) || !safeId(value.targetId, 128)) return false;
  if (
    !safeId(value.label) ||
    !safeId(value.pageId) ||
    !text(value.objective, 1, 2_000) ||
    !text(value.layout, 1, 1_000) ||
    !text(value.spacing, 1, 500) ||
    !isRecord(value.frame) ||
    !safeId(value.frame.frameId) ||
    !coordinate(value.frame.x) ||
    !coordinate(value.frame.y) ||
    !dimension(value.frame.width) ||
    !dimension(value.frame.height) ||
    !exactKeys(value.frame, ["frameId", "x", "y", "width", "height"]) ||
    !isCompactQualityProfile(value.qualityProfile, {
      width: value.frame.width,
      height: value.frame.height,
    }) ||
    !Array.isArray(value.regions) ||
    value.regions.length < 1 ||
    value.regions.length > 12 ||
    !value.regions.every(isRegion)
  ) {
    return false;
  }
  return exactKeys(value, [
    "targetId",
    "label",
    "pageId",
    "objective",
    "frame",
    "layout",
    "spacing",
    "qualityProfile",
    "regions",
  ]);
}

function isCompactQualityProfile(
  value: unknown,
  frameSize: { width: number; height: number },
): value is DesignFirstSliceQualityProfile {
  if (!isRecord(value)) return false;
  if (value.kind === "graphic") return exactKeys(value, ["kind"]);
  const safeNodeIds = value.safeNodeIds;
  const hitNodeIds = value.hitNodeIds;
  const insets = value.insets;
  if (
    value.kind !== "ui" ||
    !["web", "macos", "windows", "ios", "ipados", "android", "other"].includes(
      String(value.platform),
    ) ||
    !["pointer", "touch", "mixed"].includes(String(value.input)) ||
    !isInsetTuple(insets) ||
    !idArray(safeNodeIds, 1, 64) ||
    !idArray(hitNodeIds, 0, 64) ||
    !hitNodeIds.every((nodeId) => safeNodeIds.includes(nodeId)) ||
    !exactKeys(value, [
      "kind",
      "platform",
      "input",
      "insets",
      "safeNodeIds",
      "hitNodeIds",
    ])
  ) {
    return false;
  }
  const [top, right, bottom, left] = insets;
  return left + right < frameSize.width && top + bottom < frameSize.height;
}

function isInsetTuple(
  value: unknown,
): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (inset: unknown) =>
        typeof inset === "number" &&
        Number.isFinite(inset) &&
        inset >= 0 &&
        inset <= 10_000,
    )
  );
}

function idArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((nodeId) => safeId(nodeId)) &&
    new Set(value).size === value.length
  );
}

function isRegion(value: unknown): boolean {
  return (
    isRecord(value) &&
    safeId(value.nodeId) &&
    text(value.name, 1, 128) &&
    [
      "structure",
      "content",
      "typography",
      "media",
      "graphic",
      "decoration",
      "interaction",
      "other",
    ].includes(String(value.role)) &&
    nonnegative(value.x) &&
    nonnegative(value.y) &&
    dimension(value.width) &&
    dimension(value.height) &&
    exactKeys(value, ["nodeId", "name", "role", "x", "y", "width", "height"])
  );
}

function isVisualSystem(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.formLanguage, 1, 1_000) &&
    textArray(value.palette, 1, 12, 128) &&
    text(value.surfaceAndDepth, 1, 1_000) &&
    textArray(value.typography, 1, 8, 256) &&
    (value.effects === undefined || textArray(value.effects, 0, 12, 256)) &&
    exactKeys(value, [
      "formLanguage",
      "palette",
      "surfaceAndDepth",
      "typography",
      ...(value.effects === undefined ? [] : ["effects"]),
    ])
  );
}

function isRasterRoles(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= 4 &&
    value.every((role) =>
      ["reference", "background", "hero", "supporting-content"].includes(
        String(role),
      ),
    ) &&
    new Set(value).size === value.length
  );
}

function isFirstSlice(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !safeId(value.targetId, 128) ||
    !safeId(value.label) ||
    !Array.isArray(value.stages) ||
    value.stages.length < 1 ||
    value.stages.length > DESIGN_FIRST_SLICE_MAX_STAGES ||
    !exactKeys(value, ["targetId", "label", "stages"])
  ) {
    return false;
  }
  let total = 0;
  const stageIds = new Set<string>();
  for (const stage of value.stages) {
    if (
      !isRecord(stage) ||
      !safeId(stage.stageId, 128) ||
      stageIds.has(stage.stageId) ||
      !safeId(stage.label) ||
      !Array.isArray(stage.elements) ||
      stage.elements.length < 1 ||
      !stage.elements.every(isElement) ||
      !exactKeys(stage, ["stageId", "label", "elements"])
    ) {
      return false;
    }
    stageIds.add(stage.stageId);
    total += stage.elements.length;
  }
  return total <= DESIGN_FIRST_SLICE_MAX_ELEMENTS;
}

function isElement(value: unknown): value is DesignFirstSliceElement {
  if (
    !isRecord(value) ||
    !safeId(value.id) ||
    !safeId(value.name) ||
    !safeId(value.parentId) ||
    !coordinate(value.x) ||
    !coordinate(value.y) ||
    !dimension(value.width) ||
    !dimension(value.height) ||
    (value.opacity !== undefined && !unit(value.opacity))
  ) {
    return false;
  }
  const common = [
    "id",
    "name",
    "parentId",
    "kind",
    "x",
    "y",
    "width",
    "height",
    ...(value.opacity === undefined ? [] : ["opacity"]),
  ];
  if (value.kind === "group") return exactKeys(value, common);
  if (value.kind === "text") {
    return isCompactText(value.text) && exactKeys(value, [...common, "text"]);
  }
  if (value.kind === "frame") {
    return (
      (value.fill === undefined || isPaint(value.fill)) &&
      (value.stroke === undefined || isStroke(value.stroke)) &&
      (value.cornerRadius === undefined || nonnegative(value.cornerRadius)) &&
      (value.clipsContent === undefined ||
        typeof value.clipsContent === "boolean") &&
      exactKeys(value, [
        ...common,
        ...(value.fill === undefined ? [] : ["fill"]),
        ...(value.stroke === undefined ? [] : ["stroke"]),
        ...(value.cornerRadius === undefined ? [] : ["cornerRadius"]),
        ...(value.clipsContent === undefined ? [] : ["clipsContent"]),
      ])
    );
  }
  if (value.kind !== "rectangle" && value.kind !== "ellipse") return false;
  return (
    isPaint(value.fill) &&
    (value.stroke === undefined || isStroke(value.stroke)) &&
    (value.kind !== "rectangle" ||
      value.cornerRadius === undefined ||
      nonnegative(value.cornerRadius)) &&
    exactKeys(value, [
      ...common,
      "fill",
      ...(value.stroke === undefined ? [] : ["stroke"]),
      ...(value.kind === "rectangle" && value.cornerRadius !== undefined
        ? ["cornerRadius"]
        : []),
    ])
  );
}

function isCompactText(value: unknown): boolean {
  return (
    isRecord(value) &&
    text(value.content, 1, 100_000) &&
    safeId(value.fontFamily, 4_096) &&
    text(value.fontStyleName, 1, 512) &&
    Number.isInteger(value.fontWeight) &&
    Number(value.fontWeight) >= 1 &&
    Number(value.fontWeight) <= 1_000 &&
    (value.fontSlant === "normal" || value.fontSlant === "italic") &&
    dimension(value.fontSize) &&
    dimension(value.lineHeight) &&
    (value.letterSpacing === undefined ||
      Number.isFinite(value.letterSpacing)) &&
    text(value.color, 1, 128) &&
    typeof value.textResize === "string" &&
    ["auto-width", "auto-height", "fixed"].includes(value.textResize) &&
    (value.align === undefined ||
      (typeof value.align === "string" &&
        ["left", "center", "right", "justify"].includes(value.align))) &&
    exactKeys(value, [
      "content",
      "fontFamily",
      "fontStyleName",
      "fontWeight",
      "fontSlant",
      "fontSize",
      "lineHeight",
      ...(value.letterSpacing === undefined ? [] : ["letterSpacing"]),
      "color",
      "textResize",
      ...(value.align === undefined ? [] : ["align"]),
    ])
  );
}

function isPaint(value: unknown): value is CompactPaint {
  return (
    isRecord(value) &&
    text(value.color, 1, 128) &&
    (value.opacity === undefined || unit(value.opacity)) &&
    exactKeys(value, [
      "color",
      ...(value.opacity === undefined ? [] : ["opacity"]),
    ])
  );
}

function isStroke(value: unknown): value is CompactStroke {
  return (
    isPaintLike(value) &&
    dimension(value.width) &&
    exactKeys(value, [
      "color",
      ...(value.opacity === undefined ? [] : ["opacity"]),
      "width",
    ])
  );
}

function isPaintLike(
  value: unknown,
): value is Record<string, unknown> & { color: string; opacity?: number } {
  return (
    isRecord(value) &&
    text(value.color, 1, 128) &&
    (value.opacity === undefined || unit(value.opacity))
  );
}

function isSemanticObjects(
  objects: NonNullable<DesignFirstSliceToolInput["semanticObjects"]>,
  targetIds: ReadonlySet<string>,
): boolean {
  const decisions = new Set<string>();
  const components = new Set<string>();
  const nodes = new Set<string>();
  for (const object of objects) {
    if (
      !isRecord(object) ||
      !safeId(object.decisionId, 128) ||
      decisions.has(object.decisionId) ||
      !safeId(object.label)
    ) {
      return false;
    }
    decisions.add(object.decisionId);
    const occurrences =
      object.decision === "ordinary"
        ? object.occurrences
        : object.decision === "component"
          ? [
              object.main,
              ...(Array.isArray(object.instances) ? object.instances : []),
            ]
          : undefined;
    if (
      !Array.isArray(occurrences) ||
      occurrences.length < 1 ||
      occurrences.length > 33 ||
      !occurrences.every(
        (occurrence) =>
          isRecord(occurrence) &&
          safeId(occurrence.targetId, 128) &&
          targetIds.has(occurrence.targetId) &&
          safeId(occurrence.nodeId) &&
          exactKeys(occurrence, ["targetId", "nodeId"]),
      )
    ) {
      return false;
    }
    for (const occurrence of occurrences) {
      const nodeId = (occurrence as { nodeId: string }).nodeId;
      if (nodes.has(nodeId)) return false;
      nodes.add(nodeId);
    }
    if (object.decision === "ordinary") {
      if (
        !exactKeys(object, ["decisionId", "label", "decision", "occurrences"])
      ) {
        return false;
      }
      continue;
    }
    if (
      !safeId(object.componentId) ||
      components.has(object.componentId) ||
      !Array.isArray(object.instances) ||
      !exactKeys(object, [
        "decisionId",
        "label",
        "decision",
        "componentId",
        "main",
        "instances",
      ])
    ) {
      return false;
    }
    components.add(object.componentId);
  }
  return true;
}

function isMaterialElement(element: DesignFirstSliceElement): boolean {
  return (
    element.kind === "text" ||
    element.kind === "rectangle" ||
    element.kind === "ellipse" ||
    (element.kind === "frame" && element.fill !== undefined)
  );
}

function parentChainReaches(
  parentId: string,
  ancestorId: string,
  parentById: ReadonlyMap<string, string>,
): boolean {
  let current: string | undefined = parentId;
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = parentById.get(current);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function safeId(value: unknown, max = 256): value is string {
  return (
    text(value, 1, max) &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function text(
  value: unknown,
  minimum: number,
  maximum: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

function textArray(
  value: unknown,
  minimum: number,
  maximum: number,
  textMaximum: number,
): boolean {
  return (
    Array.isArray(value) &&
    value.length >= minimum &&
    value.length <= maximum &&
    value.every((item) => text(item, 1, textMaximum))
  );
}

function coordinate(value: unknown): value is number {
  return Number.isFinite(value) && Math.abs(Number(value)) <= 1_000_000;
}

function nonnegative(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0;
}

function dimension(value: unknown): value is number {
  return (
    Number.isFinite(value) && Number(value) > 0 && Number(value) <= 100_000
  );
}

function unit(value: unknown): value is number {
  return Number.isFinite(value) && Number(value) >= 0 && Number(value) <= 1;
}
