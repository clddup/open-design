import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import { diffDocuments } from "./document-diff.js";

describe("document diff", () => {
  it("classifies semantic updates, z-order moves, pages, and assets", () => {
    const before = createWelcomeDocument();
    const after = structuredClone(before);
    after.revision = 1;
    after.nodesById.title_welcome!.name = "Renamed title";
    const children = after.nodesById.frame_welcome!.childIds;
    children.splice(0, 2, children[1]!, children[0]!);
    after.pagesById.page_welcome!.name = "Renamed page";
    after.assetsById.asset_photo = {
      id: "asset_photo",
      kind: "image",
      name: "Photo",
      mimeType: "image/png",
      source: { type: "data", value: "aW1hZ2U=" },
      size: { width: 640, height: 480 },
      extensions: {},
    };

    const result = diffDocuments(before, after, 1);

    expect(result).toMatchObject({
      documentId: before.documentId,
      fromRevision: 0,
      toRevision: 1,
      addedAssetIds: ["asset_photo"],
      changedPageIds: ["page_welcome"],
      pageChanges: [
        {
          type: "updated",
          pageId: "page_welcome",
          changedFields: ["name"],
        },
      ],
    });
    expect(result.changedNodeIds).toEqual(
      expect.arrayContaining([
        "frame_welcome",
        "shape_accent",
        "title_welcome",
      ]),
    );
    expect(result.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "updated",
          nodeId: "frame_welcome",
          changedFields: ["childIds"],
        }),
        expect.objectContaining({
          type: "moved",
          nodeId: "shape_accent",
          changedFields: ["zOrder"],
        }),
        expect.objectContaining({
          type: "moved",
          nodeId: "title_welcome",
          changedFields: ["name"],
        }),
      ]),
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(before.nodesById.title_welcome?.name).toBe("Title");
  });

  it("does not invent content changes from revision advancement", () => {
    const before = createWelcomeDocument();
    const after = structuredClone(before);
    after.revision = 7;

    const result = diffDocuments(before, after, 7);

    expect(result).toMatchObject({
      fromRevision: 0,
      toRevision: 7,
      addedNodeIds: [],
      changedNodeIds: [],
      removedNodeIds: [],
      addedPageIds: [],
      changedPageIds: [],
      removedPageIds: [],
      changes: [],
    });
  });
});
