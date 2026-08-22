import type { DesignOperation } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { applyElementCommand } from "./element-command-executor.js";

describe("element command executor", () => {
  it("owns property, hierarchy, and deletion mutations", () => {
    const document = structuredClone(createWelcomeDocument());
    const context = { warnings: [] };

    expect(
      applyElementCommand(
        document,
        {
          commandId: "rename_accent",
          type: "update_properties",
          nodeId: "shape_accent",
          name: "Brand accent",
        },
        context,
      ),
    ).toBe(true);
    expect(document.nodesById.shape_accent?.name).toBe("Brand accent");

    expect(
      applyElementCommand(
        document,
        {
          commandId: "move_accent",
          type: "move_element",
          pageId: "page_welcome",
          nodeId: "shape_accent",
          parentId: "feature_group",
          index: 0,
        },
        context,
      ),
    ).toBe(true);
    expect(document.nodesById.shape_accent?.parentId).toBe("feature_group");
    expect(document.nodesById.frame_welcome?.childIds).not.toContain(
      "shape_accent",
    );
    expect(document.nodesById.feature_group?.childIds[0]).toBe("shape_accent");

    expect(
      applyElementCommand(
        document,
        {
          commandId: "delete_accent",
          type: "delete_element",
          nodeId: "shape_accent",
        },
        context,
      ),
    ).toBe(true);
    expect(document.nodesById.shape_accent).toBeUndefined();
    expect(document.nodesById.feature_group?.childIds).not.toContain(
      "shape_accent",
    );
  });

  it("declines commands owned by other executors", () => {
    const document = structuredClone(createWelcomeDocument());
    const command: DesignOperation = {
      commandId: "update_page",
      type: "update_page",
      pageId: "page_welcome",
      name: "Renamed",
    };
    expect(applyElementCommand(document, command, { warnings: [] })).toBe(
      false,
    );
  });
});
