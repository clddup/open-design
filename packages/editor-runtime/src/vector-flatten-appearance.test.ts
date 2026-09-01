import type {
  DesignDocument,
  DesignNode,
  VectorNetwork,
} from "@opendesign/design-contracts";
import {
  createPathKitGeometryProvider,
  type VectorGeometryProvider,
} from "@opendesign/geometry-service/vector-path";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { createEmptyDesignDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import { canFlattenNodes, planFlattenNodes } from "./vector-flatten.js";

const require = createRequire(import.meta.url);
let geometry: VectorGeometryProvider;

beforeAll(async () => {
  geometry = await createPathKitGeometryProvider({
    wasmBinary: await readFile(
      require.resolve("pathkit-wasm/bin/pathkit.wasm"),
    ),
  });
});

describe("Flatten appearance projection", () => {
  it("preserves one root shell while materializing current Style and Variable values", () => {
    const document = appearanceDocument();
    const plan = planFlattenNodes(
      document,
      "page",
      ["source"],
      "flattened",
      "appearance",
      geometry,
    );
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_appearance",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Flatten appearance",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });

    const snapshot = runtime.getSnapshot().document;
    const flattened = snapshot.nodesById.flattened;
    expect(flattened).toMatchObject({
      kind: "vector",
      opacity: 0.4,
      blendMode: "multiply",
      maskMode: "alpha",
      effectStyleId: "soft-effect",
      effects: [{ type: "layer-blur", radius: 4 }],
      explicitVariableModes: { theme: "light" },
      boundVariables: {
        opacity: { type: "VARIABLE_ALIAS", id: "layer-opacity" },
      },
    });
    const fills = editableNetwork(flattened).regions[0]?.fills;
    expect(fills).toEqual([{ type: "solid", color: "#ff0000", opacity: 0.5 }]);
    expect(fills?.[0]).not.toHaveProperty("boundVariables");
    expect(snapshot.stylesById["soft-effect"]).toBeDefined();
    expect(snapshot.variablesById.accent).toBeDefined();
    expect(snapshot.nodesById.source).toBeUndefined();

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(runtime.getSnapshot().document.nodesById.source).toBeDefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(reopened.getSnapshot().document.nodesById.flattened).toMatchObject({
      kind: "vector",
      opacity: 0.4,
      effectStyleId: "soft-effect",
    });
  });

  it("rejects per-root compositing when multiple roots become one Vector", () => {
    const document = appearanceDocument();
    const source = document.nodesById.source;
    if (source?.kind !== "rectangle") throw new Error("Missing source");
    delete source.boundVariables;
    source.opacity = 0.5;
    const sibling = rectangle("sibling", 120, "#2563eb");
    document.nodesById[sibling.id] = sibling;
    document.pagesById.page!.rootNodeIds.push(sibling.id);

    expect(canFlattenNodes(document, "page", [source.id, sibling.id])).toBe(
      false,
    );
    expect(
      planFlattenNodes(
        document,
        "page",
        [source.id, sibling.id],
        "invalid_multi",
        "invalid_multi",
        geometry,
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
  });

  it("ignores an unrelated Variable failure but fails the selected one", () => {
    const document = appearanceDocument();
    const unrelated = rectangle("source-copy", 120, "#2563eb");
    unrelated.boundVariables = {
      opacity: { type: "VARIABLE_ALIAS", id: "missing-variable" },
    };
    document.nodesById[unrelated.id] = unrelated;
    document.pagesById.page!.rootNodeIds.push(unrelated.id);

    expect(
      planFlattenNodes(
        document,
        "page",
        ["source"],
        "valid_flatten",
        "valid_flatten",
        geometry,
      ),
    ).toMatchObject({ ok: true });
    expect(
      planFlattenNodes(
        document,
        "page",
        [unrelated.id],
        "invalid_variable",
        "invalid_variable",
        geometry,
      ),
    ).toMatchObject({ ok: false, code: "unsupported-topology" });
  });
});

function appearanceDocument(): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("flatten_appearance", "page"),
  );
  const source = rectangle("source", 20, "#000000");
  source.opacity = 1;
  source.blendMode = "multiply";
  source.maskMode = "alpha";
  source.effectStyleId = "soft-effect";
  source.effects = [];
  source.explicitVariableModes = { theme: "light" };
  source.boundVariables = {
    opacity: { type: "VARIABLE_ALIAS", id: "layer-opacity" },
  };
  source.properties.fills[0] = {
    type: "solid",
    color: "#000000",
    opacity: 1,
    boundVariables: {
      color: { type: "VARIABLE_ALIAS", id: "accent" },
    },
  };
  document.nodesById[source.id] = source;
  document.pagesById.page!.rootNodeIds = [source.id];
  document.stylesById["soft-effect"] = {
    id: "soft-effect",
    key: "soft-effect-key",
    name: "Effect/Soft",
    description: "",
    hiddenFromPublishing: false,
    styleType: "EFFECT",
    effects: [{ type: "layer-blur", radius: 4 }],
    extensions: {},
  };
  document.styleOrderByType.EFFECT = ["soft-effect"];
  document.variableCollectionOrder = ["theme"];
  document.variableCollectionsById.theme = {
    id: "theme",
    key: "theme-key",
    name: "Theme",
    hiddenFromPublishing: false,
    modes: [
      { modeId: "dark", name: "Dark" },
      { modeId: "light", name: "Light" },
    ],
    variableIds: ["accent", "layer-opacity"],
    defaultModeId: "dark",
    extensions: {},
  };
  document.variablesById.accent = variable("accent", "COLOR", {
    dark: { r: 0, g: 0, b: 0 },
    light: { r: 1, g: 0, b: 0, a: 0.5 },
  });
  document.variablesById["layer-opacity"] = variable("layer-opacity", "FLOAT", {
    dark: 1,
    light: 0.4,
  });
  return document;
}

function rectangle(
  id: string,
  x: number,
  color: string,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, x, 20],
    size: { width: 80, height: 48 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    properties: {
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
  };
}

function variable(
  id: string,
  resolvedType: "COLOR" | "FLOAT",
  valuesByMode: Record<string, number | object>,
): DesignDocument["variablesById"][string] {
  return {
    id,
    key: `${id}-key`,
    name: id,
    description: "",
    hiddenFromPublishing: false,
    variableCollectionId: "theme",
    resolvedType,
    valuesByMode: valuesByMode as never,
    scopes: ["ALL_SCOPES"],
    codeSyntax: {},
    extensions: {},
  };
}

function editableNetwork(node: DesignNode | undefined): VectorNetwork {
  if (node?.kind !== "vector" || !("network" in node.properties)) {
    throw new Error("Missing editable Vector");
  }
  return node.properties.network;
}
