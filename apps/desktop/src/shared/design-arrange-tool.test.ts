import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_ARRANGE_ACTIONS,
  DESIGN_ARRANGE_TOOL_INPUT_SCHEMA,
  DESIGN_ARRANGE_TOOL_NAME,
  DesignArrangeContract,
  type DesignArrangeToolInput,
} from "./design-agent-tools.js";

const common = { label: "Arrange inspected layers", pageId: "page_1" };

const inputs: DesignArrangeToolInput[] = [
  ...(
    [
      "align-left",
      "align-horizontal-center",
      "align-right",
      "align-top",
      "align-vertical-center",
      "align-bottom",
    ] as const
  ).map((action) => ({
    ...common,
    action,
    nodeIds: ["layer_a", "layer_b"],
  })),
  ...(["distribute-horizontal", "distribute-vertical", "tidy-up"] as const).map(
    (action) => ({
      ...common,
      action,
      nodeIds: ["layer_a", "layer_b", "layer_c"],
    }),
  ),
  {
    ...common,
    action: "set-horizontal-spacing",
    nodeIds: ["layer_a", "layer_b"],
    spacing: -8,
  },
  {
    ...common,
    action: "set-vertical-spacing",
    nodeIds: ["layer_a", "layer_b"],
    spacing: 24,
  },
  {
    ...common,
    action: "set-constraints",
    nodeId: "content",
    constraints: { horizontal: "left-right", vertical: "top" },
  },
  {
    ...common,
    action: "repair-overflow",
    frameId: "delivery_frame",
  },
  {
    ...common,
    action: "resize-frame",
    frameId: "responsive_frame",
    width: 1440,
    height: 900,
  },
  {
    ...common,
    action: "set-auto-layout",
    frameId: "frame_grid",
    autoLayout: {
      mode: "grid",
      padding: { top: 16, right: 16, bottom: 16, left: 16 },
      rowGap: 12,
      columnGap: 16,
      rows: [{ type: "hug" }, { type: "fixed", value: 120 }],
      columns: [
        { type: "fixed", value: 180 },
        { type: "fill", value: 1 },
      ],
      itemsPositioning: "manual",
      sizing: { horizontal: "fixed", vertical: "hug" },
    },
  },
  {
    ...common,
    action: "set-layout-sizing",
    nodeId: "content",
    sizing: { horizontal: "fill", vertical: "fixed" },
  },
  {
    ...common,
    action: "set-layout-positioning",
    nodeId: "badge",
    positioning: "absolute",
    constraints: { horizontal: "right", vertical: "top" },
  },
  {
    ...common,
    action: "set-layout-limits",
    nodeId: "content",
    limits: { minWidth: 240, maxWidth: 960 },
  },
  {
    ...common,
    action: "set-layout-guides",
    frameId: "responsive_frame",
    layoutGuides: [
      {
        id: "desktop-columns",
        type: "columns",
        alignment: "stretch",
        count: 12,
        gutter: 24,
        margin: 80,
        color: "#FF00AA",
        opacity: 0.12,
      },
    ],
  },
  {
    ...common,
    action: "set-grid-placement",
    nodeId: "hero",
    placement: {
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
      horizontalAlign: "auto",
      verticalAlign: "center",
    },
  },
  {
    ...common,
    action: "reorder-grid-tracks",
    frameId: "frame_grid",
    axis: "rows",
    fromIndices: [2, 0, 2],
    insertionIndex: 3,
  },
];

describe("Arrange Agent contract", () => {
  it("uses one disclosed executable schema for all 21 action branches", () => {
    expect(DesignArrangeContract.schema).toBe(DESIGN_ARRANGE_TOOL_INPUT_SCHEMA);
    expect(DESIGN_ARRANGE_ACTIONS).toHaveLength(21);
    expect(inputs).toHaveLength(21);
    for (const input of inputs) {
      expect(
        schemaValidationIssues(DesignArrangeContract.schema, input),
        input.action,
      ).toEqual([]);
      expect(DesignArrangeContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
    const spec = DESIGN_AGENT_TOOL_SPECS.find(
      (candidate) => candidate.name === DESIGN_ARRANGE_TOOL_NAME,
    );
    expect(spec?.inputSchema).toBe(DesignArrangeContract.schema);
    expect(spec?.validateInputIssues).toBe(DesignArrangeContract.issues);
    expect(JSON.stringify(DESIGN_ARRANGE_TOOL_INPUT_SCHEMA)).not.toContain(
      '"oneOf"',
    );
  });

  it("reports action-specific missing and foreign fields", () => {
    expect(
      DesignArrangeContract.issues({
        action: "repair-overflow",
        label: "Reveal clipped content",
        pageId: "page_1",
        width: 999,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/frameId" }),
        expect.objectContaining({ path: "/width" }),
      ]),
    );
    expect(
      DesignArrangeContract.issues({
        action: "distribute-horizontal",
        label: "Distribute layers",
        pageId: "page_1",
        nodeIds: ["layer_a", "layer_b"],
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/nodeIds" })]),
    );
  });

  it("rejects zero Fill weights and invalid Grid spans at exact paths", () => {
    expect(
      DesignArrangeContract.issues({
        ...inputs.find((input) => input.action === "set-auto-layout"),
        autoLayout: {
          mode: "grid",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          rowGap: 0,
          columnGap: 0,
          rows: [{ type: "fill", value: 0 }],
          columns: [{ type: "fill", value: 1 }],
          itemsPositioning: "row-auto-flow",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/autoLayout/rows/0/value" }),
      ]),
    );
    expect(
      DesignArrangeContract.issues({
        ...inputs.find((input) => input.action === "set-grid-placement"),
        placement: {
          row: 0,
          column: 0,
          rowSpan: 0,
          columnSpan: 1,
          horizontalAlign: "auto",
          verticalAlign: "auto",
        },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/placement/rowSpan" }),
      ]),
    );
  });

  it("keeps cross-field Grid, limits, and guide rules in one refinement", () => {
    expect(
      DesignArrangeContract.issues({
        ...inputs.find((input) => input.action === "set-auto-layout"),
        autoLayout: {
          mode: "grid",
          padding: { top: 0, right: 0, bottom: 0, left: 0 },
          rowGap: 0,
          columnGap: 0,
          rows: [{ type: "fill", value: 1 }],
          columns: [{ type: "fill", value: 1 }],
          itemsPositioning: "manual",
          autoTracks: "rows",
        },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_arrange.grid_auto_tracks_requires_auto_flow",
        path: "/autoLayout/autoTracks",
      }),
    ]);
    expect(
      DesignArrangeContract.issues({
        ...inputs.find((input) => input.action === "set-layout-limits"),
        limits: { minWidth: 900, maxWidth: 240 },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_arrange.layout_limits_inverted",
        path: "/limits/maxWidth",
      }),
    ]);
    const guides = inputs.find((input) => input.action === "set-layout-guides");
    if (!guides || guides.action !== "set-layout-guides") {
      throw new Error("Layout Guides fixture is missing");
    }
    expect(
      DesignArrangeContract.issues({
        ...guides,
        layoutGuides: [guides.layoutGuides[0], guides.layoutGuides[0]],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_arrange.layout_guide_id_duplicated",
        path: "/layoutGuides/1/id",
      }),
    ]);
  });
});
