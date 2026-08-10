import {
  MAX_TRANSACTION_COMMANDS,
  type DesignNode,
  type DesignTransaction,
  type ImageNode,
  type RectangleNode,
} from "@opendesign/design-contracts";
import {
  SVG_INTERCHANGE_VERSION,
  importSvg,
  type SvgImportResult,
} from "@opendesign/import-export-service";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { describe, expect, it } from "vitest";
import {
  EditorRuntime,
  createWelcomeDocument,
  normalizeDesignDocument,
  planSvgImport,
  type SvgImportPlacement,
} from "./index.js";

const geometryFailure = () => ({
  ok: false as const,
  code: "operation-failed" as const,
  message: "This SVG test does not require path geometry",
});

const unusedGeometry: VectorGeometryProvider = {
  id: "skia-pathkit",
  version: "1.0.0",
  combine: geometryFailure,
  normalize: geometryFailure,
  transform: geometryFailure,
  dash: geometryFailure,
  outlineStroke: geometryFailure,
};

type SuccessfulSvgImport = Extract<SvgImportResult, { ok: true }>;

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
    actor: { type: "user", id: "svg-import-test" },
    label: "Import SVG",
    commands,
  };
}

function importedRectangleSvg(idPrefix = "runtime_svg"): SuccessfulSvgImport {
  const result = importSvg(
    {
      idPrefix,
      name: "Campaign mark",
      svg: `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80">
          <g id="mark" transform="translate(8 6)">
            <rect id="panel" width="96" height="54" rx="12" fill="#6d5dfc"/>
          </g>
        </svg>
      `,
    },
    unusedGeometry,
  );
  if (!result.ok) throw new Error(result.issues[0]?.message ?? "SVG failed");
  return result;
}

function placement(
  overrides: Partial<SvgImportPlacement> = {},
): SvgImportPlacement {
  return {
    pageId: "page_welcome",
    parentId: "frame_welcome",
    index: 1,
    transform: [1, 0, 0, 1, 40, 50],
    commandPrefix: "svg_runtime",
    ...overrides,
  };
}

function successfulCandidate(
  rootNodeId: string,
  nodes: DesignNode[],
): SuccessfulSvgImport {
  return {
    ok: true,
    version: SVG_INTERCHANGE_VERSION,
    rootNodeId,
    nodes,
    sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
    issues: [],
  };
}

function groupNode(
  id: string,
  parentId: string | null,
  childIds: string[],
): DesignNode {
  return {
    id,
    kind: "group",
    name: id,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 100 },
    opacity: 1,
    properties: {},
    extensions: {},
  };
}

function rectangleNode(id: string, parentId: string | null): RectangleNode {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 10, height: 10 },
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color: "#000000", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 0,
    },
    extensions: {},
  };
}

