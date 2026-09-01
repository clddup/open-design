import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_EDIT_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_INPUT_SCHEMA,
  DESIGN_VECTOR_TOOL_NAME,
  DesignHierarchyContract,
  DesignVectorContract,
  type DesignHierarchyToolInput,
  type DesignVectorToolInput,
} from "./design-agent-tools";

const hierarchyInputs: DesignHierarchyToolInput[] = [
  {
    action: "group",
    label: "Group logo layers",
    pageId: "page_brand",
    nodeIds: ["logo_mark", "logo_wordmark"],
    groupId: "logo_lockup",
    name: "Logo lockup",
  },
  {
    action: "ungroup",
    label: "Release logo lockup",
    pageId: "page_brand",
    groupId: "logo_lockup",
  },
  {
    action: "create-mask",
    label: "Mask portrait",
    pageId: "page_brand",
    nodeIds: ["avatar_shape", "portrait"],
    groupId: "avatar_mask",
    name: "Avatar mask",
    maskType: "alpha",
  },
  {
    action: "set-mask-type",
    label: "Use vector mask",
    pageId: "page_brand",
    maskNodeId: "avatar_shape",
    maskType: "vector",
  },
  {
    action: "remove-mask",
    label: "Remove portrait mask",
    pageId: "page_brand",
    maskNodeId: "avatar_shape",
  },
  {
    action: "create-boolean",
    label: "Subtract logo aperture",
    pageId: "page_brand",
    nodeIds: ["logo_body", "logo_aperture"],
    booleanId: "logo_boolean",
    name: "Logo symbol",
    operation: "subtract",
  },
  {
    action: "set-boolean-operation",
    label: "Intersect logo geometry",
    pageId: "page_brand",
    booleanId: "logo_boolean",
    operation: "intersect",
  },
  {
    action: "ungroup-boolean",
    label: "Release logo geometry",
    pageId: "page_brand",
    booleanId: "logo_boolean",
  },
  {
    action: "reorder",
    label: "Bring logo mark forward",
    pageId: "page_brand",
    nodeIds: ["logo_mark"],
    order: "bring-to-front",
  },
  {
    action: "reparent",
    label: "Move logo into delivery frame",
    pageId: "page_brand",
    nodeIds: ["logo_lockup"],
    parentId: "logo_delivery",
    index: 1,
  },
];

const vectorInputs: DesignVectorToolInput[] = [
  {
    action: "outline-stroke",
    label: "Outline logo stroke",
    pageId: "page_brand",
    nodeId: "logo_path",
  },
  {
    action: "flatten",
    label: "Flatten logo geometry",
    pageId: "page_brand",
    nodeIds: ["logo_path", "logo_accent"],
  },
  {
    action: "set-closed",
    label: "Close logo contour",
    pageId: "page_brand",
    nodeId: "logo_path",
    pathId: "outer_path",
    closed: true,
  },
  {
    action: "bend-segment",
    label: "Bend logo contour",
    pageId: "page_brand",
    nodeId: "logo_path",
    pathId: "outer_path",
    point: { x: 72, y: 32 },
    segmentId: "segment_curve",
    t: 0.4,
  },
  {
    action: "set-region-fills",
    fills: [{ type: "solid", color: "#4f7fff", opacity: 1 }],
    label: "Paint logo face",
    nodeId: "logo_path",
    pageId: "page_brand",
    regionId: "region_face",
  },
  {
    action: "set-region-fill-style",
    fillStyleId: "brand-accent",
    label: "Use the brand accent Style",
    nodeId: "logo_path",
    pageId: "page_brand",
    regionId: "region_face",
  },
  {
    action: "set-vertex-stroke-appearance",
    label: "Round selected logo corners",
    nodeId: "logo_path",
    pageId: "page_brand",
    strokeCap: null,
    strokeJoin: "round",
    vertexIds: ["vertex_corner_a", "vertex_corner_b"],
  },
  {
    action: "set-vertex-corner-radius",
    cornerRadius: 12,
    label: "Round selected logo vertices",
    nodeId: "logo_path",
    pageId: "page_brand",
    vertexIds: ["vertex_corner_a", "vertex_corner_b"],
  },
  {
    action: "reverse-path",
    label: "Reverse logo contour",
    pageId: "page_brand",
    nodeId: "logo_path",
  },
  {
    action: "connect-endpoints",
    endpoints: [
      { nodeId: "logo_path", vertexId: "vertex_start" },
      { nodeId: "logo_shadow", vertexId: "vertex_end" },
    ],
    label: "Connect contour endpoints",
    pageId: "page_brand",
  },
  {
    action: "disconnect-vertex",
    label: "Break logo contour",
    pageId: "page_brand",
    nodeId: "logo_path",
    pathId: "outer_path",
    segmentId: "segment_branch",
    vertexId: "vertex_mid",
  },
  {
    action: "delete-segments",
    label: "Delete logo branch segment",
    pageId: "page_brand",
    nodeId: "logo_path",
    segmentIds: ["segment_branch"],
  },
  {
    action: "delete-vertices",
    label: "Delete logo junction",
    pageId: "page_brand",
    nodeId: "logo_path",
    vertexIds: ["vertex_mid"],
  },
  {
    action: "transform-vertices",
    label: "Scale logo vertices",
    pageId: "page_brand",
    nodeId: "logo_path",
    transform: [1.1, 0, 0, 1.1, -8, -8],
    vertexIds: ["vertex_start", "vertex_mid"],
  },
  {
    action: "transform-layers-vertices",
    label: "Scale logo and shadow vertices",
    pageId: "page_brand",
    targets: [
      { nodeId: "logo_path", vertexIds: ["vertex_start"] },
      { nodeId: "logo_shadow", vertexIds: ["shadow_start"] },
    ],
    transform: [1.1, 0, 0, 1.1, -8, -8],
  },
  {
    action: "cut-path",
    label: "Cut logo segment",
    pageId: "page_brand",
    nodeId: "logo_path",
    pathId: "outer_path",
    at: { kind: "segment", segmentId: "segment_curve", t: 0.4 },
  },
  {
    action: "cut-with-line",
    label: "Divide logo contour",
    pageId: "page_brand",
    nodeId: "logo_path",
    start: { x: -8, y: 48 },
    end: { x: 128, y: 48 },
  },
  {
    action: "cut-layers-with-line",
    label: "Divide logo layers",
    pageId: "page_brand",
    nodeIds: ["logo_path", "logo_shadow"],
    start: { x: 16, y: 240 },
    end: { x: 512, y: 240 },
  },
];

