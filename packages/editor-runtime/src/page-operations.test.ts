import type { DesignTransaction } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createWelcomeDocument,
  defaultPageName,
  planCreatePage,
  planDeletePage,
  planDuplicatePage,
  planRenamePage,
  planReorderPage,
} from "./index.js";

function applyPlan(
  runtime: EditorRuntime,
  transactionId: string,
  commands: DesignTransaction["commands"],
) {
  const document = runtime.getSnapshot().document;
  return runtime.apply({
    transactionId,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "local-user" },
    label: transactionId,
    commands,
  });
}

describe("Page operations", () => {
  it("uses locale-neutral canonical default Page names", () => {
    expect(defaultPageName(1)).toBe("Page 1");
    expect(defaultPageName(12)).toBe("Page 12");
    expect(() => defaultPageName(0)).toThrow(
      "Page number must be a positive safe integer",
    );
  });

  it("creates and names an empty Page as one undoable revision", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const plan = planCreatePage(runtime.getSnapshot().document, {
      pageId: "page_notes",
      name: "  Notes  ",
      commandPrefix: "page_notes",
    });
    if (!plan.ok) throw new Error(plan.message);

    const preview = runtime.preview({
      transactionId: "preview_create_page",
      documentId: runtime.getSnapshot().document.documentId,
      baseRevision: 0,
      actor: { type: "user", id: "local-user" },
      commands: plan.commands,
    });
    const applied = applyPlan(runtime, "create_page", plan.commands);

    expect(preview.ok && preview.changes.addedPageIds).toEqual(["page_notes"]);
    expect(applied.ok && applied.changes.addedPageIds).toEqual(["page_notes"]);
    expect(runtime.getSnapshot().document.pagesById.page_notes?.name).toBe(
      "Notes",
    );
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.pagesById.page_notes).toBeUndefined();
    expect(runtime.redo().ok).toBe(true);
    expect(runtime.getSnapshot().document.pageOrder).toContain("page_notes");
  });

  it("renames Pages without requiring unique names", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const create = planCreatePage(runtime.getSnapshot().document, {
      pageId: "page_second",
      name: "Second",
      commandPrefix: "create_second",
    });
    if (!create.ok) throw new Error(create.message);
    applyPlan(runtime, "create_second", create.commands);

    const rename = planRenamePage(runtime.getSnapshot().document, {
      pageId: "page_second",
      name: "Welcome",
      commandPrefix: "rename_second",
    });
    if (!rename.ok) throw new Error(rename.message);
    const result = applyPlan(runtime, "rename_second", rename.commands);

    expect(result.ok && result.changes.changedPageIds).toEqual(["page_second"]);
    expect(result.ok && result.changes.pageChanges?.[0]).toMatchObject({
      type: "updated",
      pageId: "page_second",
      changedFields: ["name"],
    });
    expect(runtime.getSnapshot().document.pagesById.page_second?.name).toBe(
      "Welcome",
    );
  });

  it("duplicates a complete Page tree with remapped nodes and shared assets", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const plan = planDuplicatePage(before, {
      pageId: "page_welcome",
      duplicatePageId: "page_welcome_copy",
      commandPrefix: "duplicate_welcome",
      createNodeId: (sourceNodeId) => `copy_${sourceNodeId}`,
    });
    if (!plan.ok) throw new Error(plan.message);
    const result = applyPlan(runtime, "duplicate_welcome", plan.commands);
    const after = runtime.getSnapshot().document;

    expect(result.ok).toBe(true);
    expect(after.pagesById.page_welcome_copy).toMatchObject({
      name: "Copy of Welcome",
      rootNodeIds: ["copy_frame_welcome"],
    });
    expect(after.nodesById.copy_frame_welcome?.childIds).toEqual(
      before.nodesById.frame_welcome?.childIds.map((id) => `copy_${id}`),
    );
    expect(after.nodesById.copy_title_welcome?.parentId).toBe(
      "copy_frame_welcome",
    );
    expect(after.assetsById).toEqual(before.assetsById);
  });

  it("uses final indexes when reordering Pages", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    for (const [index, pageId] of ["page_two", "page_three"].entries()) {
      const plan = planCreatePage(runtime.getSnapshot().document, {
        pageId,
        name: `Page ${index + 2}`,
        commandPrefix: pageId,
      });
      if (!plan.ok) throw new Error(plan.message);
      applyPlan(runtime, `create_${pageId}`, plan.commands);
    }
    const plan = planReorderPage(runtime.getSnapshot().document, {
      pageId: "page_welcome",
      index: 2,
      commandPrefix: "move_welcome",
    });
    if (!plan.ok) throw new Error(plan.message);
    const result = applyPlan(runtime, "move_welcome", plan.commands);

    expect(runtime.getSnapshot().document.pageOrder).toEqual([
      "page_two",
      "page_three",
      "page_welcome",
    ]);
    expect(result.ok && result.changes.pageChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "moved",
          pageId: "page_welcome",
          changedFields: ["pageOrder"],
        }),
      ]),
    );
  });

  it("deletes a Page subtree, keeps assets, and refuses the final Page", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const create = planCreatePage(runtime.getSnapshot().document, {
      pageId: "page_empty",
      name: "Empty",
      commandPrefix: "create_empty",
    });
    if (!create.ok) throw new Error(create.message);
    applyPlan(runtime, "create_empty", create.commands);
    const removeWelcome = planDeletePage(runtime.getSnapshot().document, {
      pageId: "page_welcome",
      commandPrefix: "delete_welcome",
    });
    if (!removeWelcome.ok) throw new Error(removeWelcome.message);
    const result = applyPlan(runtime, "delete_welcome", removeWelcome.commands);

    expect(result.ok && result.changes.removedPageIds).toEqual([
      "page_welcome",
    ]);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.pageOrder).toEqual(["page_empty"]);
    expect(
      planDeletePage(runtime.getSnapshot().document, {
        pageId: "page_empty",
        commandPrefix: "delete_empty",
      }),
    ).toMatchObject({ ok: false, code: "last-page" });
    expect(
      applyPlan(runtime, "force_delete_empty", [
        {
          commandId: "force_delete_empty",
          type: "delete_page",
          pageId: "page_empty",
        },
      ]),
    ).toMatchObject({ ok: false, error: { code: "invalid" } });
  });

  it("rejects malformed Page trees and unnormalized names atomically", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const malformed = applyPlan(runtime, "malformed_page", [
      {
        commandId: "malformed_page",
        type: "insert_page",
        index: 1,
        page: {
          id: "page_bad",
          name: "Bad",
          rootNodeIds: ["missing_node"],
          extensions: {},
        },
        nodes: [],
      },
    ]);
    const unnormalized = applyPlan(runtime, "unnormalized_page", [
      {
        commandId: "unnormalized_page",
        type: "insert_page",
        index: 1,
        page: {
          id: "page_spaces",
          name: " Spaces ",
          rootNodeIds: [],
          extensions: {},
        },
        nodes: [],
      },
    ]);

    expect(malformed).toMatchObject({ ok: false, error: { code: "invalid" } });
    expect(unnormalized).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });
});
