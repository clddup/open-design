import { describe, expect, it } from "vitest";
import { createWelcomeDocument } from "./document.js";
import {
  planRenameLayers,
  previewLayerRenames,
} from "./layer-rename-operations.js";
import { EditorRuntime } from "./runtime.js";

describe("layer rename operations", () => {
  it("builds stable ascending and descending previews", () => {
    expect(
      previewLayerRenames(
        [
          { id: "a", name: "Card" },
          { id: "b", name: "Card" },
          { id: "c", name: "Card" },
        ],
        {
          match: "",
          renameTo: "{name} {n}-{N}",
          useRegularExpression: false,
        },
      ),
    ).toEqual({
      ok: true,
      preview: [
        { id: "a", name: "Card", nextName: "Card 1-3" },
        { id: "b", name: "Card", nextName: "Card 2-2" },
        { id: "c", name: "Card", nextName: "Card 3-1" },
      ],
    });
  });

  it("supports literal and regular-expression match replacement", () => {
    expect(
      previewLayerRenames([{ id: "a", name: "Card.12" }], {
        match: ".",
        renameTo: "-",
        useRegularExpression: false,
      }),
    ).toMatchObject({
      ok: true,
      preview: [{ nextName: "Card-12" }],
    });
    expect(
      previewLayerRenames([{ id: "a", name: "Card.12" }], {
        match: "(\\d+)",
        renameTo: "Item $1",
        useRegularExpression: true,
      }),
    ).toMatchObject({
      ok: true,
      preview: [{ nextName: "Card.Item 12" }],
    });
  });

  it("rejects invalid expressions, empty output, and unchanged requests", () => {
    expect(
      previewLayerRenames([{ id: "a", name: "Card" }], {
        match: "(",
        renameTo: "Item",
        useRegularExpression: true,
      }),
    ).toMatchObject({ ok: false, code: "invalid-regular-expression" });
    expect(
      previewLayerRenames([{ id: "a", name: "Card" }], {
        match: "",
        renameTo: "",
        useRegularExpression: false,
      }),
    ).toMatchObject({ ok: false, code: "empty-name" });
    expect(
      planRenameLayers(
        createWelcomeDocument(),
        "page_welcome",
        ["frame_welcome"],
        {
          match: "",
          renameTo: "Welcome canvas",
          useRegularExpression: false,
        },
        "rename",
      ),
    ).toMatchObject({ ok: false, code: "no-op" });
  });

  it("commits multiple names as one revision and one undo entry", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot();
    const plan = planRenameLayers(
      before.document,
      "page_welcome",
      ["feature_group", "feature_two"],
      { match: "", renameTo: "Feature {n}", useRegularExpression: false },
      "rename_features",
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const applied = runtime.apply({
      actor: { type: "user", id: "rename-test" },
      transactionId: "rename_features",
      label: "Rename layers",
      baseRevision: before.document.revision,
      documentId: before.document.documentId,
      commands: plan.commands,
    });
    expect(applied.ok).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(
      before.document.revision + 1,
    );
    expect(runtime.getSnapshot().document.nodesById.feature_group?.name).toBe(
      "Feature 1",
    );
    expect(runtime.getSnapshot().document.nodesById.feature_two?.name).toBe(
      "Feature 2",
    );
    runtime.undo();
    expect(runtime.getSnapshot().document.nodesById.feature_group?.name).toBe(
      before.document.nodesById.feature_group?.name,
    );
  });
});
