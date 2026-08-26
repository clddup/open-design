import { describe, expect, it } from "vitest";
import type {
  DesignOperation,
  DesignTransaction,
  SharedStyleDefinition,
} from "@opendesign/design-contracts";
import { materializeSharedStyles } from "@opendesign/style-service";
import { exportSvg } from "@opendesign/import-export-service";
import {
  createLibraryReleaseSnapshot,
  planLibraryReleaseUpdate,
} from "@opendesign/library-service";
import {
  createWelcomeDocument,
  EditorRuntime,
  planApplyLibraryStyle,
  planCreateStyle,
  planCreateStyleFromNode,
  planDeleteStyle,
  planSetStyleReference,
  planSvgExportRequest,
  planUpdateStyle,
} from "./index.js";

describe("Shared Styles EditorRuntime", () => {
  it("preserves adjusted local Image Paint Styles and fails closed without a Library asset bundle", () => {
    const document = structuredClone(createWelcomeDocument());
    document.assetsById.photo = {
      id: "photo",
      kind: "image",
      name: "Photo",
      mimeType: "image/png",
      source: { type: "data", value: "cGhvdG8=" },
      size: { width: 640, height: 480 },
      extensions: {},
    };
    document.stylesById["photo-style"] = {
      id: "photo-style",
      key: "photo-style-key",
      name: "Media/Photo",
      description: "",
      hiddenFromPublishing: false,
      styleType: "PAINT",
      paints: [
        {
          type: "image",
          assetId: "photo",
          fit: "cover",
          opacity: 1,
          filters: { contrast: 0.2, shadows: -0.35 },
        },
      ],
      extensions: {},
    };
    document.styleOrderByType.PAINT.push("photo-style");
    const node = document.nodesById.feature_one;
    if (!node || node.kind !== "rectangle") throw new Error("Missing fixture");
    node.fillStyleId = "photo-style";

    const materialized =
      materializeSharedStyles(document).document.nodesById.feature_one;
    expect(materialized).toMatchObject({
      properties: {
        fills: [
          {
            type: "image",
            assetId: "photo",
            filters: { contrast: 0.2, shadows: -0.35 },
          },
        ],
      },
    });
    expect(() =>
      createLibraryReleaseSnapshot(document, {
        libraryId: "library_media",
        releaseId: "release_media",
        sourceProjectId: "project",
        sourceDesignFileId: "design-system",
        name: "Media",
        publishedAt: "2026-08-22T08:00:00.000Z",
      }),
    ).toThrow("standalone Style asset dependencies are not available yet");

    document.componentsById.card = {
      id: "card",
      name: "Card",
      rootNodeId: "feature_group",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    const release = createLibraryReleaseSnapshot(document, {
      libraryId: "library_media",
      releaseId: "release_media_component",
      sourceProjectId: "project",
      sourceDesignFileId: "design-system",
      name: "Media",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });
    expect(release.componentsById.card?.assetsById.photo).toBeDefined();
    expect(release.stylesById["photo-style"]).toMatchObject({
      style: {
        paints: [
          {
            type: "image",
            assetId: "photo",
            filters: { contrast: 0.2, shadows: -0.35 },
          },
        ],
      },
    });
    const consumer = new EditorRuntime(createWelcomeDocument());
    applyPlan(
      consumer,
      planApplyLibraryStyle(consumer.getSnapshot().document, release, {
        styleId: "photo-style",
        target: { nodeId: "feature_one", field: "fillStyleId" },
        commandPrefix: "apply_photo_style",
      }),
    );
    expect(consumer.getSnapshot().document.assetsById.photo).toBeDefined();
    expect(
      materializeSharedStyles(consumer.getSnapshot().document).document
        .nodesById.feature_one,
    ).toMatchObject({
      properties: {
        fills: [
          {
            type: "image",
            assetId: "photo",
            filters: { contrast: 0.2, shadows: -0.35 },
          },
        ],
      },
    });
  });

  it("publishes visible Styles and only carries hidden Styles required by Component sources", () => {
    const source = structuredClone(createWelcomeDocument());
    source.stylesById.visible = paintStyle(
      "visible",
      "Brand/Visible",
      "#2563eb",
    );
    source.stylesById["hidden-dependency"] = {
      ...paintStyle(
        "hidden-dependency",
        "Brand/Component dependency",
        "#db2777",
      ),
      hiddenFromPublishing: true,
    };
    source.stylesById["hidden-unused"] = {
      ...paintStyle("hidden-unused", "Brand/Internal", "#0f172a"),
      hiddenFromPublishing: true,
    };
    source.styleOrderByType.PAINT.push(
      "visible",
      "hidden-dependency",
      "hidden-unused",
    );
    const feature = source.nodesById.feature_one;
    if (feature?.kind !== "rectangle") throw new Error("Missing feature");
    feature.fillStyleId = "hidden-dependency";
    source.componentsById.card = {
      id: "card",
      name: "Card",
      rootNodeId: "feature_group",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };

    const release = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_styles",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });

    expect(Object.keys(release.stylesById).sort()).toEqual([
      "hidden-dependency",
      "visible",
    ]);
    expect(release.stylesById["hidden-unused"]).toBeUndefined();

    const styleOnlySource = structuredClone(source);
    styleOnlySource.componentsById = {};
    const styleOnlyRelease = createLibraryReleaseSnapshot(styleOnlySource, {
      libraryId: "library_styles_only",
      releaseId: "release_styles_only",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_styles",
      name: "Acme Styles",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });
    expect(styleOnlyRelease.componentsById).toEqual({});
    expect(Object.keys(styleOnlyRelease.stylesById)).toEqual(["visible"]);
  });

  it("creates from a node, projects updates, diffs, persists and deletes without changing appearance", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const create = planCreateStyleFromNode(runtime.getSnapshot().document, {
      nodeId: "title_welcome",
      field: "fillStyleId",
      styleId: "brand-primary",
      key: "brand-primary-key",
      name: "Brand/Primary",
      commandPrefix: "create_brand",
    });
    const created = applyPlan(runtime, create);
    expect(created.changes.addedStyleIds).toEqual(["brand-primary"]);
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      fillStyleId: "brand-primary",
    });

    const current = runtime.getSnapshot().document.stylesById["brand-primary"];
    expect(current?.styleType).toBe("PAINT");
    if (!current || current.styleType !== "PAINT")
      throw new Error("Missing Paint style");
    const updated = planUpdateStyle(runtime.getSnapshot().document, {
      style: {
        ...current,
        paints: [{ type: "solid", color: "#ff3366", opacity: 1 }],
      },
      commandPrefix: "update_brand",
    });
    const result = applyPlan(runtime, updated);
    expect(result.changes.changedStyleIds).toEqual(["brand-primary"]);
    expect(
      materializeSharedStyles(runtime.getSnapshot().document).document.nodesById
        .title_welcome,
    ).toMatchObject({ properties: { fills: [{ color: "#ff3366" }] } });
    const exportPlan = planSvgExportRequest(runtime.getSnapshot().document, {
      pageId: "page_welcome",
      rootNodeIds: ["frame_welcome"],
      baseRevision: runtime.getSnapshot().document.revision,
    });
    expect(exportPlan.ok).toBe(true);
    if (!exportPlan.ok) throw new Error(exportPlan.message);
    const exported = exportSvg(exportPlan.request);
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.issues[0]?.message);
    expect(exported.svg).toContain('fill="#ff3366"');

    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(reopened.getSnapshot().document.stylesById["brand-primary"]).toEqual(
      runtime.getSnapshot().document.stylesById["brand-primary"],
    );

    const deleted = applyPlan(
      runtime,
      planDeleteStyle(runtime.getSnapshot().document, {
        styleId: "brand-primary",
        commandPrefix: "delete_brand",
      }),
    );
    expect(deleted.changes.removedStyleIds).toEqual(["brand-primary"]);
    const title = runtime.getSnapshot().document.nodesById.title_welcome;
    expect(title).not.toHaveProperty("fillStyleId");
    expect(title).toMatchObject({
      properties: { fills: [{ color: "#ff3366" }] },
    });
    expect(runtime.undo("user")).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.stylesById).toHaveProperty(
      "brand-primary",
    );
  });

  it("supports all typed references and detaches direct edits from controlling styles", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const styles: SharedStyleDefinition[] = [
      {
        id: "type-body",
        key: "type-body-key",
        name: "Type/Body",
        description: "",
        hiddenFromPublishing: false,
        styleType: "TEXT",
        textStyle: {
          fontFamily: "Inter",
          fontStyleName: null,
          fontSize: 18,
          fontWeight: 600,
          fontSlant: "normal",
          lineHeight: 26,
          letterSpacing: 0,
          paragraphIndent: 0,
          paragraphSpacing: 8,
          listSpacing: 0,
          hangingList: false,
          textCase: "original",
          textDecoration: "none",
        },
        extensions: {},
      },
      {
        id: "effect-soft",
        key: "effect-soft-key",
        name: "Effect/Soft",
        description: "",
        hiddenFromPublishing: false,
        styleType: "EFFECT",
        effects: [{ type: "layer-blur", radius: 4 }],
        extensions: {},
      },
      {
        id: "grid-eight",
        key: "grid-eight-key",
        name: "Grid/8",
        description: "",
        hiddenFromPublishing: false,
        styleType: "GRID",
        layoutGuides: [
          {
            id: "grid-eight-guide",
            type: "grid",
            size: 8,
            color: "#2563eb",
            opacity: 0.2,
          },
        ],
        extensions: {},
      },
    ];
    for (const style of styles) {
      applyPlan(
        runtime,
        planCreateStyle(runtime.getSnapshot().document, {
          style,
          commandPrefix: `create_${style.id}`,
        }),
      );
    }
    for (const [nodeId, field, styleId] of [
      ["title_welcome", "textStyleId", "type-body"],
      ["title_welcome", "effectStyleId", "effect-soft"],
      ["frame_welcome", "gridStyleId", "grid-eight"],
    ] as const) {
      applyPlan(
        runtime,
        planSetStyleReference(runtime.getSnapshot().document, {
          target: { nodeId, field },
          styleId,
          commandPrefix: `bind_${styleId}`,
        }),
      );
    }
    const before = materializeSharedStyles(runtime.getSnapshot().document)
      .document.nodesById.title_welcome;
    expect(before).toMatchObject({
      properties: { fontSize: 18, lineHeight: 26 },
    });

    const document = runtime.getSnapshot().document;
    const edited = runtime.apply({
      transactionId: "edit_font_size",
      documentId: document.documentId,
      baseRevision: document.revision,
      actor: { type: "user", id: "user" },
      commands: [
        {
          commandId: "edit_font_size",
          type: "update_properties",
          nodeId: "title_welcome",
          properties: { fontSize: 20 },
        },
      ],
    });
    expect(edited.ok).toBe(true);
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({
      properties: { fontFamily: "Inter", fontSize: 20, lineHeight: 26 },
    });
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).not.toHaveProperty("textStyleId");
  });

  it("applies, updates, persists, detaches and restores a Library Style through normal history", () => {
    const source = structuredClone(createWelcomeDocument());
    source.stylesById["brand-library"] = paintStyle(
      "brand-library",
      "Brand/Primary",
      "#2563eb",
    );
    source.styleOrderByType.PAINT.push("brand-library");
    const previous = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_previous",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-21T08:00:00.000Z",
    });
    const runtime = new EditorRuntime(createWelcomeDocument());
    const applied = applyPlan(
      runtime,
      planApplyLibraryStyle(runtime.getSnapshot().document, previous, {
        styleId: "brand-library",
        target: { nodeId: "title_welcome", field: "fillStyleId" },
        commandPrefix: "apply_library_brand",
      }),
    );
    expect(applied.changes.addedLibraryStyleIds).toEqual(["brand-library"]);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(libraryFill(runtime)).toBe("#2563eb");

    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(libraryFill(reopened)).toBe("#2563eb");

    const current = source.stylesById["brand-library"];
    if (!current || current.styleType !== "PAINT") {
      throw new Error("Missing Library Paint Style");
    }
    current.paints = [{ type: "solid", color: "#db2777", opacity: 1 }];
    const latest = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_latest",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });
    const update = planLibraryReleaseUpdate(
      runtime.getSnapshot().document,
      latest,
      "update_library",
    );
    expect(update.commands).toHaveLength(1);
    const updated = runtime.apply(transaction(runtime, update.commands));
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error(updated.error.message);
    expect(updated.changes.changedLibraryStyleIds).toEqual(["brand-library"]);
    expect(libraryFill(runtime)).toBe("#db2777");
    expect(runtime.undo("user").ok).toBe(true);
    expect(libraryFill(runtime)).toBe("#2563eb");
    expect(runtime.redo("user").ok).toBe(true);
    expect(libraryFill(runtime)).toBe("#db2777");

    const detached = planSetStyleReference(runtime.getSnapshot().document, {
      target: { nodeId: "title_welcome", field: "fillStyleId" },
      styleId: null,
      commandPrefix: "detach_library_brand",
    });
    expect(detached.ok).toBe(true);
    if (!detached.ok) throw new Error(detached.message);
    const removed = runtime.apply(
      transaction(runtime, [
        ...detached.commands,
        {
          commandId: "delete_library_brand_source",
          type: "delete_library_style_source",
          styleId: "brand-library",
        },
      ]),
    );
    expect(removed.ok).toBe(true);
    expect(
      runtime.getSnapshot().document.libraryStylesById["brand-library"],
    ).toBeUndefined();
    expect(
      runtime.getSnapshot().document.nodesById.title_welcome,
    ).toMatchObject({ properties: { fills: [{ color: "#db2777" }] } });
  });

  it("rejects Library Style identity drift and deletion while the Style is referenced", () => {
    const source = structuredClone(createWelcomeDocument());
    source.stylesById["brand-library"] = paintStyle(
      "brand-library",
      "Brand/Primary",
      "#2563eb",
    );
    source.styleOrderByType.PAINT.push("brand-library");
    const release = createLibraryReleaseSnapshot(source, {
      libraryId: "library_acme",
      releaseId: "release_initial",
      sourceProjectId: "project_acme",
      sourceDesignFileId: "design_system",
      name: "Acme Library",
      publishedAt: "2026-08-22T08:00:00.000Z",
    });
    const runtime = new EditorRuntime(createWelcomeDocument());
    applyPlan(
      runtime,
      planApplyLibraryStyle(runtime.getSnapshot().document, release, {
        styleId: "brand-library",
        target: { nodeId: "title_welcome", field: "fillStyleId" },
        commandPrefix: "apply_library_brand",
      }),
    );

    const deleteResult = runtime.apply(
      transaction(runtime, [
        {
          commandId: "delete_referenced_library_style",
          type: "delete_library_style_source",
          styleId: "brand-library",
        },
      ]),
    );
    expect(deleteResult).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        issues: [{ commandId: "delete_referenced_library_style" }],
      },
    });

    const drifted = structuredClone(release.stylesById["brand-library"]);
    if (!drifted) throw new Error("Missing Library Style source");
    drifted.source.sourceDesignFileId = "another_design_system";
    const driftResult = runtime.apply(
      transaction(runtime, [
        {
          commandId: "replace_library_style_identity",
          type: "put_library_style_source",
          source: drifted,
        },
      ]),
    );
    expect(driftResult).toMatchObject({
      ok: false,
      error: {
        code: "invalid",
        issues: [{ commandId: "replace_library_style_identity" }],
      },
    });
    expect(runtime.getSnapshot().document.libraryStylesById).toHaveProperty(
      "brand-library",
    );
  });
});

function applyPlan(
  runtime: EditorRuntime,
  plan: ReturnType<typeof planCreateStyle>,
) {
  expect(plan.ok).toBe(true);
  if (!plan.ok) throw new Error(plan.message);
  const result = runtime.apply(transaction(runtime, plan.commands));
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result;
}

function transaction(
  runtime: EditorRuntime,
  commands: DesignOperation[],
): DesignTransaction {
  const document = runtime.getSnapshot().document;
  return {
    transactionId: `styles_${document.revision + 1}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "user" },
    label: "Edit local styles",
    commands,
  };
}

function paintStyle(id: string, name: string, color: string) {
  return {
    id,
    key: `${id}-key`,
    name,
    description: "",
    hiddenFromPublishing: false,
    styleType: "PAINT" as const,
    paints: [{ type: "solid" as const, color, opacity: 1 }],
    extensions: {},
  };
}

function libraryFill(runtime: EditorRuntime) {
  const title = materializeSharedStyles(runtime.getSnapshot().document).document
    .nodesById.title_welcome;
  return title?.kind === "text" && title.properties.fills[0]?.type === "solid"
    ? title.properties.fills[0].color
    : undefined;
}
