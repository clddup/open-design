import type { DesignTransaction } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
  normalizeDesignDocument,
  planSetFrameLayoutGuides,
} from "./index.js";

describe("layout guide operations", () => {
  it("persists uniform guides through one reversible transaction", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const plan = planSetFrameLayoutGuides(
      runtime.getSnapshot().document,
      "page_welcome",
      "frame_welcome",
      [
        {
          id: "grid_8",
          type: "grid",
          size: 8,
          color: "#ff5a5f",
          opacity: 0.12,
        },
      ],
      "guides",
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(runtime.apply(transaction(runtime, plan.commands))).toMatchObject({
      ok: true,
    });
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome,
    ).toMatchObject({
      properties: {
        layoutGuides: [
          {
            id: "grid_8",
            type: "grid",
            size: 8,
            color: "#ff5a5f",
            opacity: 0.12,
          },
        ],
      },
    });
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.properties,
    ).not.toHaveProperty("layoutGuides");
    expect(runtime.redo().ok).toBe(true);
    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.nodesById.frame_welcome?.properties).toMatchObject({
      layoutGuides: [{ id: "grid_8", size: 8 }],
    });
  });

  it("rejects duplicates, wrong targets, locked Frames, and no-op changes", () => {
    const document = structuredClone(createWelcomeDocument());
    const guide = {
      id: "grid_8",
      type: "grid" as const,
      size: 8,
      color: "#ff5a5f",
      opacity: 0.12,
    };
    expect(
      planSetFrameLayoutGuides(
        document,
        "page_welcome",
        "frame_welcome",
        [guide, guide],
        "duplicate",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planSetFrameLayoutGuides(
        document,
        "missing_page",
        "frame_welcome",
        [guide],
        "wrong_page",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    document.nodesById.frame_welcome!.locked = true;
    expect(
      planSetFrameLayoutGuides(
        document,
        "page_welcome",
        "frame_welcome",
        [guide],
        "locked",
      ),
    ).toMatchObject({ ok: false, code: "locked" });
  });

  it("rejects invalid values, more than eight guides, and excessive line density", () => {
    const document = createWelcomeDocument();
    const guide = {
      id: "grid_8",
      type: "grid" as const,
      size: 8,
      color: "#ff5a5f",
      opacity: 0.12,
    };
    expect(
      planSetFrameLayoutGuides(
        document,
        "page_welcome",
        "frame_welcome",
        Array.from({ length: 9 }, (_, index) => ({
          ...guide,
          id: `grid_${index}`,
        })),
        "too_many",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planSetFrameLayoutGuides(
        document,
        "page_welcome",
        "frame_welcome",
        [{ ...guide, opacity: Number.NaN }],
        "invalid_value",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    const denseDocument = structuredClone(document);
    const frame = denseDocument.nodesById.frame_welcome;
    if (!frame || frame.kind !== "frame") throw new Error("Missing frame");
    frame.size = { width: 4_097, height: 2 };
    expect(
      planSetFrameLayoutGuides(
        denseDocument,
        "page_welcome",
        "frame_welcome",
        [{ ...guide, size: 1 }],
        "too_dense",
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    frame.properties.layoutGuides = [{ ...guide, size: 1 }];
    expect(() => normalizeDesignDocument(denseDocument)).toThrow(
      "4096-line safety limit",
    );
  });
});

function transaction(
  runtime: EditorRuntime,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId: `layout_guides_${document.revision}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "layout-guide-test" },
    label: "Layout guides",
    commands,
  };
}
