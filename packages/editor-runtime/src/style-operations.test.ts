import { describe, expect, it } from "vitest";
import type {
  DesignOperation,
  DesignTransaction,
  SharedStyleDefinition,
} from "@opendesign/design-contracts";
import { materializeSharedStyles } from "@opendesign/style-service";
import { exportSvg } from "@opendesign/import-export-service";
import {
  createWelcomeDocument,
  EditorRuntime,
  planCreateStyle,
  planCreateStyleFromNode,
  planDeleteStyle,
  planSetStyleReference,
  planSvgExportRequest,
  planUpdateStyle,
} from "./index.js";

describe("Shared Styles EditorRuntime v1", () => {
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