describe("Hierarchy and Vector Agent contracts", () => {
  it("uses one disclosed executable schema for every exercised action branch", () => {
    expect(DesignHierarchyContract.schema).toBe(
      DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA,
    );
    expect(DesignVectorContract.schema).toBe(DESIGN_VECTOR_TOOL_INPUT_SCHEMA);
    for (const input of hierarchyInputs) {
      expect(
        schemaValidationIssues(DesignHierarchyContract.schema, input),
        input.action,
      ).toEqual([]);
      expect(DesignHierarchyContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
    for (const input of vectorInputs) {
      expect(
        schemaValidationIssues(DesignVectorContract.schema, input),
        input.action,
      ).toEqual([]);
      expect(DesignVectorContract.parse(input)).toEqual({
        ok: true,
        value: input,
      });
    }
    expect(JSON.stringify(DESIGN_HIERARCHY_TOOL_INPUT_SCHEMA)).not.toContain(
      '"oneOf"',
    );
    expect(JSON.stringify(DESIGN_VECTOR_TOOL_INPUT_SCHEMA)).not.toContain(
      '"oneOf"',
    );
  });

  it("reports action-specific missing and foreign Hierarchy fields", () => {
    expect(
      DesignHierarchyContract.issues({
        action: "group",
        label: "Group logo",
        pageId: "page_brand",
        nodeIds: ["logo_mark", "logo_wordmark"],
        maskNodeId: "foreign_mask",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/groupId" }),
        expect.objectContaining({ path: "/name" }),
        expect.objectContaining({ path: "/maskNodeId" }),
      ]),
    );
  });

  it("follows the nested cut discriminant for accurate Vector paths", () => {
    const issues = DesignVectorContract.issues({
      action: "cut-path",
      label: "Cut logo",
      pageId: "page_brand",
      nodeId: "logo_path",
      pathId: "outer_path",
      at: { kind: "segment", segmentId: "segment_curve" },
    });
    expect(issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/at/t" })]),
    );
    expect(issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/at/vertexId" }),
      ]),
    );
    const unknown = DesignVectorContract.issues({
      action: "cut-path",
      label: "Cut logo",
      pageId: "page_brand",
      nodeId: "logo_path",
      pathId: "outer_path",
      at: { kind: "curve", segmentId: "segment_curve" },
    });
    expect(unknown).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/at/kind" })]),
    );
    expect(unknown.every((issue) => issue.path === "/at/kind")).toBe(true);
  });

  it("requires at least one vertex stroke appearance field", () => {
    expect(
      DesignVectorContract.issues({
        action: "set-vertex-stroke-appearance",
        label: "Update selected vertices",
        nodeId: "logo_path",
        pageId: "page_brand",
        vertexIds: ["vertex_corner_a"],
      }),
    ).toContainEqual(
      expect.objectContaining({
        code: "design_vector.vertex_stroke_patch_empty",
        path: "",
      }),
    );
  });

  it("rejects negative vertex corner radii at the shared schema boundary", () => {
    expect(
      DesignVectorContract.issues({
        action: "set-vertex-corner-radius",
        cornerRadius: -1,
        label: "Round selected vertices",
        nodeId: "logo_path",
        pageId: "page_brand",
        vertexIds: ["vertex_corner_a"],
      }),
    ).toContainEqual(expect.objectContaining({ path: "/cornerRadius" }));
  });

  it("rejects an identical endpoint pair at the shared schema boundary", () => {
    expect(
      DesignVectorContract.issues({
        action: "connect-endpoints",
        endpoints: [
          { nodeId: "logo_path", vertexId: "vertex_start" },
          { nodeId: "logo_path", vertexId: "vertex_start" },
        ],
        label: "Connect contour endpoints",
        pageId: "page_brand",
      }),
    ).toContainEqual(expect.objectContaining({ path: "/endpoints" }));
  });

  it("reuses the document topology ID grammar", () => {
    expect(
      DesignVectorContract.issues({
        action: "reverse-path",
        label: "Reverse logo",
        pageId: "page_brand",
        nodeId: "logo_path",
        pathId: "1 invalid path",
      }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "/pathId" })]),
    );
  });

  it("reports Bend fields through the disclosed discriminated branch", () => {
    expect(
      DesignVectorContract.issues({
        action: "bend-segment",
        label: "Bend logo",
        pageId: "page_brand",
        nodeId: "logo_path",
        pathId: "outer_path",
        point: { x: 72, y: "bad" },
        segmentId: "segment_curve",
        t: 1,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/point/y" }),
        expect.objectContaining({ path: "/t" }),
      ]),
    );
  });

  it("reports unknown actions without leaking candidate branches", () => {
    for (const contract of [DesignHierarchyContract, DesignVectorContract]) {
      const issues = contract.issues({
        action: "unsupported-vector-action",
        label: "Unsupported vector action",
        pageId: "page_brand",
      });
      expect(issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "/action" })]),
      );
      expect(issues.every((issue) => issue.path === "/action")).toBe(true);
    }
  });

  it("refines cross-layer target identity and total vertex budget once", () => {
    expect(
      DesignVectorContract.issues({
        action: "transform-layers-vertices",
        label: "Transform duplicate layer target",
        pageId: "page_brand",
        targets: [
          { nodeId: "logo_path", vertexIds: ["vertex_a"] },
          { nodeId: "logo_path", vertexIds: ["vertex_b"] },
        ],
        transform: [1, 0, 0, 1, 8, 8],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_vector.target_node_duplicated",
        path: "/targets/1/nodeId",
      }),
    ]);
    expect(
      DesignVectorContract.issues({
        action: "transform-layers-vertices",
        label: "Transform identical duplicate target",
        pageId: "page_brand",
        targets: [
          { nodeId: "logo_path", vertexIds: ["vertex_a"] },
          { nodeId: "logo_path", vertexIds: ["vertex_a"] },
        ],
        transform: [1, 0, 0, 1, 8, 8],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_vector.target_node_duplicated",
        path: "/targets/1/nodeId",
      }),
    ]);

    const first = Array.from({ length: 8_192 }, (_, index) => `a_${index}`);
    const second = Array.from({ length: 8_193 }, (_, index) => `b_${index}`);
    expect(
      DesignVectorContract.issues({
        action: "transform-layers-vertices",
        label: "Transform too many vertices",
        pageId: "page_brand",
        targets: [
          { nodeId: "logo_path", vertexIds: first },
          { nodeId: "logo_shadow", vertexIds: second },
        ],
        transform: [1, 0, 0, 1, 8, 8],
      }),
    ).toEqual([
      expect.objectContaining({
        code: "design_vector.vertex_budget_exceeded",
        path: "/targets",
      }),
    ]);
  });

  it("wires Pi validation to the same contracts", () => {
    const editDesign = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_EDIT_TOOL_NAME,
    );
    const vector = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_VECTOR_TOOL_NAME,
    );
    expect(editDesign?.description).toContain("Hierarchy edits support");
    expect(vector).toHaveProperty(
      "validateInputIssues",
      DesignVectorContract.issues,
    );
  });
});
