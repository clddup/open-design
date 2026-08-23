import {
  DESIGN_FIRST_SLICE_MAX_ELEMENTS,
  DESIGN_FIRST_SLICE_MAX_STAGES,
} from "./design-first-slice-budget";
import {
  DESIGN_LOGO_OUTPUTS,
  LOGO_CONCEPT_PRINCIPLES,
} from "./design-agent-plan-review";
import type { DesignFirstSliceElement } from "./design-first-slice-tool";

const ID_SCHEMA = { type: "string", minLength: 1, maxLength: 256 } as const;
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
    "Real artboard roots and one editable first slice. Main binds design skills, derives ordinary planning metadata from the objective and visible elements, and keeps the exact user request for visual review so the first pixels are not delayed by duplicated prose.",
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
      description:
        "Declare the complete requested target set. Each target's regions are the complete material sections required for that target, including every requested concept direction; firstSlice may materialize one or more of targets[0]'s declared regions.",
      items: {
        type: "object",
        properties: {
          targetId: { type: "string", minLength: 1, maxLength: 128 },
          label: ID_SCHEMA,
          pageId: ID_SCHEMA,
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
          regions: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "object",
              properties: {
                nodeId: ID_SCHEMA,
                name: { type: "string", minLength: 1, maxLength: 128 },
                parentId: {
                  ...ID_SCHEMA,
                  description:
                    "Parent region ID, or this target's frameId for a top-level region. Regions are parent-first and bounds are local to this parent. Main creates the real Frame container; firstSlice elements must not repeat the region ID.",
                },
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
              required: [
                "nodeId",
                "name",
                "role",
                "parentId",
                "x",
                "y",
                "width",
                "height",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["targetId", "label", "pageId", "frame", "regions"],
        additionalProperties: false,
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
          description: `1-${DESIGN_FIRST_SLICE_MAX_STAGES} stages; at most ${DESIGN_FIRST_SLICE_MAX_ELEMENTS} elements total across all stages.`,
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
                      "path",
                      {
                        path: {
                          type: "string",
                          minLength: 1,
                          maxLength: 20_000,
                        },
                        fill: PAINT_SCHEMA,
                      },
                      ["path", "fill"],
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
    logoOutputs: {
      type: "array",
      minItems: 1,
      maxItems: DESIGN_LOGO_OUTPUTS.length,
      uniqueItems: true,
      items: { enum: [...DESIGN_LOGO_OUTPUTS] },
    },
    logoExploration: {
      type: "object",
      description:
        "Required when the Logo brief asks for multiple directions. Declare exactly three genuinely distinct concepts and stable evidence IDs before drawing so the trusted host cannot verify a partial exploration board.",
      properties: {
        targetId: { type: "string", minLength: 1, maxLength: 128 },
        directions: {
          type: "array",
          minItems: 3,
          maxItems: 3,
          items: {
            type: "object",
            properties: {
              conceptId: { type: "string", minLength: 1, maxLength: 128 },
              principle: { enum: [...LOGO_CONCEPT_PRINCIPLES] },
              thesis: { type: "string", minLength: 16, maxLength: 1_000 },
              constructionLogic: {
                type: "string",
                minLength: 24,
                maxLength: 1_000,
                description:
                  "Name the visible geometric mechanism, ownable silhouette or counterform, and the recognition anchor that survives at 16 px. Do not retrofit a story to an arbitrary shape.",
              },
              rootNodeId: ID_SCHEMA,
              evidenceNodeIds: {
                type: "array",
                minItems: 4,
                maxItems: 4,
                uniqueItems: true,
                description:
                  "Distinct editable nodes ordered monochrome master, 32 px, 24 px, and 16 px.",
                items: ID_SCHEMA,
              },
            },
            required: [
              "conceptId",
              "principle",
              "thesis",
              "constructionLogic",
              "rootNodeId",
              "evidenceNodeIds",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["targetId", "directions"],
      additionalProperties: false,
    },
  },
  required: ["version", "deliverable", "objective", "targets", "firstSlice"],
  additionalProperties: false,
} as const;

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
