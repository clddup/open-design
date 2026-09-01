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
import { EditorRuntime } from "./runtime.js";
import {
  componentInstanceDocument,
  frame,
  instance,
  nestedInstanceDocument,
  slotOverrideDocument,
  variantInstanceDocument,
} from "./vector-flatten-component.fixtures.js";
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

describe("Component Instance Flatten", () => {
  it("materializes the current Instance projection into one editable Vector", () => {
    const document = componentInstanceDocument();
    expect(
      canFlattenNodes(document, "page_instances", ["button_instance"]),
    ).toBe(true);

    const plan = planFlattenNodes(
      document,
      "page_instances",
      ["button_instance"],
      "button_flattened",
      "flatten_instance",
      geometry,
    );
    if (!plan.ok) throw new Error(plan.message);

    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_component_instance",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Flatten component instance",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true, revision: { revision: 1 } });

    const snapshot = runtime.getSnapshot();
    const flattened = snapshot.document.nodesById.button_flattened;
    expect(flattened).toMatchObject({
      kind: "vector",
      parentId: null,
      transform: [1, 0, 0, 1, 40, 60],
      size: { width: 100, height: 40 },
    });
    expect(snapshot.document.nodesById.button_instance).toBeUndefined();
    expect(snapshot.document.nodesById.button_main).toBeDefined();
    expect(snapshot.document.componentsById.component_button).toBeDefined();
    expect(snapshot.document.pagesById.page_instances?.rootNodeIds).toEqual([
      "button_flattened",
    ]);
    expect(
      flattened?.kind === "vector" &&
        "network" in flattened.properties &&
        flattened.properties.network.regions[0]?.fills,
    ).toEqual([{ type: "solid", color: "#22c55e", opacity: 1 }]);
    expect(snapshot.state.history.undo).toHaveLength(1);

    expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
    expect(
      runtime.getSnapshot().document.nodesById.button_instance,
    ).toBeDefined();
    expect(
      runtime.getSnapshot().document.nodesById.button_flattened,
    ).toBeUndefined();
    expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });

    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    expect(
      reopened.getSnapshot().document.nodesById.button_flattened?.kind,
    ).toBe("vector");
    expect(
      reopened.getSnapshot().document.nodesById.button_instance,
    ).toBeUndefined();
  });

  it("fails before producing operations when the Instance projection is invalid", () => {
    const document = componentInstanceDocument();
    const instance = document.nodesById.button_instance;
    if (instance?.kind !== "instance") throw new Error("Missing Instance");
    instance.properties.componentId = "missing_component";

    expect(
      planFlattenNodes(
        document,
        "page_instances",
        [instance.id],
        "invalid_flatten",
        "invalid_instance",
        geometry,
      ),
    ).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
  });

  it("fails instead of throwing on invalid Component property references", () => {
    const document = componentInstanceDocument();
    document.nodesById.button_bg!.componentPropertyReferences = {
      visible: "Missing#button:visible",
    };
    const flatten = () =>
      planFlattenNodes(
        document,
        "page_instances",
        ["button_instance"],
        "invalid_property_flatten",
        "invalid_property_flatten",
        geometry,
      );

    expect(flatten).not.toThrow();
    expect(flatten()).toMatchObject({
      ok: false,
      code: "unsupported-topology",
    });
  });

  it("flattens an Instance through its selected parent container", () => {
    const document = componentInstanceDocument();
    const instanceNode = document.nodesById.button_instance;
    if (instanceNode?.kind !== "instance") throw new Error("Missing Instance");
    const wrapper = frame("instance_wrapper", null, [instanceNode.id]);
    wrapper.transform = [1, 0, 0, 1, 300, 100];
    wrapper.size = { width: 180, height: 140 };
    instanceNode.parentId = wrapper.id;
    document.nodesById[wrapper.id] = wrapper;
    document.pagesById.page_instances!.rootNodeIds = [wrapper.id];

    const plan = planFlattenNodes(
      document,
      "page_instances",
      [wrapper.id],
      "wrapper_flattened",
      "flatten_wrapper",
      geometry,
    );
    if (!plan.ok) throw new Error(plan.message);
    const runtime = new EditorRuntime(document);
    expect(
      runtime.apply({
        transactionId: "flatten_instance_wrapper",
        documentId: document.documentId,
        baseRevision: document.revision,
        actor: { type: "user", id: "test" },
        label: "Flatten instance wrapper",
        commands: [...plan.operations],
      }),
    ).toMatchObject({ ok: true });
    expect(
      runtime.getSnapshot().document.nodesById.wrapper_flattened,
    ).toMatchObject({
      kind: "vector",
      transform: [1, 0, 0, 1, 340, 160],
      size: { width: 100, height: 40 },
    });
  });

  it("resolves nested Instances without persisting projection IDs", () => {
    const document = nestedInstanceDocument();
    const runtime = applyFlatten(document, "nested_flattened");
    const snapshot = runtime.getSnapshot().document;
    const network = vectorNetwork(snapshot.nodesById.nested_flattened);
    const colors = network.regions.flatMap((region) =>
      (region.fills ?? []).flatMap((paint) =>
        paint.type === "solid" ? [paint.color] : [],
      ),
    );
    expect(colors).toEqual(expect.arrayContaining(["#22c55e", "#f97316"]));
    expect(
      Object.keys(snapshot.nodesById).some((id) =>
        id.startsWith("__opendesign_instance__:"),
      ),
    ).toBe(false);
    expect(snapshot.nodesById.icon_main).toBeDefined();
    expect(snapshot.componentsById.component_icon).toBeDefined();
  });

  it("flattens the active Variant selected by typed properties", () => {
    const runtime = applyFlatten(
      variantInstanceDocument(),
      "variant_flattened",
    );
    const network = vectorNetwork(
      runtime.getSnapshot().document.nodesById.variant_flattened,
    );
    expect(network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#db2777", opacity: 1 },
    ]);
  });

  it("uses editable Slot override content in the flattened result", () => {
    const document = slotOverrideDocument();
    const runtime = applyFlatten(document, "slot_flattened");
    const snapshot = runtime.getSnapshot().document;
    const network = vectorNetwork(snapshot.nodesById.slot_flattened);
    expect(network.regions[0]?.fills).toEqual([
      { type: "solid", color: "#a855f7", opacity: 1 },
    ]);
    expect(snapshot.nodesById.button_slot_override).toBeUndefined();
    expect(snapshot.nodesById.custom_slot_content).toBeUndefined();
  });

  it("ignores projection failures outside the selected subtree", () => {
    const document = componentInstanceDocument();
    const broken = instance();
    broken.id = "unrelated_broken_instance";
    broken.properties.componentId = "missing_component";
    broken.transform = [1, 0, 0, 1, 400, 60];
    document.nodesById[broken.id] = broken;
    document.pagesById.page_instances!.rootNodeIds.push(broken.id);

    expect(
      planFlattenNodes(
        document,
        "page_instances",
        ["button_instance"],
        "valid_flatten",
        "valid_flatten",
        geometry,
      ),
    ).toMatchObject({ ok: true });
  });

  it("fails without operations when projected compositing is not exact", () => {
    const patches = [
      { opacity: 0.5 },
      { effects: [{ type: "layer-blur" as const, radius: 4 }] },
      { blendMode: "screen" as const },
      { maskMode: "alpha" as const },
    ];
    for (const patch of patches) {
      const document = componentInstanceDocument();
      const instanceNode = document.nodesById.button_instance;
      if (instanceNode?.kind !== "instance")
        throw new Error("Missing Instance");
      Object.assign(instanceNode, patch);
      expect(
        planFlattenNodes(
          document,
          "page_instances",
          [instanceNode.id],
          "compositing_flatten",
          "compositing_flatten",
          geometry,
        ),
      ).toMatchObject({ ok: false, code: "unsupported-topology" });
      expect(document.nodesById.button_instance).toBe(instanceNode);
    }
  });
});

function applyFlatten(document: DesignDocument, resultNodeId: string) {
  const plan = planFlattenNodes(
    document,
    "page_instances",
    ["button_instance"],
    resultNodeId,
    resultNodeId,
    geometry,
  );
  if (!plan.ok) throw new Error(plan.message);
  const runtime = new EditorRuntime(document);
  const applied = runtime.apply({
    transactionId: `flatten_${resultNodeId}`,
    documentId: document.documentId,
    baseRevision: document.revision,
    actor: { type: "user", id: "test" },
    label: "Flatten Component Instance",
    commands: [...plan.operations],
  });
  if (!applied.ok) throw new Error(applied.error.message);
  return runtime;
}

function vectorNetwork(node: DesignNode | undefined): VectorNetwork {
  if (node?.kind !== "vector" || !("network" in node.properties)) {
    throw new Error("Missing editable Vector network");
  }
  return node.properties.network;
}
