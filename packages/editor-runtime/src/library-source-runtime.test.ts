import { resolveComponentInstance } from "@opendesign/component-service";
import type {
  DesignTransaction,
  FrameNode,
  InstanceNode,
  LibraryComponentSource,
  RectangleNode,
} from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import { EditorRuntime, createEmptyDesignDocument } from "./index.js";

describe("Library component source runtime", () => {
  it("imports an off-page source, resolves one stable instance, updates it, and supports undo/redo", () => {
    const runtime = new EditorRuntime(createEmptyDesignDocument("doc", "page"));
    const imported = runtime.apply(
      transaction(runtime, "import", [
        {
          commandId: "put-source",
          type: "put_library_component_source",
          source: librarySource("release-1", "#2563eb"),
        },
        {
          commandId: "insert-instance",
          type: "insert_element",
          pageId: "page",
          parentId: null,
          index: 0,
          node: instanceNode(),
        },
      ]),
    );

    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.changes.addedLibraryComponentIds).toEqual([
      "library-button",
    ]);
    expect(imported.changes.addedNodeIds).toEqual(["instance"]);
    const firstSnapshot = runtime.getSnapshot();
    expect(firstSnapshot.document.nodesById["source-root"]).toBeUndefined();
    expect(firstSnapshot.document.pagesById.page?.rootNodeIds).toEqual([
      "instance",
    ]);
    expect(resolvedFill(runtime)).toBe("#2563eb");

    const updated = runtime.apply(
      transaction(runtime, "update", [
        {
          commandId: "update-source",
          type: "put_library_component_source",
          source: librarySource("release-2", "#db2777"),
        },
      ]),
    );
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.changes.changedLibraryComponentIds).toEqual([
      "library-button",
    ]);
    expect(updated.changes.changedNodeIds).toEqual([]);
    expect(resolvedFill(runtime)).toBe("#db2777");

    const undo = runtime.undo();
    expect(undo.ok).toBe(true);
    expect(resolvedFill(runtime)).toBe("#2563eb");
    const redo = runtime.redo();
    expect(redo.ok).toBe(true);
    expect(resolvedFill(runtime)).toBe("#db2777");
  });

  it("rejects identity drift and deletion while a persistent instance still references the source", () => {
    const runtime = runtimeWithLibraryInstance();
    const drifted = librarySource("release-2", "#111827");
    drifted.source.sourceDesignFileId = "another-source-file";
    const identityResult = runtime.apply(
      transaction(runtime, "identity-drift", [
        {
          commandId: "replace-identity",
          type: "put_library_component_source",
          source: drifted,
        },
      ]),
    );
    expect(identityResult).toMatchObject({
      ok: false,
      error: { code: "invalid", commandId: "replace-identity" },
    });

    const deleteResult = runtime.apply(
      transaction(runtime, "delete-used", [
        {
          commandId: "delete-source",
          type: "delete_library_component_source",
          componentId: "library-button",
        },
      ]),
    );
    expect(deleteResult).toMatchObject({
      ok: false,
      error: { commandId: "delete-source" },
    });
    expect(runtime.getSnapshot().document.libraryComponentsById).toHaveProperty(
      "library-button",
    );
  });

  it("requires the complete nested component dependency closure", () => {
    const incomplete = new EditorRuntime(
      createEmptyDesignDocument("doc", "page"),
    );
    const parent = nestedLibrarySource();
    const failed = incomplete.apply(
      transaction(incomplete, "missing-dependency", [
        {
          commandId: "put-parent",
          type: "put_library_component_source",
          source: parent,
        },
      ]),
    );
    expect(failed).toMatchObject({ ok: false, error: { code: "invalid" } });

    const complete = new EditorRuntime(
      createEmptyDesignDocument("doc", "page"),
    );
    const imported = complete.apply(
      transaction(complete, "dependency-closure", [
        {
          commandId: "put-child",
          type: "put_library_component_source",
          source: childLibrarySource(),
        },
        {
          commandId: "put-parent",
          type: "put_library_component_source",
          source: parent,
        },
      ]),
    );
    expect(imported.ok).toBe(true);
    expect(complete.getSnapshot().document.nodesById).toEqual({});
  });
});

