import type { DesignOperation } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { OperationError } from "./operation-error.js";
import { applyPageCommand } from "./page-command-executor.js";

describe("page command executor", () => {
  it("owns the complete insert, rename, reorder, and delete mutation family", () => {
    const document = structuredClone(createWelcomeDocument());

    expect(
      applyPageCommand(document, {
        commandId: "insert_page",
        type: "insert_page",
        page: {
          id: "page_second",
          name: "Second page",
          rootNodeIds: [],
          extensions: {},
        },
        index: 1,
        nodes: [],
      }),
    ).toBe(true);
    expect(document.pageOrder).toEqual(["page_welcome", "page_second"]);

    expect(
      applyPageCommand(document, {
        commandId: "rename_page",
        type: "update_page",
        pageId: "page_second",
        name: "Renamed page",
      }),
    ).toBe(true);
    expect(document.pagesById.page_second?.name).toBe("Renamed page");

    expect(
      applyPageCommand(document, {
        commandId: "move_page",
        type: "move_page",
        pageId: "page_second",
        index: 0,
      }),
    ).toBe(true);
    expect(document.pageOrder).toEqual(["page_second", "page_welcome"]);

    expect(
      applyPageCommand(document, {
        commandId: "delete_page",
        type: "delete_page",
        pageId: "page_second",
      }),
    ).toBe(true);
    expect(document.pageOrder).toEqual(["page_welcome"]);
    expect(document.pagesById.page_second).toBeUndefined();
  });

  it("fails closed without partially inserting duplicate page nodes", () => {
    const document = structuredClone(createWelcomeDocument());
    const duplicateNode = structuredClone(document.nodesById.shape_accent!);

    expect(() =>
      applyPageCommand(document, {
        commandId: "insert_duplicate_nodes",
        type: "insert_page",
        page: {
          id: "page_invalid",
          name: "Invalid page",
          rootNodeIds: [duplicateNode.id],
          extensions: {},
        },
        index: 1,
        nodes: [duplicateNode],
      }),
    ).toThrowError(OperationError);
    expect(document.pageOrder).toEqual(["page_welcome"]);
    expect(document.pagesById.page_invalid).toBeUndefined();
  });

  it("declines commands owned by other executors", () => {
    const document = structuredClone(createWelcomeDocument());
    const command: DesignOperation = {
      commandId: "delete_asset",
      type: "delete_asset",
      assetId: "asset_missing",
    };

    expect(applyPageCommand(document, command)).toBe(false);
  });
});
