import type { DesignNode, DesignOperation } from "@opendesign/design-contracts";
import type { DesignApplyToolInput } from "./design-apply-input";
import type {
  DesignPlanComponentCandidate,
  DesignPlanComponentStrategy,
} from "./design-plan-component-strategy";
import type {
  DesignPlanTarget,
  DesignPlanToolInputV4,
  RasterAssetRole,
} from "./design-agent-tools";

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

const ID_SCHEMA = { type: "string", minLength: 1, maxLength: 256 } as const;
const TEXT_SCHEMA = { type: "string", minLength: 1, maxLength: 1_000 } as const;
const COORDINATE_SCHEMA = {
  type: "number",
  minimum: -1_000_000,
  maximum: 1_000_000,
} as const;
const DIMENSION_SCHEMA = {
  type: "number",
  exclusiveMinimum: 0,
  maximum: 100_000,
} as const;
const PAINT_SCHEMA = {
  type: "object",
  properties: {
    color: { type: "string", minLength: 1, maxLength: 128 },
    opacity: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["color"],
  additionalProperties: false,
} as const;
const STROKE_SCHEMA = {
  ...PAINT_SCHEMA,
  properties: {
    ...PAINT_SCHEMA.properties,
    width: { type: "number", exclusiveMinimum: 0, maximum: 10_000 },
  },
  required: ["color", "width"],
} as const;
const ELEMENT_BASE_PROPERTIES = {
  id: ID_SCHEMA,
  name: ID_SCHEMA,
  parentId: ID_SCHEMA,
  x: COORDINATE_SCHEMA,
  y: COORDINATE_SCHEMA,
  width: DIMENSION_SCHEMA,
  height: DIMENSION_SCHEMA,
  opacity: { type: "number", minimum: 0, maximum: 1 },
} as const;
const ELEMENT_BASE_REQUIRED = [
  "id",
  "name",
  "parentId",
  "x",
  "y",
  "width",
  "height",
] as const;

export const DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Compact new-design kernel: declare all real artboard roots and one meaningful editable first slice. The trusted host expands this into DesignPlan v4 plus one rollback-safe OpenDesign transaction.",
  properties: {
    version: { const: 1 },
    deliverable: {
      enum: [
        "ui",
        "poster",
        "logo",
        "brand-asset",
        "illustration",
        "presentation-visual",
        "other",
      ],
    },
    objective: { type: "string", minLength: 1, maxLength: 2_000 },
    targets: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        properties: {
          targetId: { type: "string", minLength: 1, maxLength: 128 },
          label: ID_SCHEMA,
          pageId: ID_SCHEMA,
          objective: { type: "string", minLength: 1, maxLength: 2_000 },
          frame: {
            type: "object",
            properties: {
              frameId: ID_SCHEMA,
              x: COORDINATE_SCHEMA,
              y: COORDINATE_SCHEMA,
              width: DIMENSION_SCHEMA,
              height: DIMENSION_SCHEMA,
            },
            required: ["frameId", "x", "y", "width", "height"],
            additionalProperties: false,
          },
          layout: TEXT_SCHEMA,
          spacing: { type: "string", minLength: 1, maxLength: 500 },
          regions: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                nodeId: ID_SCHEMA,
                name: { type: "string", minLength: 1, maxLength: 128 },
                role: {
                  enum: [
                    "structure",
                    "content",
                    "typography",
                    "media",
                    "graphic",
                    "decoration",
                    "interaction",
                    "other",
                  ],
                },
                x: { type: "number", minimum: 0, maximum: 100_000 },
                y: { type: "number", minimum: 0, maximum: 100_000 },
                width: DIMENSION_SCHEMA,
                height: DIMENSION_SCHEMA,
              },
              required: ["nodeId", "name", "role", "x", "y", "width", "height"],
              additionalProperties: false,
            },
          },
        },
        required: [
          "targetId",
          "label",
          "pageId",
          "objective",
          "frame",
          "layout",
          "spacing",
          "regions",
        ],
        additionalProperties: false,
      },
    },
    visualSystem: {
      type: "object",
      properties: {
        formLanguage: TEXT_SCHEMA,
        palette: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 128 },
        },
        surfaceAndDepth: TEXT_SCHEMA,
        typography: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
        effects: {
          type: "array",
          maxItems: 12,
          items: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
      required: ["formLanguage", "palette", "surfaceAndDepth", "typography"],
      additionalProperties: false,
    },
    rasterAssetRoles: {
      type: "array",
      maxItems: 4,
      uniqueItems: true,
      items: {
        enum: ["reference", "background", "hero", "supporting-content"],
      },
    },
    semanticObjects: {
      type: "array",
      maxItems: 24,
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              decisionId: { type: "string", minLength: 1, maxLength: 128 },
              label: ID_SCHEMA,
              decision: { const: "ordinary" },
              occurrences: {
                type: "array",
                minItems: 1,
                maxItems: 32,
                items: occurrenceSchema(),
              },
            },
            required: ["decisionId", "label", "decision", "occurrences"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              decisionId: { type: "string", minLength: 1, maxLength: 128 },
              label: ID_SCHEMA,
              decision: { const: "component" },
              componentId: ID_SCHEMA,
              main: occurrenceSchema(),
              instances: {
                type: "array",
                maxItems: 32,
                items: occurrenceSchema(),
              },
            },
            required: [
              "decisionId",
              "label",
              "decision",
              "componentId",
              "main",
              "instances",
            ],
            additionalProperties: false,
          },
        ],
      },
    },
    firstSlice: {
      type: "object",
      properties: {
        targetId: { type: "string", minLength: 1, maxLength: 128 },
        label: ID_SCHEMA,
        stages: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          items: {
            type: "object",
            properties: {
              stageId: { type: "string", minLength: 1, maxLength: 128 },
              label: ID_SCHEMA,
              elements: {
                type: "array",
                minItems: 1,
                maxItems: 120,
                items: {
                  oneOf: [
                    elementSchema("group", {}),
                    elementSchema("frame", {
                      fill: PAINT_SCHEMA,
                      stroke: STROKE_SCHEMA,
                      cornerRadius: {
                        type: "number",
                        minimum: 0,
                        maximum: 100_000,
                      },
                      clipsContent: { type: "boolean" },
                    }),
                    elementSchema(
                      "rectangle",
                      {
                        fill: PAINT_SCHEMA,
                        stroke: STROKE_SCHEMA,
                        cornerRadius: {
                          type: "number",
                          minimum: 0,
                          maximum: 100_000,
                        },
                      },
                      ["fill"],
                    ),
                    elementSchema(
                      "ellipse",
                      { fill: PAINT_SCHEMA, stroke: STROKE_SCHEMA },
                      ["fill"],
                    ),
                    elementSchema(
                      "text",
                      {
                        text: {
                          type: "object",
                          properties: {
                            content: { type: "string", minLength: 1 },
                            fontFamily: ID_SCHEMA,
                            fontStyleName: {
                              type: "string",
                              minLength: 1,
                              maxLength: 512,
                            },
                            fontWeight: {
                              type: "integer",
                              minimum: 1,
                              maximum: 1_000,
                            },
                            fontSlant: { enum: ["normal", "italic"] },
                            fontSize: DIMENSION_SCHEMA,
                            lineHeight: DIMENSION_SCHEMA,
                            letterSpacing: { type: "number" },
                            color: {
                              type: "string",
                              minLength: 1,
                              maxLength: 128,
                            },
                            textResize: {
                              enum: ["auto-width", "auto-height", "fixed"],
                            },
                            align: {
                              enum: ["left", "center", "right", "justify"],
                            },
                          },
                          required: [
                            "content",
                            "fontFamily",
                            "fontStyleName",
                            "fontWeight",
                            "fontSlant",
                            "fontSize",
                            "lineHeight",
                            "color",
                            "textResize",
                          ],
                          additionalProperties: false,
                        },
                      },
                      ["text"],
                    ),
                  ],
                },
              },
            },
            required: ["stageId", "label", "elements"],
            additionalProperties: false,
          },
        },
      },
      required: ["targetId", "label", "stages"],
      additionalProperties: false,
    },
  },
  required: [
    "version",
    "deliverable",
    "objective",
    "targets",
    "visualSystem",
    "rasterAssetRoles",
    "firstSlice",
  ],
  additionalProperties: false,
} as const;

