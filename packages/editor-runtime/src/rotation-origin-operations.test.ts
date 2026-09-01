import {
  migrateDesignDocument,
  type DesignTransaction,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
  getNodeBounds,
  getWorldTransform,
  planSetNodeRotationOrigin,
} from "./index.js";

describe("rotation origin operations", () => {
  it("persists one origin without changing current geometry and round-trips history", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const bounds = getNodeBounds(before, "title_welcome");
    const transform = getWorldTransform(before, "title_welcome");
    const plan = planSetNodeRotationOrigin(
      before,
      "page_welcome",
      "title_welcome",
      { x: 0.2, y: 0.8 },
      "origin",
    );
    if (!plan.ok) throw new Error(plan.message);
    const transaction: DesignTransaction = {
      transactionId: "set_rotation_origin",
      documentId: before.documentId,
      baseRevision: before.revision,
      actor: { type: "user", id: "rotation-origin-test" },
      label: "Set rotation origin",
      commands: plan.commands,
    };

    expect(runtime.apply(transaction).ok).toBe(true);
    const applied = runtime.getSnapshot();
    expect(applied.document.nodesById.title_welcome?.rotationOrigin).toEqual({
      x: 0.2,
      y: 0.8,
    });
    expect(getNodeBounds(applied.document, "title_welcome")).toEqual(bounds);
    expect(getWorldTransform(applied.document, "title_welcome")).toEqual(
      transform,
    );
    expect(applied.document.revision).toBe(1);
    expect(applied.state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.rotationOrigin,
    ).toBeUndefined();
    expect(runtime.redo().ok).toBe(true);
    expect(
      migrateDesignDocument(
        JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
      )?.nodesById.title_welcome?.rotationOrigin,
    ).toEqual({ x: 0.2, y: 0.8 });
  });

  it("canonicalizes the center to the implicit default", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.title_welcome!.rotationOrigin = { x: 0.1, y: 0.9 };
    const plan = planSetNodeRotationOrigin(
      document,
      "page_welcome",
      "title_welcome",
      { x: 0.5, y: 0.5 },
      "reset",
    );
    expect(plan).toMatchObject({
      ok: true,
      commands: [{ rotationOrigin: null }],
    });
  });

  it("rejects missing, foreign, locked, and unchanged targets", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.frame_welcome!.locked = true;
    expect(
      planSetNodeRotationOrigin(
        document,
        "page_welcome",
        "title_welcome",
        { x: 0, y: 0 },
        "locked",
      ),
    ).toMatchObject({ ok: false, code: "locked" });
    expect(
      planSetNodeRotationOrigin(
        document,
        "missing",
        "title_welcome",
        { x: 0, y: 0 },
        "page",
      ),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planSetNodeRotationOrigin(
        document,
        "page_welcome",
        "missing",
        { x: 0, y: 0 },
        "node",
      ),
    ).toMatchObject({ ok: false, code: "not-found" });

    document.nodesById.frame_welcome!.locked = false;
    const foreign = structuredClone(document.pagesById.page_welcome!);
    foreign.id = "page_foreign";
    foreign.rootNodeIds = [];
    document.pagesById.page_foreign = foreign;
    document.pageOrder.push("page_foreign");
    expect(
      planSetNodeRotationOrigin(
        document,
        "page_foreign",
        "title_welcome",
        { x: 0, y: 0 },
        "foreign",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planSetNodeRotationOrigin(
        document,
        "page_welcome",
        "title_welcome",
        null,
        "noop",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
  });
});