function runtimeWithLibraryInstance(): EditorRuntime {
  const runtime = new EditorRuntime(createEmptyDesignDocument("doc", "page"));
  const result = runtime.apply(
    transaction(runtime, "import", [
      {
        commandId: "put-source",
        type: "put_library_component_source",
        source: librarySource("release-1", "#2563eb"),
      },
      {
        commandId: "insert-instance",
        type: "insert_element",
        pageId: "page",
        parentId: null,
        index: 0,
        node: instanceNode(),
      },
    ]),
  );
  if (!result.ok) throw new Error(result.error.message);
  return runtime;
}

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
    label: transactionId,
    actor: { type: "user", id: "tester" },
    commands,
  };
}

function librarySource(
  releaseId: string,
  color: string,
): LibraryComponentSource {
  const root = sourceFrame("source-root", ["source-fill"]);
  const fill = rectangle("source-fill", root.id, color);
  return {
    source: {
      libraryId: "library",
      releaseId,
      sourceProjectId: "source-project",
      sourceDesignFileId: "source-file",
      sourceDocumentId: "source-document",
      sourceComponentId: "source-button",
    },
    component: {
      id: "library-button",
      name: "Button",
      rootNodeId: root.id,
      componentPropertyOrder: [],
      componentPropertyDefinitions: {},
      variantProperties: {},
      extensions: {},
    },
    nodesById: { [root.id]: root, [fill.id]: fill },
    assetsById: {},
    dependencyComponentIds: [],
  };
}

function childLibrarySource(): LibraryComponentSource {
  const root = sourceFrame("child-root", ["child-fill"]);
  const fill = rectangle("child-fill", root.id, "#0f172a");
  return {
    ...librarySource("release-1", "#0f172a"),
    source: {
      ...librarySource("release-1", "#0f172a").source,
      sourceComponentId: "source-child",
    },
    component: {
      ...librarySource("release-1", "#0f172a").component,
      id: "library-child",
      name: "Child",
      rootNodeId: root.id,
    },
    nodesById: { [root.id]: root, [fill.id]: fill },
  };
}

function nestedLibrarySource(): LibraryComponentSource {
  const root = sourceFrame("parent-root", ["nested-child"]);
  const nested: InstanceNode = {
    ...instanceNode(),
    id: "nested-child",
    name: "Nested child",
    parentId: root.id,
    properties: {
      componentId: "library-child",
      componentProperties: {},
      overrides: [],
    },
  };
  return {
    ...librarySource("release-1", "#ffffff"),
    source: {
      ...librarySource("release-1", "#ffffff").source,
      sourceComponentId: "source-parent",
    },
    component: {
      ...librarySource("release-1", "#ffffff").component,
      id: "library-parent",
      name: "Parent",
      rootNodeId: root.id,
    },
    nodesById: { [root.id]: root, [nested.id]: nested },
    dependencyComponentIds: ["library-child"],
  };
}

function sourceFrame(id: string, childIds: string[]): FrameNode {
  return {
    id,
    kind: "frame",
    name: id,
    parentId: null,
    childIds,
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
      clipsContent: true,
    },
    extensions: {},
  };
}

function rectangle(id: string, parentId: string, color: string): RectangleNode {
  return {
    id,
    kind: "rectangle",
    name: id,
    parentId,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 0, 0],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    properties: {
      fills: [{ type: "solid", color, opacity: 1 }],
      strokes: [],
      strokeWidth: 0,
      cornerRadius: 8,
    },
    extensions: {},
  };
}

function instanceNode(): InstanceNode {
  return {
    id: "instance",
    kind: "instance",
    name: "Button instance",
    parentId: null,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 24, 24],
    size: { width: 120, height: 44 },
    exportSettings: [],
    opacity: 1,
    properties: {
      componentId: "library-button",
      componentProperties: {},
      overrides: [],
    },
    extensions: {},
  };
}

function resolvedFill(runtime: EditorRuntime): string | undefined {
  const resolution = resolveComponentInstance(
    runtime.getSnapshot().document,
    "instance",
  );
  if (!resolution.ok) throw new Error(resolution.issues[0]?.message);
  const fill = resolution.nodes.find(
    (node) => node.sourceNodeId === "source-fill",
  )?.node;
  if (fill?.kind !== "rectangle") return undefined;
  const paint = fill.properties.fills[0];
  return paint?.type === "solid" ? paint.color : undefined;
}
