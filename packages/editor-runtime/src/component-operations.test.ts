import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  componentProjectionId,
  resolveComponentInstance,
} from "@opendesign/component-service";
import { createEmptyDesignDocument } from "./document.js";
import { EditorRuntime } from "./runtime.js";
import { canDeleteNodes } from "./layer-operations.js";
import { planDeletePage, planDuplicatePage } from "./page-operations.js";
import {
  planCreateComponent,
  planCreateInstance,
  planDetachComponentInstance,
  planResetComponentOverrides,
  planRemoveComponent,
  planSetComponentOverride,
} from "./component-operations.js";

describe("component operations", () => {
  it("syncs main changes while retaining, resetting, and undoing overrides", () => {
    const runtime = new EditorRuntime(componentFixture());
    const created = planCreateComponent(runtime.getSnapshot().document, {
      componentId: "component_button",
      nodeId: "button_main",
      name: "Primary button",
      commandPrefix: "component",
    });
    expect(created.ok).toBe(true);
    apply(runtime, created.ok ? created.commands : [], "create-component");
    expect(
      runtime.getSnapshot().document.componentsById.component_button,
    ).toMatchObject({
      rootNodeId: "button_main",
    });

    const instance = planCreateInstance(runtime.getSnapshot().document, {
      componentId: "component_button",
      instanceId: "button_instance",
      pageId: "page_instance",
      parentId: null,
      index: 0,
      transform: [1, 0, 0, 1, 40, 60],
      commandPrefix: "instance",
    });
    expect(instance.ok).toBe(true);
    apply(runtime, instance.ok ? instance.commands : [], "create-instance");

    const override = planSetComponentOverride(runtime.getSnapshot().document, {
      instanceId: "button_instance",
      sourcePath: ["button_label"],
      patch: { properties: { content: "Buy now" } },
      commandPrefix: "override",
    });
    expect(override.ok).toBe(true);
    apply(runtime, override.ok ? override.commands : [], "override-instance");

    const appearanceOverride = planSetComponentOverride(
      runtime.getSnapshot().document,
      {
        instanceId: "button_instance",
        sourcePath: ["button_label"],
        patch: { opacity: 0.75 },
        commandPrefix: "appearance-override",
      },
    );
    expect(appearanceOverride.ok).toBe(true);
    apply(
      runtime,
      appearanceOverride.ok ? appearanceOverride.commands : [],
      "appearance-override",
    );
    const persistedOverride =
      runtime.getSnapshot().document.nodesById.button_instance;
    expect(
      persistedOverride?.kind === "instance"
        ? persistedOverride.properties.overrides[0]?.patch
        : undefined,
    ).toMatchObject({
      opacity: 0.75,
      properties: { content: "Buy now" },
    });

    apply(
      runtime,
      [
        {
          commandId: "main_fill",
          type: "update_properties",
          nodeId: "button_bg",
          properties: {
            fills: [{ type: "solid", color: "#db2777", opacity: 1 }],
          },
        },
      ],
      "update-main",
    );
    const synced = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(synced.ok).toBe(true);
    if (!synced.ok) return;
    const label = synced.nodes.find(
      (node) => node.sourceNodeId === "button_label",
    )?.node;
    const background = synced.nodes.find(
      (node) => node.sourceNodeId === "button_bg",
    )?.node;
    expect(label?.kind === "text" ? label.properties.content : null).toBe(
      "Buy now",
    );
    expect(
      background?.kind === "rectangle" ? background.properties.fills[0] : null,
    ).toMatchObject({ color: "#db2777" });

    const reset = planResetComponentOverrides(runtime.getSnapshot().document, {
      instanceId: "button_instance",
      commandPrefix: "reset",
    });
    expect(reset.ok).toBe(true);
    apply(runtime, reset.ok ? reset.commands : [], "reset-instance");
    const resetResolution = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(
      resetResolution.ok &&
        resetResolution.nodes.find(
          (node) => node.sourceNodeId === "button_label",
        )?.node.kind === "text"
        ? (
            resetResolution.nodes.find(
              (node) => node.sourceNodeId === "button_label",
            )!.node as Extract<DesignNode, { kind: "text" }>
          ).properties.content
        : null,
    ).toBe("Continue");

    const undone = runtime.undo();
    expect(undone.ok).toBe(true);
    const undoneInstance =
      runtime.getSnapshot().document.nodesById.button_instance;
    expect(
      undoneInstance?.kind === "instance"
        ? undoneInstance.properties.overrides
        : [],
    ).toHaveLength(1);

    const reopened = new EditorRuntime(
      JSON.parse(JSON.stringify(runtime.getSnapshot().document)) as unknown,
    );
    const reopenedInstance =
      reopened.getSnapshot().document.nodesById.button_instance;
    expect(
      reopenedInstance?.kind === "instance"
        ? reopenedInstance.properties.overrides[0]?.patch
        : undefined,
    ).toMatchObject({
      opacity: 0.75,
      properties: { content: "Buy now" },
    });
  });

  it("detaches to normal layers and keeps a stable editable subtree", () => {
    const runtime = new EditorRuntime(componentFixture(true));
    const detached = planDetachComponentInstance(
      runtime.getSnapshot().document,
      {
        instanceId: "button_instance",
        commandPrefix: "detach",
      },
    );
    expect(detached.ok).toBe(true);
    apply(runtime, detached.ok ? detached.commands : [], "detach-instance");
    const root = runtime.getSnapshot().document.nodesById.button_instance;
    expect(root?.kind).toBe("frame");
    expect(root?.childIds).toHaveLength(2);
    expect(
      runtime.getSnapshot().document.componentsById.component_button,
    ).toBeDefined();
    const undone = runtime.undo();
    expect(undone.ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.button_instance?.kind).toBe(
      "instance",
    );
  });

  it("resolves nested components without projection id collisions", () => {
    const document = componentFixture(true);
    document.componentsById.component_icon = {
      id: "component_icon",
      name: "Icon",
      rootNodeId: "icon_main",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    document.nodesById.icon_main = frame("icon_main", null, ["icon_dot"]);
    document.nodesById.icon_dot = rectangle("icon_dot", "icon_main", "#111111");
    document.pagesById.page_main!.rootNodeIds.push("icon_main");
    document.nodesById.nested_icon = {
      id: "nested_icon",
      name: "Icon",
      parentId: "button_main",
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 4, 4],
      size: { width: 100, height: 40 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "instance",
      properties: {
        componentId: "component_icon",
        componentProperties: {},
        overrides: [],
      },
    };
    document.nodesById.button_main!.childIds.push("nested_icon");
    document.componentsById.component_icon_alt = {
      id: "component_icon_alt",
      name: "Alternate icon",
      rootNodeId: "icon_alt_main",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    document.nodesById.icon_alt_main = frame("icon_alt_main", null, [
      "icon_alt_dot",
    ]);
    document.nodesById.icon_alt_dot = rectangle(
      "icon_alt_dot",
      "icon_alt_main",
      "#db2777",
    );
    document.pagesById.page_main!.rootNodeIds.push("icon_alt_main");
    const runtime = new EditorRuntime(document);
    const swap = planSetComponentOverride(runtime.getSnapshot().document, {
      instanceId: "button_instance",
      sourcePath: ["nested_icon"],
      patch: { properties: { componentId: "component_icon_alt" } },
      commandPrefix: "swap-nested-icon",
    });
    expect(swap.ok).toBe(true);
    apply(runtime, swap.ok ? swap.commands : [], "swap-nested-icon");
    const resolved = resolveComponentInstance(
      runtime.getSnapshot().document,
      "button_instance",
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(new Set(resolved.nodes.map((node) => node.projectionId)).size).toBe(
      resolved.nodes.length,
    );
    expect(
      resolved.nodes.some(
        (node) =>
          node.projectionId ===
          componentProjectionId("button_instance", ["nested_icon"]),
      ),
    ).toBe(true);
    expect(
      resolved.nodes.some((node) => node.sourceNodeId === "icon_alt_dot"),
    ).toBe(true);
  });

  it("protects main deletion and keeps duplicate Page component semantics explicit", () => {
    const runtime = new EditorRuntime(componentFixture(true));
    expect(
      canDeleteNodes(runtime.getSnapshot().document, ["button_main"]),
    ).toBe(false);
    expect(
      canDeleteNodes(runtime.getSnapshot().document, ["button_instance"]),
    ).toBe(true);

    const duplicate = planDuplicatePage(runtime.getSnapshot().document, {
      pageId: "page_instance",
      duplicatePageId: "page_instance_copy",
      name: "Instances copy",
      commandPrefix: "duplicate-instance-page",
      createNodeId: (sourceNodeId) => `${sourceNodeId}_copy`,
    });
    expect(duplicate.ok).toBe(true);
    apply(runtime, duplicate.ok ? duplicate.commands : [], "duplicate-page");
    const copied =
      runtime.getSnapshot().document.nodesById.button_instance_copy;
    expect(
      copied?.kind === "instance" ? copied.properties.componentId : null,
    ).toBe("component_button");

    const deleteMainPage = planDeletePage(runtime.getSnapshot().document, {
      pageId: "page_main",
      commandPrefix: "delete-main-page",
    });
    expect(deleteMainPage.ok).toBe(true);
    if (!deleteMainPage.ok) return;
    const rejected = runtime.apply(
      transaction(runtime, "delete-main-page", deleteMainPage.commands),
    );
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: "invalid" },
    });
  });

  it("removes component identity only after every instance is gone", () => {
    const runtime = new EditorRuntime(componentFixture(true));
    expect(
      planRemoveComponent(runtime.getSnapshot().document, {
        componentId: "component_button",
        commandPrefix: "remove-component",
      }),
    ).toMatchObject({ ok: false, code: "invalid" });
    apply(
      runtime,
      [
        {
          commandId: "delete-instance",
          type: "delete_element",
          nodeId: "button_instance",
        },
      ],
      "delete-instance",
    );
    const remove = planRemoveComponent(runtime.getSnapshot().document, {
      componentId: "component_button",
      commandPrefix: "remove-component",
    });
    expect(remove.ok).toBe(true);
    apply(runtime, remove.ok ? remove.commands : [], "remove-component");
    expect(
      runtime.getSnapshot().document.componentsById.component_button,
    ).toBeUndefined();
    expect(runtime.getSnapshot().document.nodesById.button_main?.kind).toBe(
      "frame",
    );
  });
});

