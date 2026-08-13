import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import { describe, expect, it, vi } from "vitest";
import { commitCanvasOperation } from "./canvas-operation-commit";

describe("canvas operation commit", () => {
  it("routes populated single-Frame resize without committing projected child transforms", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const onResizeFrame = vi.fn(() => true);
    const accepted = commitCanvasOperation({
      label: "Resize Frame",
      onResizeFrame,
      onTransactionError: vi.fn(),
      request: {
        kind: "resize",
        selectionNodeIds: ["frame_welcome"],
        operations: [
          {
            commandId: "frame",
            type: "update_properties",
            nodeId: "frame_welcome",
            size: { width: 1_600, height: 900 },
          },
          {
            commandId: "projected-child",
            type: "update_properties",
            nodeId: "title_welcome",
            size: { width: 999, height: 99 },
          },
        ],
      },
      runtime,
      transactionId: "canvas_resize",
    });

    expect(accepted).toBe(true);
    expect(onResizeFrame).toHaveBeenCalledWith("frame_welcome", {
      width: 1_600,
      height: 900,
    });
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });

  it("commits an ordinary operation and reports a trusted Runtime failure", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const onTransactionError = vi.fn();
    expect(
      commitCanvasOperation({
        label: "Move layer",
        onResizeFrame: vi.fn(() => false),
        onTransactionError,
        request: {
          kind: "move",
          selectionNodeIds: ["title_welcome"],
          operations: [
            {
              commandId: "move",
              type: "update_properties",
              nodeId: "title_welcome",
              transform: [1, 0, 0, 1, 32, 48],
            },
          ],
        },
        runtime,
        transactionId: "canvas_move",
      }),
    ).toBe(true);
    expect(runtime.getSnapshot().document.revision).toBe(1);
    expect(onTransactionError).toHaveBeenLastCalledWith(null);

    expect(
      commitCanvasOperation({
        label: "Move missing layer",
        onResizeFrame: vi.fn(() => false),
        onTransactionError,
        request: {
          kind: "move",
          operations: [
            {
              commandId: "missing",
              type: "update_properties",
              nodeId: "missing",
              opacity: 0.5,
            },
          ],
        },
        runtime,
        transactionId: "canvas_invalid",
      }),
    ).toBe(false);
    expect(onTransactionError.mock.calls.at(-1)?.[0]).toContain("missing");
  });

  it("rejects direct geometry manipulation of an Auto Layout flow child", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 12,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    const runtime = new EditorRuntime(document);
    const onTransactionError = vi.fn();
    expect(
      commitCanvasOperation({
        label: "Move flow child",
        onResizeFrame: vi.fn(() => false),
        onTransactionError,
        request: {
          kind: "move",
          selectionNodeIds: ["title_welcome"],
          operations: [
            {
              commandId: "move_flow_child",
              type: "update_properties",
              nodeId: "title_welcome",
              transform: [1, 0, 0, 1, 200, 200],
            },
          ],
        },
        runtime,
        transactionId: "canvas_flow_move",
      }),
    ).toBe(false);
    expect(onTransactionError).toHaveBeenCalledWith(
      expect.stringContaining("participates in Auto Layout"),
    );
    expect(runtime.getSnapshot().document.revision).toBe(0);
  });
});
