import { describe, expect, it } from "vitest";
import {
  DESIGN_AGENT_TOOL_SPECS,
  DESIGN_APPLY_TOOL_NAME,
  DESIGN_CAPABILITIES_TOOL_NAME,
  DESIGN_HIERARCHY_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  validateDesignAgentToolInput,
} from "./design-agent-tools";

describe("design Agent tool contract", () => {
  it("exposes the trusted capability manifest as a read-only tool", () => {
    const capabilities = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_CAPABILITIES_TOOL_NAME,
    );

    expect(capabilities).toMatchObject({ risk: "read", approval: "never" });
    expect(capabilities?.description).toContain(
      "versioned OpenDesign professional design capability manifest",
    );
    expect(
      validateDesignAgentToolInput(DESIGN_CAPABILITIES_TOOL_NAME, {}),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_CAPABILITIES_TOOL_NAME, {
        capability: "pretend-supported",
      }),
    ).toBe(false);
  });

  it("exposes formal SVG path appearance semantics to the model", () => {
    const apply = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_APPLY_TOOL_NAME,
    );
    const schema = JSON.stringify(apply?.inputSchema);

    expect(apply?.description).toContain("portable SVG path data");
    expect(schema).toContain('"path"');
    expect(schema).toContain('"fillRule"');
    expect(schema).toContain('"fills"');
    expect(schema).toContain('"strokes"');
    expect(schema.length).toBeLessThan(64_000);
    expect(schema).not.toContain('"$ref"');
    expect(schema).not.toContain('"$defs"');
  });

  it("accepts a path node transaction and rejects non-path markup", () => {
    const input = {
      label: "Create mascot silhouette",
      commands: [
        {
          commandId: "insert_path",
          type: "insert_element",
          pageId: "page_1",
          parentId: null,
          index: 0,
          node: {
            id: "path_1",
            name: "Mascot silhouette",
            parentId: null,
            childIds: [],
            visible: true,
            locked: false,
            transform: [1, 0, 0, 1, 0, 0],
            size: { width: 120, height: 160 },
            opacity: 1,
            extensions: {},
            kind: "path",
            properties: {
              path: "M 60 2 C 102 4 118 48 108 104 C 100 146 82 158 60 158 C 38 158 20 146 12 104 C 2 48 18 4 60 2 Z",
              fills: [{ type: "solid", color: "#111827", opacity: 1 }],
              strokes: [],
              strokeWidth: 0,
            },
          },
        },
      ],
    };

    expect(validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input)).toBe(
      true,
    );
    expect(
      validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, {
        ...input,
        commands: [
          {
            ...input.commands[0],
            node: {
              ...input.commands[0]?.node,
              properties: {
                ...input.commands[0]?.node.properties,
                path: "<svg onload=bad()>",
              },
            },
          },
        ],
      }),
    ).toBe(false);
  });

  it("exposes bounded GPT Image 2 generation without a model override", () => {
    const generate = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === GENERATE_IMAGE_TOOL_NAME,
    );

    expect(generate?.description).toContain("application-wide");
    expect(JSON.stringify(generate?.inputSchema)).not.toContain("modelId");
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A luminous editorial penguin poster",
        size: "1536x1024",
        quality: "high",
        outputFormat: "webp",
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A poster",
        modelId: "conversation-model",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(GENERATE_IMAGE_TOOL_NAME, {
        prompt: "A poster",
        size: "8192x8192",
      }),
    ).toBe(false);
  });

  it("exposes strict semantic group and ungroup inputs without selection-derived targets", () => {
    const hierarchy = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === DESIGN_HIERARCHY_TOOL_NAME,
    );
    const group = {
      action: "group",
      label: "Group mascot layers",
      pageId: "page_1",
      nodeIds: ["body", "face", "scarf"],
      groupId: "mascot_group",
      name: "Mascot",
    };
    const ungroup = {
      action: "ungroup",
      label: "Ungroup mascot",
      pageId: "page_1",
      groupId: "mascot_group",
    };
    const reorder = {
      action: "reorder",
      label: "Bring mascot details forward",
      pageId: "page_1",
      nodeIds: ["face", "scarf"],
      order: "bring-forward",
    };
    const reparent = {
      action: "reparent",
      label: "Move mascot into poster",
      pageId: "page_1",
      nodeIds: ["mascot_group"],
      parentId: "poster_frame",
      index: 2,
    };

    expect(hierarchy).toMatchObject({
      risk: "design_write",
      approval: "never",
    });
    expect(hierarchy?.description).toContain("explicit stable node IDs");
    expect(hierarchy?.description).toContain("one atomic undoable");
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, group),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, ungroup),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, reorder),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, reparent),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        parentId: null,
        index: 0,
      }),
    ).toBe(true);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        nodeIds: ["body", "body"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        nodeIds: Array.from({ length: 250 }, (_, index) => `node_${index}`),
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...group,
        selectedNodeIds: ["different_live_selection"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...ungroup,
        nodeIds: ["body"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        order: "move-up-somehow",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        nodeIds: [],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reorder,
        groupId: "must_not_be_accepted",
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        nodeIds: ["mascot_group", "mascot_group"],
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        index: -1,
      }),
    ).toBe(false);
    expect(
      validateDesignAgentToolInput(DESIGN_HIERARCHY_TOOL_NAME, {
        ...reparent,
        groupId: "not_part_of_reparent",
      }),
    ).toBe(false);
  });
});
