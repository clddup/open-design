import {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";
import type { DesignFirstSliceElement } from "./design-first-slice-tool";
import { DESIGN_BRIEF_FIDELITY_SCHEMA } from "./design-brief-fidelity";
import { BUILTIN_UI_DESIGN_SKILL_REFS } from "@opendesign/design-skills";

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
const COMPACT_QUALITY_PROFILE_SCHEMA = {
  oneOf: [
    {
      type: "object",
      properties: { kind: { const: "graphic" } },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
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
        input: { enum: ["pointer", "touch", "mixed"] },
        insets: {
          type: "array",
          minItems: 4,
          maxItems: 4,
          items: { type: "number", minimum: 0, maximum: 10_000 },
          description: "Safe-area top, right, bottom, left.",
        },
        safeNodeIds: {
          type: "array",
          minItems: 1,
          maxItems: 64,
          uniqueItems: true,
          items: ID_SCHEMA,
        },
        hitNodeIds: {
          type: "array",
          maxItems: 64,
          uniqueItems: true,
          items: ID_SCHEMA,
        },
      },
      required: [
        "kind",
        "platform",
        "input",
        "insets",
        "safeNodeIds",
        "hitNodeIds",
      ],
      additionalProperties: false,
    },
  ],
} as const;

export const DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Current compact Design Plan, exact built-in design skill references, real artboard roots and one editable first slice.",
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
    designIntent: {
      type: "object",
      properties: {
        subject: { type: "string", minLength: 8, maxLength: 500 },
        audience: { type: "string", minLength: 8, maxLength: 500 },
        primaryJob: { type: "string", minLength: 8, maxLength: 500 },
        visualThesis: { type: "string", minLength: 16, maxLength: 1_000 },
        signatureMotif: { type: "string", minLength: 16, maxLength: 1_000 },
        typographyLanguage: {
          type: "string",
          minLength: 12,
          maxLength: 1_000,
        },
        colorMaterialLanguage: {
          type: "string",
          minLength: 12,
          maxLength: 1_000,
        },
        compositionTension: {
          type: "string",
          minLength: 12,
          maxLength: 1_000,
        },
        antiPatterns: {
          type: "array",
          minItems: 3,
          maxItems: 12,
          uniqueItems: true,
          items: { type: "string", minLength: 8, maxLength: 256 },
        },
      },
      required: [
        "subject",
        "audience",
        "primaryJob",
        "visualThesis",
        "signatureMotif",
        "typographyLanguage",
        "colorMaterialLanguage",
        "compositionTension",
        "antiPatterns",
      ],
      additionalProperties: false,
    },
    skillRefs: {
      oneOf: [
        {
          type: "array",
          minItems: BUILTIN_UI_DESIGN_SKILL_REFS.length,
          maxItems: BUILTIN_UI_DESIGN_SKILL_REFS.length,
          items: {
            oneOf: BUILTIN_UI_DESIGN_SKILL_REFS.map((reference) => ({
              type: "object",
              properties: {
                id: { const: reference.id },
                version: { const: reference.version },
                hash: { const: reference.hash },
              },
              required: ["id", "version", "hash"],
              additionalProperties: false,
            })),
          },
        },
        { type: "array", maxItems: 0 },
      ],
    },
    briefFidelity: DESIGN_BRIEF_FIDELITY_SCHEMA,
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
          qualityProfile: COMPACT_QUALITY_PROFILE_SCHEMA,
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
          "qualityProfile",
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
          maxItems: DESIGN_FIRST_SLICE_MAX_STAGES,
          items: {
            type: "object",
            properties: {
              stageId: { type: "string", minLength: 1, maxLength: 128 },
              label: ID_SCHEMA,
              elements: {
                type: "array",
                minItems: 1,
                maxItems: DESIGN_FIRST_SLICE_MAX_ELEMENTS,
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
    "designIntent",
    "skillRefs",
    "briefFidelity",
    "targets",
    "visualSystem",
    "rasterAssetRoles",
    "firstSlice",
  ],
  additionalProperties: false,
} as const;

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
