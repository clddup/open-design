import type {
  DesignDocument,
  DesignTransaction,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  canGroupNodes,
  canReorderNodes,
  canUngroupNode,
  createWelcomeDocument,
  getWorldTransform,
  normalizeDesignDocument,
  planGroupNodes,
  planReparentNodes,
  planReorderNodes,
  planUngroupNode,
} from "./index.js";

function transaction(
  runtime: EditorRuntime,
  transactionId: string,
  commands: DesignTransaction["commands"],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "layer-operation-test" },
    label: transactionId,
    commands,
  };
}

function expectTransformClose(
  actual: readonly number[] | null,
  expected: readonly number[] | null,
) {
  expect(actual).not.toBeNull();
  expect(expected).not.toBeNull();
  expected?.forEach((value, index) =>
    expect(actual?.[index]).toBeCloseTo(value, 10),
  );
}

function transformedWelcomeDocument(): DesignDocument {
  const document = structuredClone(createWelcomeDocument());
  document.nodesById.frame_welcome!.transform = [
    0.8660254, 0.5, -0.5, 0.8660254, 120, 72,
  ];
  document.nodesById.title_welcome!.transform = [1.2, 0.1, -0.2, 0.9, 64, 108];
  document.nodesById.subtitle_welcome!.transform = [
    0.75, -0.3, 0.25, 1.1, 68, 210,
  ];
  return normalizeDesignDocument(document);
}

