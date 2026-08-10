import type {
  DesignDocument,
  DesignTransaction,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  canGroupNodes,
  canUngroupNode,
  createWelcomeDocument,
  getWorldTransform,
  normalizeDesignDocument,
  planGroupNodes,
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
});