function apply(
  runtime: EditorRuntime,
  commands: DesignOperation[],
  id: string,
) {
  const result = runtime.apply(transaction(runtime, id, commands));
  expect(result.ok).toBe(true);
}

function transaction(
  runtime: EditorRuntime,
  id: string,
  commands: DesignOperation[],
) {
  const snapshot = runtime.getSnapshot();
  return {
    transactionId: id,
    documentId: snapshot.document.documentId,
    baseRevision: snapshot.document.revision,
    actor: { type: "user", id: "test" },
    label: id,
    commands,
  };
}

function componentFixture(withInstance = false): DesignDocument {
  const document = structuredClone(
    createEmptyDesignDocument("component_doc", "page_main"),
  );
  document.pageOrder.push("page_instance");
  document.pagesById.page_instance = {
    id: "page_instance",
    name: "Instances",
    rootNodeIds: [],
    extensions: {},
  };
  document.pagesById.page_main!.rootNodeIds = ["button_main"];
  document.nodesById.button_main = frame("button_main", null, [
    "button_bg",
    "button_label",
  ]);
  document.nodesById.button_bg = rectangle(
    "button_bg",
    "button_main",
    "#2563eb",
  );
  document.nodesById.button_label = text(
    "button_label",
    "button_main",
    "Continue",
  );
  if (withInstance) {
    document.componentsById.component_button = {
      id: "component_button",
      name: "Primary button",
      rootNodeId: "button_main",
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    };
    document.pagesById.page_instance.rootNodeIds = ["button_instance"];
    document.nodesById.button_instance = {
      id: "button_instance",
      name: "Primary button",
      parentId: null,
      childIds: [],
      visible: true,
      locked: false,
      transform: [1, 0, 0, 1, 40, 60],
      size: { width: 100, height: 40 },
      exportSettings: [],
      opacity: 1,
      extensions: {},
      kind: "instance",
      properties: {
        componentId: "component_button",
        componentProperties: {},
        overrides: [],
      },
    };
  }
  return document;
}

function frame(
  id: string,
  parentId: string | null,
  childIds: string[],
): Extract<DesignNode, { kind: "frame" }> {
  return {
    id,
    name: id,
    parentId,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "frame",
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
      clipsContent: false,
    },
  };
}

function rectangle(
  id: string,
  parentId: string,
  color: string,
): Extract<DesignNode, { kind: "rectangle" }> {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 100, height: 40 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "rectangle",
    properties: {
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
  };
}

function text(
  id: string,
  parentId: string,
  content: string,
): Extract<DesignNode, { kind: "text" }> {
  return {
    id,
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 12, 10],
    size: { width: 76, height: 20 },
    exportSettings: [],
    opacity: 1,
    extensions: {},
    kind: "text",
    properties: {
      content,
      fontFamily: "Inter",
      fontSize: 14,
      fontWeight: 500,
      lineHeight: 20,
      letterSpacing: 0,
      textAlignHorizontal: "center",
      textAlignVertical: "center",
      textResize: "fixed",
      textWrap: "word",
      textOverflow: "visible",
      fills: [{ type: "solid", color: "#ffffff", opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
    },
  };
}
