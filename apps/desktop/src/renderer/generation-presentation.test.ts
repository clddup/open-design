import type { DesignNode, EditorEvent } from "@opendesign/design-contracts";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { generationRevealFromEditorEvent } from "./generation-presentation";

describe("Renderer Agent generation presentation", () => {
  it("derives parent-first reveal order from committed Agent additions", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_agent_additions`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    const group = node({
      id: "agent_group",
      kind: "group",
      parentId: "frame_welcome",
      properties: {},
    });
    const child = node({
      id: "agent_child",
      kind: "rectangle",
      parentId: group.id,
      properties: {
        fills: [{ type: "solid", color: "#6574ff", opacity: 1 }],
        strokes: [],
        strokeWidth: 0,
        cornerRadius: 8,
      },
    });
    const result = runtime.apply({
      transactionId: "transaction_agent_additions",
      documentId: "document_welcome",
      baseRevision: 0,
      actor: { type: "agent", id: "agent_conversation" },
      label: "Build a visible section",
      commands: [
        {
          commandId: "insert_agent_group",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: "frame_welcome",
          index: 2,
          node: group,
        },
        {
          commandId: "insert_agent_child",
          type: "insert_element",
          pageId: "page_welcome",
          parentId: group.id,
          index: 0,
          node: child,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    expect(
      generationRevealFromEditorEvent(
        changed,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toEqual({
      id: "event_agent_additions",
      nodeIds: ["agent_group", "agent_child"],
      startedAt: 500,
    });
  });

  it("does not animate user edits or non-additive changes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_user_edit`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    expect(
      runtime.apply({
        transactionId: "transaction_user_edit",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "user", id: "local-user" },
        label: "Rename layer",
        commands: [
          {
            commandId: "rename_feature",
            type: "update_properties",
            nodeId: "feature_one",
            name: "Renamed locally",
          },
        ],
      }).ok,
    ).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    expect(
      generationRevealFromEditorEvent(
        changed,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toBeUndefined();
  });

  it("does not animate an Agent update without newly added nodes", () => {
    const runtime = new EditorRuntime(createWelcomeDocument(), {
      createId: (prefix) => `${prefix}_agent_update`,
    });
    let changed: EditorEvent | undefined;
    runtime.subscribe((event) => {
      if (event.type === "document.changed") changed = event;
    });
    expect(
      runtime.apply({
        transactionId: "transaction_agent_update",
        documentId: "document_welcome",
        baseRevision: 0,
        actor: { type: "agent", id: "agent_conversation" },
        label: "Refine existing layer",
        commands: [
          {
            commandId: "refine_feature",
            type: "update_properties",
            nodeId: "feature_one",
            opacity: 0.8,
          },
        ],
      }).ok,
    ).toBe(true);
    expect(changed).toBeDefined();
    if (!changed) return;
    expect(
      generationRevealFromEditorEvent(
        changed,
        runtime.getSnapshot().document,
        "page_welcome",
        500,
      ),
    ).toBeUndefined();
  });
});

function node(
  input:
    | {
        id: string;
        kind: "group";
        parentId: string;
        properties: Extract<DesignNode, { kind: "group" }>["properties"];
      }
    | {
        id: string;
        kind: "rectangle";
        parentId: string;
        properties: Extract<DesignNode, { kind: "rectangle" }>["properties"];
      },
): DesignNode {
  return {
    ...input,
    name: input.id,
    childIds: [],
    visible: true,
    locked: false,
    transform: [1, 0, 0, 1, 24, 24],
    size: { width: 160, height: 96 },
    opacity: 1,
    extensions: {},
  };
}
