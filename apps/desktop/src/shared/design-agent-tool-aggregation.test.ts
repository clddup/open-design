import { describe, expect, it } from "vitest";
import { disclosedToolDefinitions } from "@opendesign/agent-runtime";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_CAPTURE_TOOL_NAME,
  DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA,
  DESIGN_CHECKPOINT_TOOL_NAME,
  DESIGN_CONTINUATION_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_SYSTEM_TOOL_INPUT_SCHEMA,
  DESIGN_SYSTEM_NEW_DESIGN_INPUT_SCHEMA,
  DESIGN_SYSTEM_TOOL_NAME,
  DesignSystemContract,
  DESIGN_DELIVERY_SCOPE_TOOL_NAME,
  DESIGN_EDIT_TOOL_INPUT_SCHEMA,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA,
  DESIGN_FIRST_SLICE_TOOL_NAME,
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_FONT_TOOL_NAME,
  DESIGN_INSPECT_TOOL_NAME,
  DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  DESIGN_PAGE_TOOL_NAME,
  DESIGN_PLAN_TOOL_INPUT_SCHEMA,
  DESIGN_PLAN_TOOL_NAME,
  DESIGN_PLAN_UPDATE_TOOL_INPUT_SCHEMA,
  DESIGN_PLAN_UPDATE_TOOL_NAME,
  DESIGN_REVIEW_TOOL_NAME,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_NAME,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_NAME,
  DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA,
  EXPORT_RASTER_TOOL_INPUT_SCHEMA,
  EXPORT_RASTER_TOOL_NAME,
  EDIT_IMAGE_TOOL_INPUT_SCHEMA,
  EDIT_IMAGE_TOOL_NAME,
  EXPORT_SVG_TOOL_INPUT_SCHEMA,
  EXPORT_SVG_TOOL_NAME,
  GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  GENERATE_IMAGE_TOOL_NAME,
  IMPORT_SVG_TOOL_INPUT_SCHEMA,
  IMPORT_SVG_TOOL_NAME,
  INTERNAL_DESIGN_COMPONENT_TOOL_NAME,
  INTERNAL_DESIGN_STYLE_TOOL_NAME,
  INTERNAL_DESIGN_VARIABLE_TOOL_NAME,
  PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
  PAGE_STRUCTURE_ACCESS_TOOL_NAME,
  PLACE_IMAGE_TOOL_INPUT_SCHEMA,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_INPUT_SCHEMA,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
  UPDATE_IMAGE_TOOL_NAME,
} from "./design-agent-tools";