export function isDesignFirstSliceToolInput(
  value: unknown,
): value is DesignFirstSliceToolInput {
  if (!isRecord(value) || value.version !== 1) return false;
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
  if (materializedRegions.size === 0) return false;
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

export function compileDesignFirstSliceToolInput(
  input: DesignFirstSliceToolInput,
): {
  plan: DesignPlanToolInputV4;
  apply: DesignApplyToolInput;
  insertedNodeIds: string[];
} {
  if (!isDesignFirstSliceToolInput(input)) {
    throw new TypeError("Invalid compact first-slice input");
  }
  const targets = input.targets.map(compileTarget);
  const componentStrategy = compileComponentStrategy(
    input.semanticObjects ?? [],
  );
  const plan: DesignPlanToolInputV4 = {
    version: 4,
    deliverable: input.deliverable,
    objective: input.objective,
    outputMode: "editable-composition",
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
  };
}

function compileComponentStrategy(
  objects: NonNullable<DesignFirstSliceToolInput["semanticObjects"]>,
): DesignPlanComponentStrategy {
  const candidates: DesignPlanComponentCandidate[] = objects.map((object) =>
    object.decision === "ordinary"
      ? {
          decisionId: object.decisionId,
          label: object.label,
          decision: "ordinary",
          rationale: `${object.label} remains ordinary because this delivery does not require centralized reusable instance behavior.`,
          occurrences: object.occurrences.map((occurrence) => ({
            ...occurrence,
          })),
        }
      : {
          decisionId: object.decisionId,
          label: object.label,
          decision: "component",
          rationale: `${object.label} is reusable and should preserve centralized structure with explicit instances.`,
          componentId: object.componentId,
          main: { ...object.main, mode: "create" },
          instances: object.instances.map((instance) => ({ ...instance })),
        },
  );
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

function occurrenceSchema() {
  return {
    type: "object",
    properties: {
      targetId: { type: "string", minLength: 1, maxLength: 128 },
      nodeId: ID_SCHEMA,
    },
    required: ["targetId", "nodeId"],
    additionalProperties: false,
  } as const;
}

function elementSchema(
  kind: DesignFirstSliceElement["kind"],
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) {
  return {
    type: "object",
    properties: {
      ...ELEMENT_BASE_PROPERTIES,
      kind: { const: kind },
      ...properties,
    },
    required: [...ELEMENT_BASE_REQUIRED, "kind", ...required],
    additionalProperties: false,
  } as const;
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
    "regions",
  ]);
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
    value.stages.length > 8 ||
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
  return total <= 120;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
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