describe("layer hierarchy operations", () => {
  it("groups transformed siblings without changing their world transforms", () => {
    const runtime = new EditorRuntime(transformedWelcomeDocument());
    const beforeTitle = getWorldTransform(
      runtime.getSnapshot().document,
      "title_welcome",
    );
    const beforeSubtitle = getWorldTransform(
      runtime.getSnapshot().document,
      "subtitle_welcome",
    );
    const plan = planGroupNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["subtitle_welcome", "title_welcome"],
      {
        groupId: "group_copy",
        name: "Copy lockup",
        commandPrefix: "group_copy",
      },
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      runtime.apply(
        transaction(runtime, "group_copy_transaction", plan.commands),
      ).ok,
    ).toBe(true);

    const grouped = runtime.getSnapshot();
    expect(grouped.document.nodesById.group_copy).toMatchObject({
      kind: "group",
      name: "Copy lockup",
      parentId: "frame_welcome",
      childIds: ["title_welcome", "subtitle_welcome"],
    });
    expect(grouped.document.nodesById.frame_welcome?.childIds).toEqual([
      "shape_accent",
      "group_copy",
      "feature_group",
    ]);
    expectTransformClose(
      getWorldTransform(grouped.document, "title_welcome"),
      beforeTitle,
    );
    expectTransformClose(
      getWorldTransform(grouped.document, "subtitle_welcome"),
      beforeSubtitle,
    );
    expect(grouped.state.selection.nodeIds).toEqual([]);
  });

  it("round-trips grouping through persistence, undo, and redo", () => {
    const runtime = new EditorRuntime(transformedWelcomeDocument());
    const plan = planGroupNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["title_welcome", "subtitle_welcome"],
      {
        groupId: "group_round_trip",
        name: "Round trip",
        commandPrefix: "group_round_trip",
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "group_round_trip", plan.commands)).ok,
    ).toBe(true);

    const reopened = normalizeDesignDocument(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
    );
    expect(reopened.nodesById.group_round_trip?.childIds).toEqual([
      "title_welcome",
      "subtitle_welcome",
    ]);

    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.group_round_trip,
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
    ]);

    expect(runtime.redo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.group_round_trip?.childIds,
    ).toEqual(["title_welcome", "subtitle_welcome"]);
    expect(runtime.getSnapshot().state.history.undo).toHaveLength(1);
  });

  it("ungroups a transformed Group in place and preserves child order", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.feature_group!.transform = [
      0.8, 0.25, -0.15, 1.1, 64, 340,
    ];
    const runtime = new EditorRuntime(document);
    const childIds = ["feature_one", "feature_two", "feature_three"];
    const before = Object.fromEntries(
      childIds.map((nodeId) => [
        nodeId,
        getWorldTransform(runtime.getSnapshot().document, nodeId),
      ]),
    );
    const plan = planUngroupNode(
      runtime.getSnapshot().document,
      "page_welcome",
      "feature_group",
      "ungroup_features",
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(
      runtime.apply(
        transaction(runtime, "ungroup_features_transaction", plan.commands),
      ).ok,
    ).toBe(true);

    const ungrouped = runtime.getSnapshot().document;
    expect(ungrouped.nodesById.feature_group).toBeUndefined();
    expect(ungrouped.nodesById.frame_welcome?.childIds).toEqual([
      "shape_accent",
      "title_welcome",
      "subtitle_welcome",
      "feature_one",
      "feature_two",
      "feature_three",
    ]);
    childIds.forEach((nodeId) => {
      expect(ungrouped.nodesById[nodeId]?.parentId).toBe("frame_welcome");
      expectTransformClose(
        getWorldTransform(ungrouped, nodeId),
        before[nodeId]!,
      );
    });

    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.feature_group?.childIds,
    ).toEqual(childIds);
    expect(runtime.redo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.feature_group,
    ).toBeUndefined();
  });

  it("rejects ambiguous, locked, cross-page, and visually lossy changes", () => {
    const document = transformedWelcomeDocument();
    expect(
      planGroupNodes(
        document,
        "page_welcome",
        ["title_welcome", "feature_one"],
        {
          groupId: "mixed_group",
          name: "Mixed",
          commandPrefix: "mixed_group",
        },
      ),
    ).toMatchObject({ ok: false, code: "mixed-parent" });
    expect(
      planGroupNodes(
        document,
        "page_welcome",
        ["title_welcome", "missing_node"],
        {
          groupId: "missing_group",
          name: "Missing",
          commandPrefix: "missing_group",
        },
      ),
    ).toMatchObject({ ok: false, code: "not-found" });

    const locked = structuredClone(document);
    locked.nodesById.frame_welcome!.locked = true;
    expect(
      planGroupNodes(
        locked,
        "page_welcome",
        ["title_welcome", "subtitle_welcome"],
        {
          groupId: "locked_group",
          name: "Locked",
          commandPrefix: "locked_group",
        },
      ),
    ).toMatchObject({ ok: false, code: "locked" });

    const otherPage = structuredClone(document);
    otherPage.pageOrder.push("page_other");
    otherPage.pagesById.page_other = {
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
      extensions: {},
    };
    expect(
      canGroupNodes(otherPage, "page_other", [
        "title_welcome",
        "subtitle_welcome",
      ]),
    ).toBe(false);

    const lossy = structuredClone(document);
    lossy.nodesById.feature_group!.opacity = 0.5;
    expect(
      planUngroupNode(lossy, "page_welcome", "feature_group", "ungroup_lossy"),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });

    const empty = structuredClone(document);
    empty.nodesById.feature_group!.childIds = [];
    delete empty.nodesById.feature_one;
    delete empty.nodesById.feature_two;
    delete empty.nodesById.feature_three;
    const normalizedEmpty = normalizeDesignDocument(empty);
    expect(
      canUngroupNode(normalizedEmpty, "page_welcome", ["feature_group"]),
    ).toBe(false);
  });

  it("checks eligibility without reserving a hidden preview node id", () => {
    const document = structuredClone(createWelcomeDocument());
    const previewId = "__opendesign_group_preview__";
    const title = document.nodesById.title_welcome!;
    delete document.nodesById.title_welcome;
    title.id = previewId;
    document.nodesById[previewId] = title;
    const frame = document.nodesById.frame_welcome!;
    frame.childIds = frame.childIds.map((nodeId) =>
      nodeId === "title_welcome" ? previewId : nodeId,
    );
    const normalized = normalizeDesignDocument(document);

    expect(
      canGroupNodes(normalized, "page_welcome", [
        previewId,
        "subtitle_welcome",
      ]),
    ).toBe(true);
  });

  it("returns an explicit limit instead of creating an invalid transaction", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome!;
    const template = document.nodesById.shape_accent!;
    const childIds = Array.from(
      { length: 250 },
      (_, index) => `layer_${index}`,
    );
    frame.childIds = childIds;
    document.nodesById = {
      frame_welcome: frame,
      ...Object.fromEntries(
        childIds.map((nodeId, index) => [
          nodeId,
          {
            ...structuredClone(template),
            id: nodeId,
            name: nodeId,
            transform: [1, 0, 0, 1, index * 2, 0],
          },
        ]),
      ),
    };
    const normalized = normalizeDesignDocument(document);
    const plan = planGroupNodes(normalized, "page_welcome", childIds, {
      groupId: "too_large_group",
      name: "Too large",
      commandPrefix: "too_large_group",
    });

    expect(plan).toMatchObject({ ok: false, code: "operation-limit" });
    expect(canGroupNodes(normalized, "page_welcome", childIds)).toBe(false);
  });

  it("moves one or more sibling layers through the four standard stacking actions", () => {
    const applyOrder = (
      nodeIds: readonly string[],
      action:
        "bring-forward" | "bring-to-front" | "send-backward" | "send-to-back",
    ) => {
      const runtime = new EditorRuntime(createWelcomeDocument());
      const plan = planReorderNodes(
        runtime.getSnapshot().document,
        "page_welcome",
        nodeIds,
        action,
        action,
      );
      expect(plan.ok).toBe(true);
      if (!plan.ok) throw new Error(plan.message);
      expect(
        runtime.apply(
          transaction(runtime, `transaction_${action}`, plan.commands),
        ).ok,
      ).toBe(true);
      return runtime;
    };

    expect(
      applyOrder(["title_welcome"], "bring-forward").getSnapshot().document
        .nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "subtitle_welcome",
      "title_welcome",
      "feature_group",
    ]);
    expect(
      applyOrder(
        ["shape_accent", "subtitle_welcome"],
        "bring-to-front",
      ).getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "title_welcome",
      "feature_group",
      "shape_accent",
      "subtitle_welcome",
    ]);
    expect(
      applyOrder(["subtitle_welcome"], "send-backward").getSnapshot().document
        .nodesById.frame_welcome?.childIds,
    ).toEqual([
      "shape_accent",
      "subtitle_welcome",
      "title_welcome",
      "feature_group",
    ]);
    expect(
      applyOrder(
        ["title_welcome", "feature_group"],
        "send-to-back",
      ).getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual([
      "title_welcome",
      "feature_group",
      "shape_accent",
      "subtitle_welcome",
    ]);
  });

  it("keeps order edits atomic, preserves transforms and selection, and round-trips undo/redo", () => {
    const runtime = new EditorRuntime(transformedWelcomeDocument());
    runtime.setSelection(
      ["title_welcome", "subtitle_welcome"],
      "subtitle_welcome",
    );
    const before = runtime.getSnapshot();
    const transforms = Object.fromEntries(
      before.state.selection.nodeIds.map((nodeId) => [
        nodeId,
        getWorldTransform(before.document, nodeId),
      ]),
    );
    const plan = planReorderNodes(
      before.document,
      "page_welcome",
      before.state.selection.nodeIds,
      "bring-to-front",
      "bring_copy_to_front",
    );
    if (!plan.ok) throw new Error(plan.message);

    expect(
      runtime.apply(transaction(runtime, "bring_copy_to_front", plan.commands))
        .ok,
    ).toBe(true);
    const reordered = runtime.getSnapshot();
    expect(reordered.document.nodesById.frame_welcome?.childIds).toEqual([
      "shape_accent",
      "feature_group",
      "title_welcome",
      "subtitle_welcome",
    ]);
    expect(reordered.state.selection).toEqual(before.state.selection);
    for (const nodeId of before.state.selection.nodeIds) {
      const expectedTransform = transforms[nodeId];
      if (!expectedTransform)
        throw new Error(`Missing transform for ${nodeId}`);
      expectTransformClose(
        getWorldTransform(reordered.document, nodeId),
        expectedTransform,
      );
    }
    expect(reordered.state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual(before.document.nodesById.frame_welcome?.childIds);
    expect(runtime.redo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.frame_welcome?.childIds,
    ).toEqual(reordered.document.nodesById.frame_welcome?.childIds);
  });

  it("reparents layers across containers while preserving every affected child world transform", () => {
    const runtime = new EditorRuntime(transformedWelcomeDocument());
    runtime.setSelection(["feature_one"], "feature_one");
    const before = runtime.getSnapshot();
    const trackedIds = ["feature_one", "feature_two", "feature_three"];
    const worldTransforms = Object.fromEntries(
      trackedIds.map((nodeId) => [
        nodeId,
        getWorldTransform(before.document, nodeId),
      ]),
    );
    const plan = planReparentNodes(
      before.document,
      "page_welcome",
      ["feature_one"],
      {
        parentId: "frame_welcome",
        index: 1,
        commandPrefix: "move_feature_out",
      },
    );

    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "move_feature_out", plan.commands)).ok,
    ).toBe(true);
    const moved = runtime.getSnapshot();
    expect(moved.document.nodesById.frame_welcome?.childIds).toEqual([
      "shape_accent",
      "feature_one",
      "title_welcome",
      "subtitle_welcome",
      "feature_group",
    ]);
    expect(moved.document.nodesById.feature_group).toMatchObject({
      childIds: ["feature_two", "feature_three"],
      size: { width: 556, height: 220 },
    });
    expect(moved.state.selection).toEqual(before.state.selection);
    for (const nodeId of trackedIds) {
      const expected = worldTransforms[nodeId];
      if (!expected) throw new Error(`Missing transform for ${nodeId}`);
      expectTransformClose(getWorldTransform(moved.document, nodeId), expected);
    }
    expect(moved.state.history.undo).toHaveLength(1);

    expect(runtime.undo().ok).toBe(true);
    expect({
      ...runtime.getSnapshot().document,
      revision: before.document.revision,
    }).toEqual(before.document);
    expect(runtime.redo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.feature_one?.parentId).toBe(
      "frame_welcome",
    );
  });

  it("clears Frame-relative constraints when reparenting into a Group and restores them on undo", () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.title_welcome!.constraints = {
      horizontal: "left-right",
      vertical: "top",
    };
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const plan = planReparentNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["title_welcome"],
      {
        parentId: "feature_group",
        index: 0,
        commandPrefix: "move_constrained_title",
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        type: "update_properties",
        nodeId: "title_welcome",
        constraints: null,
      }),
    );
    expect(
      runtime.apply(
        transaction(runtime, "move_constrained_title", plan.commands),
      ).ok,
    ).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.constraints,
    ).toBeUndefined();
    expect(runtime.undo().ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome?.constraints,
    ).toEqual({ horizontal: "left-right", vertical: "top" });
  });

  it("clears ordinary constraints when reparenting into an Auto Layout Frame", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    document.nodesById.source_frame = {
      ...frame,
      id: "source_frame",
      name: "Source",
      childIds: ["feature_one"],
      properties: { ...frame.properties, autoLayout: { mode: "none" } },
    };
    document.pagesById.page_welcome!.rootNodeIds.push("source_frame");
    document.nodesById.feature_group!.childIds = [
      "feature_two",
      "feature_three",
    ];
    document.nodesById.feature_one!.parentId = "source_frame";
    document.nodesById.feature_one!.constraints = {
      horizontal: "right",
      vertical: "bottom",
    };
    const runtime = new EditorRuntime(normalizeDesignDocument(document));
    const plan = planReparentNodes(
      runtime.getSnapshot().document,
      "page_welcome",
      ["feature_one"],
      {
        parentId: "frame_welcome",
        index: 1,
        commandPrefix: "move_into_flow",
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.commands).toContainEqual(
      expect.objectContaining({
        type: "update_properties",
        nodeId: "feature_one",
        constraints: null,
      }),
    );
    expect(
      runtime.apply(transaction(runtime, "move_into_flow", plan.commands)).ok,
    ).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.feature_one).toMatchObject({
      parentId: "frame_welcome",
      transform: [1, 0, 0, 1, 0, 16],
    });
    expect(
      runtime.getSnapshot().document.nodesById.feature_one?.constraints,
    ).toBeUndefined();
  });

  it("expands and rebases a destination Group without moving existing or inserted artwork", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const trackedIds = [
      "title_welcome",
      "feature_one",
      "feature_two",
      "feature_three",
    ];
    const worldTransforms = Object.fromEntries(
      trackedIds.map((nodeId) => [nodeId, getWorldTransform(before, nodeId)]),
    );
    const plan = planReparentNodes(before, "page_welcome", ["title_welcome"], {
      parentId: "feature_group",
      index: 3,
      commandPrefix: "move_title_into_group",
    });
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(
        transaction(runtime, "move_title_into_group", plan.commands),
      ).ok,
    ).toBe(true);

    const moved = runtime.getSnapshot().document;
    expect(moved.nodesById.feature_group).toMatchObject({
      childIds: [
        "feature_one",
        "feature_two",
        "feature_three",
        "title_welcome",
      ],
      size: { width: 892, height: 452 },
    });
    for (const nodeId of trackedIds) {
      const expected = worldTransforms[nodeId];
      if (!expected) throw new Error(`Missing transform for ${nodeId}`);
      expectTransformClose(getWorldTransform(moved, nodeId), expected);
    }
    const reopened = normalizeDesignDocument(JSON.parse(JSON.stringify(moved)));
    expect(reopened.nodesById.title_welcome?.parentId).toBe("feature_group");
  });

  it("inserts a sibling block at an exact final index without changing transforms", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const before = runtime.getSnapshot().document;
    const plan = planReparentNodes(
      before,
      "page_welcome",
      ["title_welcome", "subtitle_welcome"],
      {
        parentId: "frame_welcome",
        index: 0,
        commandPrefix: "move_copy_to_start",
      },
    );
    if (!plan.ok) throw new Error(plan.message);
    expect(
      runtime.apply(transaction(runtime, "move_copy_to_start", plan.commands))
        .ok,
    ).toBe(true);
    const moved = runtime.getSnapshot().document;
    expect(moved.nodesById.frame_welcome?.childIds).toEqual([
      "title_welcome",
      "subtitle_welcome",
      "shape_accent",
      "feature_group",
    ]);
    expect(getWorldTransform(moved, "title_welcome")).toEqual(
      getWorldTransform(before, "title_welcome"),
    );
    expect(getWorldTransform(moved, "subtitle_welcome")).toEqual(
      getWorldTransform(before, "subtitle_welcome"),
    );
  });

  it("rejects cyclic, empty-group, locked, singular, and invalid reparent targets", () => {
    const document = createWelcomeDocument();
    expect(
      planReparentNodes(document, "page_welcome", ["frame_welcome"], {
        parentId: "feature_group",
        index: 0,
        commandPrefix: "cycle",
      }),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planReparentNodes(
        document,
        "page_welcome",
        ["feature_one", "feature_two", "feature_three"],
        {
          parentId: "frame_welcome",
          index: 0,
          commandPrefix: "empty_group",
        },
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planReparentNodes(document, "page_welcome", ["title_welcome"], {
        parentId: "shape_accent",
        index: 0,
        commandPrefix: "shape_parent",
      }),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planReparentNodes(document, "page_welcome", ["title_welcome"], {
        parentId: "frame_welcome",
        index: 99,
        commandPrefix: "bad_index",
      }),
    ).toMatchObject({ ok: false, code: "invalid-target" });

    const locked = structuredClone(document);
    const lockedGroup = locked.nodesById.feature_group;
    if (!lockedGroup) throw new Error("Missing Group fixture");
    lockedGroup.locked = true;
    expect(
      planReparentNodes(locked, "page_welcome", ["title_welcome"], {
        parentId: "feature_group",
        index: 0,
        commandPrefix: "locked_target",
      }),
    ).toMatchObject({ ok: false, code: "locked" });

    const singular = structuredClone(document);
    const singularGroup = singular.nodesById.feature_group;
    if (!singularGroup) throw new Error("Missing Group fixture");
    singularGroup.transform = [0, 0, 0, 0, 64, 340];
    expect(
      planReparentNodes(singular, "page_welcome", ["title_welcome"], {
        parentId: "feature_group",
        index: 0,
        commandPrefix: "singular_target",
      }),
    ).toMatchObject({ ok: false, code: "visual-fidelity" });
  });

  it("reports inherited clipping or appearance changes for visual review", () => {
    const document = structuredClone(createWelcomeDocument());
    const target = document.nodesById.feature_group;
    if (!target) throw new Error("Missing Group fixture");
    target.opacity = 0.6;
    const plan = planReparentNodes(
      document,
      "page_welcome",
      ["title_welcome"],
      {
        parentId: "feature_group",
        index: 0,
        commandPrefix: "appearance_change",
      },
    );

    expect(plan).toMatchObject({
      ok: true,
      warnings: [expect.stringContaining("inherited clipping")],
    });
  });

  it("rejects no-op, mixed-parent, cross-page, and locked layer order requests", () => {
    const document = createWelcomeDocument();
    expect(
      planReorderNodes(
        document,
        "page_welcome",
        ["feature_group"],
        "bring-to-front",
        "noop_front",
      ),
    ).toMatchObject({ ok: false, code: "invalid-selection" });
    expect(
      planReorderNodes(
        document,
        "page_welcome",
        ["title_welcome", "feature_one"],
        "send-to-back",
        "mixed_parent",
      ),
    ).toMatchObject({ ok: false, code: "mixed-parent" });
    expect(
      planReorderNodes(
        document,
        "page_missing",
        ["title_welcome"],
        "bring-forward",
        "missing_page",
      ),
    ).toMatchObject({ ok: false, code: "not-found" });

    const locked = structuredClone(document);
    const lockedFrame = locked.nodesById.frame_welcome;
    if (!lockedFrame) throw new Error("Welcome frame is missing");
    lockedFrame.locked = true;
    expect(
      planReorderNodes(
        locked,
        "page_welcome",
        ["title_welcome"],
        "bring-forward",
        "locked_layer",
      ),
    ).toMatchObject({ ok: false, code: "locked" });
    expect(
      canReorderNodes(
        document,
        "page_welcome",
        ["title_welcome"],
        "bring-forward",
      ),
    ).toBe(true);
    expect(
      canReorderNodes(
        document,
        "page_welcome",
        ["feature_group"],
        "bring-to-front",
      ),
    ).toBe(false);
  });
});
