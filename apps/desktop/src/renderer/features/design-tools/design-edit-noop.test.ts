import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import type { InternalDesignEditToolInput } from "@/shared/design-agent-tools";
import { RendererDesignToolResponseContract } from "@/shared/design-tool-bridge";
import { executeDesignToolRequest } from "./design-tool-execution";

const arrange: InternalDesignEditToolInput["edits"][number] = {
  kind: "arrange",
  input: {
    action: "align-left",
    label: "Align",
    pageId: "page_welcome",
    nodeIds: ["feature_one", "feature_two"],
  },
};
function setup() {
  const document = structuredClone(createWelcomeDocument());
  document.nodesById.feature_two.transform[4] =
    document.nodesById.feature_one.transform[4];
  return new EditorRuntime(document);
}
function execute(
  runtime: EditorRuntime,
  edits: InternalDesignEditToolInput["edits"],
) {
  return executeDesignToolRequest(
    {
      requestId: "noop",
      call: {
        toolCallId: "noop",
        toolName: "opendesign_edit_design",
        input: { label: "Edit", edits },
      },
      context: {
        runId: "run",
        sessionId: "session",
        documentId: "document_welcome",
        revision: 0,
        scope: { kind: "page", pageId: "page_welcome", selectedNodeIds: [] },
        mutationTarget: { kind: "page", pageId: "page_welcome" },
      },
    },
    runtime,
    "page_welcome",
  );
}

describe("already satisfied design arrangement", () => {
  it("treats an already-frontmost layer as unchanged rather than invalid", async () => {
    const runtime = setup();
    const before = runtime.getSnapshot();
    const result = await execute(runtime, [
      {
        kind: "hierarchy",
        input: {
          action: "reorder",
          label: "Bring to front",
          pageId: "page_welcome",
          nodeIds: ["feature_group"],
          order: "bring-to-front",
        },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      result: { observedRevision: 0, content: { changed: false } },
    });
    expect(result).not.toHaveProperty("result.designRevision");
    expect(runtime.getSnapshot()).toEqual(before);
  });

  it("keeps a property change when a following hierarchy step is already satisfied", async () => {
    const runtime = setup();
    const result = await execute(runtime, [
      {
        kind: "node",
        input: {
          label: "Opacity",
          commands: [
            {
              commandId: "opacity",
              type: "update_properties",
              nodeId: "title_welcome",
              opacity: 0.7,
            },
          ],
        },
      },
      {
        kind: "hierarchy",
        input: {
          action: "reorder",
          label: "Front",
          pageId: "page_welcome",
          nodeIds: ["feature_group"],
          order: "bring-to-front",
        },
      },
    ]);
    expect(result).toMatchObject({
      ok: true,
      result: { designRevision: { revision: 1 } },
    });
    expect(runtime.getSnapshot().document.nodesById.title_welcome.opacity).toBe(
      0.7,
    );
    expect(runtime.undo().ok).toBe(true);
    expect(runtime.getSnapshot().document.nodesById.title_welcome.opacity).toBe(
      1,
    );
  });

  it("returns observed state without a revision or undo entry", async () => {
    const runtime = setup();
    const before = runtime.getSnapshot();
    const result = await execute(runtime, [arrange]);
    expect(RendererDesignToolResponseContract.parse(result).ok).toBe(true);
    expect(result).toMatchObject({
      ok: true,
      result: { observedRevision: 0, content: { changed: false } },
    });
    expect(result).not.toHaveProperty("result.designRevision");
    expect(runtime.getSnapshot()).toEqual(before);
  });
  it.each([true, false])(
    "keeps real changes atomic when unchanged arrangement comes first=%s",
    async (first) => {
      const runtime = setup();
      const edit: InternalDesignEditToolInput["edits"][number] = {
        kind: "node",
        input: {
          label: "Opacity",
          commands: [
            {
              commandId: "opacity",
              type: "update_properties",
              nodeId: "title_welcome",
              opacity: 0.7,
            },
          ],
        },
      };
      const result = await execute(
        runtime,
        first ? [arrange, edit] : [edit, arrange],
      );
      expect(result).toMatchObject({
        ok: true,
        result: { designRevision: { revision: 1 } },
      });
      expect(
        runtime.getSnapshot().document.nodesById.title_welcome.opacity,
      ).toBe(0.7);
      expect(runtime.undo().ok).toBe(true);
      expect(
        runtime.getSnapshot().document.nodesById.title_welcome.opacity,
      ).toBe(1);
    },
  );
  it("rejects a later invalid entry without committing earlier changes", async () => {
    const runtime = setup();
    const before = runtime.getSnapshot();
    await expect(
      execute(runtime, [
        {
          kind: "node",
          input: {
            label: "Opacity",
            commands: [
              {
                commandId: "opacity",
                type: "update_properties",
                nodeId: "title_welcome",
                opacity: 0.7,
              },
            ],
          },
        },
        arrange,
        {
          kind: "arrange",
          input: {
            action: "align-left",
            label: "Invalid",
            pageId: "page_welcome",
            nodeIds: ["missing_a", "missing_b"],
          },
        },
      ]),
    ).rejects.toThrow();
    expect(runtime.getSnapshot()).toEqual(before);
  });

  it("does not turn a locked-layer error into unchanged success", async () => {
    const document = structuredClone(createWelcomeDocument());
    document.nodesById.feature_one.locked = true;
    const runtime = new EditorRuntime(document);
    const before = runtime.getSnapshot();
    await expect(execute(runtime, [arrange])).rejects.toThrow("locked");
    expect(runtime.getSnapshot()).toEqual(before);
  });

  it("does not treat invalid selections as already satisfied", async () => {
    const runtime = setup();
    const before = runtime.getSnapshot();
    await expect(
      execute(runtime, [
        {
          kind: "arrange",
          input: {
            action: "align-left",
            label: "Invalid",
            pageId: "page_welcome",
            nodeIds: ["missing_a", "missing_b"],
          },
        },
      ]),
    ).rejects.toThrow();
    expect(runtime.getSnapshot()).toEqual(before);
  });
});
