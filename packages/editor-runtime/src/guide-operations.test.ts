import type { DesignTransaction } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
  normalizeDesignDocument,
  planEditGuide,
  planSetGuides,
} from "./index.js";

describe("ruler guide operations", () => {
  it("persists Page and Frame guides with one undoable transaction", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const pagePlan = planSetGuides(
      runtime.getSnapshot().document,
      { type: "page", pageId: "page_welcome" },
      [{ axis: "X", offset: 120 }],
      "page",
    );
    if (!pagePlan.ok) throw new Error(pagePlan.message);
    expect(
      runtime.apply(transaction(runtime, pagePlan.commands)),
    ).toMatchObject({
      ok: true,
    });

    const framePlan = planSetGuides(
      runtime.getSnapshot().document,
      {
        type: "frame",
        pageId: "page_welcome",
        frameId: "frame_welcome",
      },
      [{ axis: "Y", offset: 32 }],
      "frame",
    );
    if (!framePlan.ok) throw new Error(framePlan.message);
    expect(
      runtime.apply(transaction(runtime, framePlan.commands)),
    ).toMatchObject({
      ok: true,
    });

    expect(
      runtime.getSnapshot().document.pagesById.page_welcome?.guides,
    ).toEqual([{ axis: "X", offset: 120 }]);
    const savedFrame = runtime.getSnapshot().document.nodesById.frame_welcome;
    expect(
      savedFrame?.kind === "frame" ? savedFrame.properties.guides : undefined,
    ).toEqual([{ axis: "Y", offset: 32 }]);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    ).not.toHaveProperty("properties.guides");
    expect(runtime.redo().ok).toBe(true);
    expect(
      normalizeDesignDocument(
        JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
      ).pagesById.page_welcome?.guides,
    ).toEqual([{ axis: "X", offset: 120 }]);
  });

  it("moves, copies, and removes guides across Page and Frame owners", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const initial = planSetGuides(
      runtime.getSnapshot().document,
      { type: "page", pageId: "page_welcome" },
      [{ axis: "X", offset: 120 }],
      "initial",
    );
    if (!initial.ok) throw new Error(initial.message);
    runtime.apply(transaction(runtime, initial.commands));

    const move = planEditGuide(
      runtime.getSnapshot().document,
      {
        duplicate: false,
        source: {
          guide: { axis: "X", offset: 120 },
          index: 0,
          owner: { type: "page", pageId: "page_welcome" },
        },
        target: {
          guide: { axis: "X", offset: 24 },
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
      },
      "move",
    );
    if (!move.ok) throw new Error(move.message);
    expect(runtime.apply(transaction(runtime, move.commands))).toMatchObject({
      ok: true,
    });
    expect(
      runtime.getSnapshot().document.pagesById.page_welcome?.guides,
    ).toEqual([]);

    const copy = planEditGuide(
      runtime.getSnapshot().document,
      {
        duplicate: true,
        source: {
          guide: { axis: "X", offset: 24 },
          index: 0,
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
        target: {
          guide: { axis: "X", offset: 64 },
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
      },
      "copy",
    );
    if (!copy.ok) throw new Error(copy.message);
    runtime.apply(transaction(runtime, copy.commands));
    const frame = runtime.getSnapshot().document.nodesById.frame_welcome;
    expect(
      frame?.kind === "frame" ? frame.properties.guides : undefined,
    ).toEqual([
      { axis: "X", offset: 24 },
      { axis: "X", offset: 64 },
    ]);

    const remove = planEditGuide(
      runtime.getSnapshot().document,
      {
        duplicate: false,
        source: {
          guide: { axis: "X", offset: 24 },
          index: 0,
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
      },
      "remove",
    );
    if (!remove.ok) throw new Error(remove.message);
    runtime.apply(transaction(runtime, remove.commands));
    const current = runtime.getSnapshot().document.nodesById.frame_welcome;
    expect(
      current?.kind === "frame" ? current.properties.guides : undefined,
    ).toEqual([{ axis: "X", offset: 64 }]);
  });

  it("rejects stale and locked Frame edits before producing commands", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    frame.properties.guides = [{ axis: "Y", offset: 20 }];
    expect(
      planEditGuide(
        document,
        {
          duplicate: false,
          source: {
            guide: { axis: "Y", offset: 21 },
            index: 0,
            owner: {
              type: "frame",
              pageId: "page_welcome",
              frameId: frame.id,
            },
          },
        },
        "stale",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    frame.locked = true;
    expect(
      planSetGuides(
        document,
        { type: "frame", pageId: "page_welcome", frameId: frame.id },
        [],
        "locked",
      ),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("preserves same-owner order and never emits a partial cross-owner move", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome!.guides = [
      { axis: "X", offset: 10 },
      { axis: "X", offset: 20 },
      { axis: "X", offset: 30 },
    ];
    const move = planEditGuide(
      document,
      {
        duplicate: false,
        source: {
          guide: { axis: "X", offset: 20 },
          index: 1,
          owner: { type: "page", pageId: "page_welcome" },
        },
        target: {
          guide: { axis: "X", offset: 24 },
          owner: { type: "page", pageId: "page_welcome" },
        },
      },
      "same_owner",
    );
    expect(move).toMatchObject({
      ok: true,
      commands: [
        {
          guides: [
            { axis: "X", offset: 10 },
            { axis: "X", offset: 24 },
            { axis: "X", offset: 30 },
          ],
        },
      ],
    });

    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    frame.locked = true;
    expect(
      planEditGuide(
        document,
        {
          duplicate: false,
          source: {
            guide: { axis: "X", offset: 10 },
            index: 0,
            owner: { type: "page", pageId: "page_welcome" },
          },
          target: {
            guide: { axis: "Y", offset: 24 },
            owner: {
              type: "frame",
              pageId: "page_welcome",
              frameId: frame.id,
            },
          },
        },
        "locked_target",
      ),
    ).toEqual({
      ok: false,
      code: "locked",
      message: "Locked Frames cannot change ruler guides",
    });
    expect(document.pagesById.page_welcome?.guides).toEqual([
      { axis: "X", offset: 10 },
      { axis: "X", offset: 20 },
      { axis: "X", offset: 30 },
    ]);
  });
});

function transaction(
  runtime: EditorRuntime,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId: `guides_${document.revision}_${crypto.randomUUID()}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "guide-test" },
    label: "Ruler guides",
    commands,
  };
}