describe("SVG import transaction planner", () => {
  it("previews and applies a service result as one persistent, undoable tree", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const imported = importedRectangleSvg();
    const detachedBefore = structuredClone(imported);
    const plan = planSvgImport(
      runtime.getSnapshot().document,
      imported,
      placement(),
    );

    expect(plan).toMatchObject({
      ok: true,
      rootNodeId: imported.rootNodeId,
      selectionNodeIds: [imported.rootNodeId],
      issues: [],
    });
    if (!plan.ok) return;
    expect(plan.commands).toHaveLength(imported.nodes.length);
    const detachedRoot = imported.nodes.find(
      (node) => node.id === imported.rootNodeId,
    )!;
    const detachedGroupId = detachedRoot.childIds[0]!;
    const detachedGroup = imported.nodes.find(
      (node) => node.id === detachedGroupId,
    )!;
    const detachedRectangleId = detachedGroup.childIds[0]!;
    expect(plan.commands.map((command) => command.type)).toEqual(
      imported.nodes.map(() => "insert_element"),
    );
    expect(
      plan.commands.map((command) =>
        command.type === "insert_element" ? command.node.id : "",
      ),
    ).toEqual([imported.rootNodeId, detachedGroupId, detachedRectangleId]);
    expect(
      plan.commands.every(
        (command) =>
          command.type === "insert_element" &&
          command.node.childIds.length === 0,
      ),
    ).toBe(true);
    expect(imported).toEqual(detachedBefore);

    const change = transaction(runtime, "svg_import_atomic", plan.commands);
    const before = runtime.getSnapshot();
    expect(runtime.preview(change)).toMatchObject({
      ok: true,
      mode: "preview",
      revision: { revision: 1 },
    });
    expect(runtime.getSnapshot()).toBe(before);
    const applyResult = runtime.apply(change);
    expect(applyResult).toMatchObject({
      ok: true,
      mode: "apply",
      revision: { revision: 1 },
    });
    if (!applyResult.ok) return;
    expect(applyResult.changes.addedNodeIds).toContain(plan.rootNodeId);

    const applied = runtime.getSnapshot();
    const importedRoot = applied.document.nodesById[imported.rootNodeId];
    expect(importedRoot).toMatchObject({
      kind: "group",
      parentId: "frame_welcome",
      transform: [1, 0, 0, 1, 40, 50],
      childIds: [detachedGroupId],
    });
    expect(applied.document.nodesById[detachedGroupId]?.childIds).toEqual([
      detachedRectangleId,
    ]);
    expect(applied.state.history.undo).toHaveLength(1);
    expect(
      normalizeDesignDocument(
        JSON.parse(JSON.stringify(applied.document)) as unknown,
      ),
    ).toEqual(applied.document);

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    imported.nodes.forEach((node) =>
      expect(runtime.getSnapshot().document.nodesById[node.id]).toBeUndefined(),
    );
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    expect(
      runtime.getSnapshot().document.nodesById[imported.rootNodeId]?.childIds,
    ).toEqual([detachedGroupId]);
  });

  it("keeps the whole SVG detached when a later command fails", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const imported = importedRectangleSvg("failed_svg");
    const plan = planSvgImport(
      runtime.getSnapshot().document,
      imported,
      placement({ commandPrefix: "failed_svg" }),
    );
    if (!plan.ok) throw new Error(plan.message);
    const before = runtime.getSnapshot();
    const result = runtime.apply(
      transaction(runtime, "failed_svg_transaction", [
        ...plan.commands,
        {
          commandId: "failed_svg_missing",
          type: "delete_element",
          nodeId: "missing_after_svg",
        },
      ]),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: "not-found", commandId: "failed_svg_missing" },
    });
    expect(runtime.getSnapshot()).toBe(before);
    imported.nodes.forEach((node) =>
      expect(runtime.getSnapshot().document.nodesById[node.id]).toBeUndefined(),
    );
  });

  it("leaves a planned import unapplied when its base revision becomes stale", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const imported = importedRectangleSvg("stale_svg");
    const plan = planSvgImport(
      runtime.getSnapshot().document,
      imported,
      placement({ commandPrefix: "stale_svg" }),
    );
    if (!plan.ok) throw new Error(plan.message);
    const staleImport = transaction(
      runtime,
      "stale_svg_transaction",
      plan.commands,
    );
    expect(
      runtime.apply(
        transaction(runtime, "intervening_change", [
          {
            commandId: "intervening_opacity",
            type: "update_properties",
            nodeId: "title_welcome",
            opacity: 0.8,
          },
        ]),
      ).ok,
    ).toBe(true);

    expect(runtime.apply(staleImport)).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
    imported.nodes.forEach((node) =>
      expect(runtime.getSnapshot().document.nodesById[node.id]).toBeUndefined(),
    );
  });

  it("rejects missing, out-of-page, locked, non-container, and invalid-index targets", () => {
    const imported = importedRectangleSvg("target_svg");
    const document = createWelcomeDocument();
    expect(
      planSvgImport(document, imported, placement({ pageId: "missing_page" })),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planSvgImport(
        document,
        imported,
        placement({ parentId: "missing_parent" }),
      ),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planSvgImport(
        document,
        imported,
        placement({ parentId: "title_welcome" }),
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
    expect(
      planSvgImport(document, imported, placement({ index: 99 })),
    ).toMatchObject({ ok: false, code: "invalid-target" });

    const locked = structuredClone(document);
    locked.nodesById.frame_welcome!.locked = true;
    expect(planSvgImport(locked, imported, placement())).toMatchObject({
      ok: false,
      code: "locked",
    });

    const crossPage = structuredClone(document);
    crossPage.pageOrder.push("page_other");
    crossPage.pagesById.page_other = {
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
      extensions: {},
    };
    expect(
      planSvgImport(
        normalizeDesignDocument(crossPage),
        imported,
        placement({ pageId: "page_other", index: 0 }),
      ),
    ).toMatchObject({ ok: false, code: "invalid-target" });
  });

  it("rejects collisions, cycles, orphans, multiple roots, and asset references", () => {
    const document = createWelcomeDocument();
    expect(
      planSvgImport(
        document,
        successfulCandidate("frame_welcome", [
          groupNode("frame_welcome", null, []),
        ]),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "id-collision" });

    expect(
      planSvgImport(
        document,
        successfulCandidate("cycle_root", [
          groupNode("cycle_root", null, ["cycle_child"]),
          groupNode("cycle_child", "cycle_root", ["cycle_root"]),
        ]),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "invalid-tree" });

    expect(
      planSvgImport(
        document,
        successfulCandidate("orphan_root", [
          groupNode("orphan_root", null, []),
          rectangleNode("orphan_child", "orphan_root"),
        ]),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "invalid-tree" });

    expect(
      planSvgImport(
        document,
        successfulCandidate("first_root", [
          groupNode("first_root", null, []),
          rectangleNode("second_root", null),
        ]),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "invalid-tree" });

    const image: ImageNode = {
      id: "referenced_image",
      kind: "image",
      name: "Referenced image",
      parentId: "asset_root",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 0, 0],
      size: { width: 100, height: 100 },
      opacity: 1,
      properties: {
        assetId: "untrusted_asset",
        placement: { mode: "fit" },
        altText: "",
        cornerRadius: 0,
      },
      extensions: {},
    };
    expect(
      planSvgImport(
        document,
        successfulCandidate("asset_root", [
          groupNode("asset_root", null, [image.id]),
          image,
        ]),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "unsupported-reference" });
  });

  it("rejects SVG trees that cannot fit in one transaction", () => {
    const childIds = Array.from(
      { length: MAX_TRANSACTION_COMMANDS },
      (_, index) => `large_child_${index}`,
    );
    const nodes: DesignNode[] = [
      groupNode("large_root", null, childIds),
      ...childIds.map((id) => rectangleNode(id, "large_root")),
    ];
    expect(
      planSvgImport(
        createWelcomeDocument(),
        successfulCandidate("large_root", nodes),
        placement(),
      ),
    ).toMatchObject({ ok: false, code: "operation-limit" });
  });

  it("propagates service failures and warning-level fidelity issues", () => {
    expect(
      planSvgImport(
        createWelcomeDocument(),
        {
          ok: false,
          version: SVG_INTERCHANGE_VERSION,
          issues: [
            {
              code: "unsafe-xml",
              severity: "error",
              message: "Unsafe XML",
            },
          ],
        },
        placement(),
      ),
    ).toMatchObject({
      ok: false,
      code: "invalid-import",
      message: "Unsafe XML",
    });

    const imported = importedRectangleSvg("warning_svg");
    const withWarning: SuccessfulSvgImport = {
      ...imported,
      issues: [
        {
          code: "effect-omitted",
          severity: "warning",
          message: "Filter fidelity is deferred",
        },
      ],
    };
    const plan = planSvgImport(
      createWelcomeDocument(),
      withWarning,
      placement({ commandPrefix: "warning_svg" }),
    );
    expect(plan).toMatchObject({
      ok: true,
      issues: [{ code: "effect-omitted", severity: "warning" }],
    });
  });
});
