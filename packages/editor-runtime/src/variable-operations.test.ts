import { describe, expect, it } from "vitest";
import type {
  DesignOperation,
  DesignTransaction,
  VariableDefinition,
  VariableResolvedDataType,
  VariableValue,
} from "@opendesign/design-contracts";
import { materializeVariableBindings } from "@opendesign/variable-service";
import { exportSvg } from "@opendesign/import-export-service";
import {
  createWelcomeDocument,
  EditorRuntime,
  planAddVariableMode,
  planCreateVariable,
  planCreateVariableCollection,
  planDeleteVariable,
  planSetExplicitVariableMode,
  planSetVariableBinding,
  planSvgExportRequest,
} from "./index.js";

describe("Variables EditorRuntime v1", () => {
  it("persists, projects, exports, diffs, undoes, and safely clears typed bindings", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    applyPlan(
      runtime,
      planCreateVariableCollection(runtime.getSnapshot().document, {
        collectionId: "theme",
        key: "theme-key",
        name: "Theme",
        defaultModeId: "dark",
        defaultModeName: "Dark",
        commandPrefix: "theme",
      }),
    );
    for (const variable of [
      definition("copy", "STRING", { dark: "Dark variable copy" }),
      definition("opacity", "FLOAT", { dark: 0.7 }),
      definition("foreground", "COLOR", {
        dark: { r: 0.1, g: 0.2, b: 0.3, a: 0.5 },
      }),
    ]) {
      applyPlan(
        runtime,
        planCreateVariable(runtime.getSnapshot().document, {
          variable,
          commandPrefix: `create_${variable.id}`,
        }),
      );
    }
    applyPlan(
      runtime,
      planAddVariableMode(runtime.getSnapshot().document, {
        collectionId: "theme",
        modeId: "light",
        name: "Light",
        valuesByVariableId: {
          copy: "Light variable copy",
          opacity: 0.4,
          foreground: { r: 1, g: 1, b: 1, a: 0.5 },
        },
        commandPrefix: "add_light",
      }),
    );
    for (const [target, variableId] of [
      [{ kind: "node", nodeId: "title_welcome", field: "characters" }, "copy"],
      [{ kind: "node", nodeId: "title_welcome", field: "opacity" }, "opacity"],
      [
        {
          kind: "paint",
          nodeId: "title_welcome",
          paintField: "fills",
          paintIndex: 0,
          field: "color",
        },
        "foreground",
      ],
    ] as const) {
      applyPlan(
        runtime,
        planSetVariableBinding(runtime.getSnapshot().document, {
          target,
          variableId,
          commandPrefix: `bind_${variableId}`,
        }),
      );
    }
    const modeResult = applyPlan(
      runtime,
      planSetExplicitVariableMode(runtime.getSnapshot().document, {
        target: { kind: "node", id: "frame_welcome" },
        collectionId: "theme",
        modeId: "light",
        commandPrefix: "set_light",
      }),
    );
    expect(modeResult.changes.changedNodeIds).toContain("frame_welcome");

    const document = runtime.getSnapshot().document;
    const projection = materializeVariableBindings(document);
    expect(projection.issues).toEqual([]);
    expect(projection.document.nodesById.title_welcome).toMatchObject({
      opacity: 0.4,
      properties: {
        content: "Light variable copy",
        fills: [{ color: "#ffffff", opacity: 0.5 }],
      },
    });
    const exportPlan = planSvgExportRequest(document, {
      pageId: "page_welcome",
      rootNodeIds: ["frame_welcome"],
      baseRevision: document.revision,
    });
    expect(exportPlan.ok).toBe(true);
    if (!exportPlan.ok) throw new Error(exportPlan.message);
    expect(exportPlan.request.document.nodesById.title_welcome).toMatchObject({
      properties: { content: "Light variable copy" },
    });
    const exported = exportSvg(exportPlan.request);
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      throw new Error(exported.issues.map((issue) => issue.message).join("; "));
    }
    expect(exported.svg).toContain("Light variable copy");
    expect(exported.svg).toContain('fill="#ffffff"');
    expect(exported.svg).toContain('fill-opacity="0.5"');

    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(document)) as unknown,
    );
    expect(
      reopened.getSnapshot().document.variablesById.foreground?.valuesByMode
        .light,
    ).toEqual({
      r: 1,
      g: 1,
      b: 1,
      a: 0.5,
    });
    expect(runtime.undo("user")).toMatchObject({ ok: true, mode: "undo" });
    expect(
      materializeVariableBindings(runtime.getSnapshot().document).document
        .nodesById.title_welcome,
    ).toMatchObject({ properties: { content: "Dark variable copy" } });
    expect(runtime.redo("user")).toMatchObject({ ok: true, mode: "redo" });

    const deletion = planDeleteVariable(runtime.getSnapshot().document, {
      variableId: "foreground",
      commandPrefix: "delete_foreground",
    });
    const deleteResult = applyPlan(runtime, deletion);
    expect(deleteResult.changes.removedVariableIds).toContain("foreground");
    const title = runtime.getSnapshot().document.nodesById.title_welcome;
    expect(title?.kind).toBe("text");
    if (title?.kind !== "text") throw new Error("Missing title");
    expect(title.properties.fills[0]).not.toHaveProperty("boundVariables");
  });
});

function definition(
  id: string,
  resolvedType: VariableResolvedDataType,
  valuesByMode: Record<string, VariableValue>,
): VariableDefinition {
  return {
    id,
    key: `${id}-key`,
    name: id,
    description: "",
    hiddenFromPublishing: false,
    variableCollectionId: "theme",
    resolvedType,
    valuesByMode,
    scopes: ["ALL_SCOPES"],
    codeSyntax: {},
    extensions: {},
  };
}

function applyPlan(
  runtime: EditorRuntime,
  plan: ReturnType<typeof planCreateVariableCollection>,
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
    transactionId: `variables_${document.revision + 1}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "user" },
    label: "Edit variables",
    commands,
  };
}
