import { describe, expect, it } from "vitest";
import { applyCommand } from "./command-executor.js";
import { createWelcomeDocument } from "./document.js";

describe("command executor", () => {
  it("routes different command families through one mutation entry", () => {
    const document = structuredClone(createWelcomeDocument());
    const context = { warnings: [] };

    applyCommand(
      document,
      {
        commandId: "rename_page",
        type: "update_page",
        pageId: "page_welcome",
        name: "Design",
      },
      context,
    );
    applyCommand(
      document,
      {
        commandId: "rename_node",
        type: "update_properties",
        nodeId: "shape_accent",
        name: "Accent",
      },
      context,
    );
    applyCommand(
      document,
      {
        commandId: "put_asset",
        type: "put_asset",
        asset: {
          id: "asset_logo",
          kind: "image",
          name: "Logo",
          mimeType: "image/png",
          source: { type: "data", value: "bG9nbw==" },
          size: { width: 128, height: 128 },
          extensions: {},
        },
      },
      context,
    );

    expect(document.pagesById.page_welcome?.name).toBe("Design");
    expect(document.nodesById.shape_accent?.name).toBe("Accent");
    expect(document.assetsById.asset_logo?.name).toBe("Logo");
  });
});