describe("design Agent tool aggregation", () => {
  it("keeps the public tool order stable", () => {
    expect(DESIGN_AGENT_TOOL_SPECS.map((tool) => tool.name)).toEqual([
      DESIGN_DELIVERY_SCOPE_TOOL_NAME,
      DESIGN_FIRST_SLICE_TOOL_NAME,
      DESIGN_CAPABILITIES_TOOL_NAME,
      DESIGN_INSPECT_TOOL_NAME,
      DESIGN_CAPTURE_TOOL_NAME,
      DESIGN_PLAN_TOOL_NAME,
      DESIGN_PLAN_UPDATE_TOOL_NAME,
      DESIGN_REVIEW_TOOL_NAME,
      DESIGN_CHECKPOINT_TOOL_NAME,
      READ_IMAGE_TOOL_NAME,
      GENERATE_IMAGE_TOOL_NAME,
      PLACE_IMAGE_TOOL_NAME,
      UPDATE_IMAGE_TOOL_NAME,
      EDIT_IMAGE_TOOL_NAME,
      IMPORT_SVG_TOOL_NAME,
      EXPORT_SVG_TOOL_NAME,
      EXPORT_RASTER_TOOL_NAME,
      DESIGN_EDIT_TOOL_NAME,
      DESIGN_VECTOR_TOOL_NAME,
      DESIGN_SYSTEM_TOOL_NAME,
      PAGE_STRUCTURE_ACCESS_TOOL_NAME,
      DESIGN_PAGE_TOOL_NAME,
      DESIGN_TEXT_RANGE_TOOL_NAME,
      DESIGN_FONT_TOOL_NAME,
    ]);
  });

  it("uses each family schema as the single aggregation source", () => {
    const schemaByName = new Map<string, unknown>(
      DESIGN_AGENT_TOOL_SPECS.map((tool) => [tool.name, tool.inputSchema]),
    );
    const expected: ReadonlyArray<readonly [string, unknown]> = [
      [DESIGN_PLAN_TOOL_NAME, DESIGN_PLAN_TOOL_INPUT_SCHEMA],
      [DESIGN_PLAN_UPDATE_TOOL_NAME, DESIGN_PLAN_UPDATE_TOOL_INPUT_SCHEMA],
      [DESIGN_FIRST_SLICE_TOOL_NAME, DESIGN_FIRST_SLICE_TOOL_INPUT_SCHEMA],
      [DESIGN_REVIEW_TOOL_NAME, DESIGN_VISUAL_REVIEW_TOOL_INPUT_SCHEMA],
      [DESIGN_CHECKPOINT_TOOL_NAME, DESIGN_CHECKPOINT_TOOL_INPUT_SCHEMA],
      [READ_IMAGE_TOOL_NAME, READ_IMAGE_TOOL_INPUT_SCHEMA],
      [GENERATE_IMAGE_TOOL_NAME, GENERATE_IMAGE_TOOL_INPUT_SCHEMA],
      [PLACE_IMAGE_TOOL_NAME, PLACE_IMAGE_TOOL_INPUT_SCHEMA],
      [UPDATE_IMAGE_TOOL_NAME, UPDATE_IMAGE_TOOL_INPUT_SCHEMA],
      [EDIT_IMAGE_TOOL_NAME, EDIT_IMAGE_TOOL_INPUT_SCHEMA],
      [IMPORT_SVG_TOOL_NAME, IMPORT_SVG_TOOL_INPUT_SCHEMA],
      [EXPORT_SVG_TOOL_NAME, EXPORT_SVG_TOOL_INPUT_SCHEMA],
      [EXPORT_RASTER_TOOL_NAME, EXPORT_RASTER_TOOL_INPUT_SCHEMA],
      [DESIGN_EDIT_TOOL_NAME, DESIGN_EDIT_TOOL_INPUT_SCHEMA],
      [DESIGN_VECTOR_TOOL_NAME, DESIGN_VECTOR_TOOL_INPUT_SCHEMA],
      [DESIGN_SYSTEM_TOOL_NAME, DESIGN_SYSTEM_TOOL_INPUT_SCHEMA],
      [
        PAGE_STRUCTURE_ACCESS_TOOL_NAME,
        PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
      ],
      [DESIGN_PAGE_TOOL_NAME, DESIGN_PAGE_TOOL_INPUT_SCHEMA],
      [DESIGN_TEXT_RANGE_TOOL_NAME, DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA],
      [DESIGN_FONT_TOOL_NAME, DESIGN_FONT_TOOL_INPUT_SCHEMA],
    ];

    for (const [name, schema] of expected) {
      expect(schemaByName.get(name), name).toBe(schema);
    }
  });

  it("keeps internal design-system routes out of the Provider catalog", () => {
    const names = DESIGN_AGENT_TOOL_SPECS.map((tool) => tool.name);
    expect(names).toContain(DESIGN_SYSTEM_TOOL_NAME);
    expect(names).not.toEqual(
      expect.arrayContaining([
        INTERNAL_DESIGN_COMPONENT_TOOL_NAME,
        INTERNAL_DESIGN_VARIABLE_TOOL_NAME,
        INTERNAL_DESIGN_STYLE_TOOL_NAME,
      ]),
    );
  });

  it("reports the selected design-system branch at its concrete input path", () => {
    expect(
      DesignSystemContract.issues({
        kind: "variable",
        input: {
          action: "set-mode",
          label: "Set dark mode",
          pageId: "page_1",
          target: { kind: "node", nodeId: "title" },
          collectionId: "theme",
          modeId: "dark",
        },
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_system.schema_invalid",
        path: "/input/target/id",
      }),
    );
  });

  it("keeps new-design continuation focused on the current visual stage", () => {
    const visibleTools = disclosedToolDefinitions(
      DESIGN_AGENT_TOOL_SPECS,
      "continuation",
      {
        surface: "new-design",
        deliveryScopeReview: "direct",
      },
    );
    const names = new Set(visibleTools.map((tool) => tool.name));

    for (const name of [
      DESIGN_FIRST_SLICE_TOOL_NAME,
      DESIGN_INSPECT_TOOL_NAME,
      DESIGN_CAPTURE_TOOL_NAME,
      DESIGN_EDIT_TOOL_NAME,
      DESIGN_SYSTEM_TOOL_NAME,
    ]) {
      expect(names.has(name), name).toBe(true);
    }
    for (const name of [
      DESIGN_VECTOR_TOOL_NAME,
      DESIGN_TEXT_RANGE_TOOL_NAME,
      DESIGN_FONT_TOOL_NAME,
      DESIGN_PAGE_TOOL_NAME,
      DESIGN_CAPABILITIES_TOOL_NAME,
    ]) {
      expect(names.has(name), name).toBe(false);
    }

    const firstSlice = visibleTools.find(
      (tool) => tool.name === DESIGN_FIRST_SLICE_TOOL_NAME,
    );
    expect(firstSlice?.description).toContain(
      "a new-design Run remains on its compact continuation surface",
    );

    const system = disclosedToolDefinitions(
      DESIGN_AGENT_TOOL_SPECS,
      "continuation",
      { surface: "new-design", deliveryScopeReview: "direct" },
    ).find((tool) => tool.name === DESIGN_SYSTEM_TOOL_NAME);
    expect(system?.inputSchema).toBe(DESIGN_SYSTEM_NEW_DESIGN_INPUT_SCHEMA);
    const componentSchema = (
      DESIGN_SYSTEM_NEW_DESIGN_INPUT_SCHEMA as unknown as {
        anyOf?: readonly {
          properties?: {
            input?: {
              anyOf?: readonly unknown[];
              properties?: { action?: { enum?: readonly string[] } };
            };
          };
        }[];
      }
    ).anyOf?.[0]?.properties?.input;
    expect(componentSchema?.anyOf).toHaveLength(2);
    expect(componentSchema?.properties?.action?.enum).toEqual([
      "create-component",
      "create-instance",
    ]);
  });

  it("keeps continuation edits capable of deterministic layout repair", () => {
    const edit = disclosedToolDefinitions(
      DESIGN_AGENT_TOOL_SPECS,
      "continuation",
      { surface: "new-design", deliveryScopeReview: "direct" },
    ).find((tool) => tool.name === DESIGN_EDIT_TOOL_NAME);

    expect(edit?.inputSchema).toBe(DESIGN_CONTINUATION_EDIT_TOOL_INPUT_SCHEMA);
    const editSchema = edit?.inputSchema as {
      properties?: {
        edits?: {
          items?: {
            anyOf?: readonly {
              properties?: { input?: unknown };
            }[];
          };
        };
      };
    };
    const branches = editSchema.properties?.edits?.items?.anyOf;
    expect(branches).toHaveLength(2);

    const arrangeSchema = branches?.[1]?.properties?.input as {
      properties?: { action?: { enum?: readonly string[] } };
    };
    expect(arrangeSchema.properties?.action?.enum).toEqual(
      expect.arrayContaining([
        "align-left",
        "tidy-up",
        "set-horizontal-spacing",
        "repair-overflow",
        "resize-frame",
      ]),
    );
    expect(arrangeSchema.properties?.action?.enum).not.toContain(
      "set-grid-placement",
    );
  });
});
