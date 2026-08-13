import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import {
  autoLayoutShortcutRequest,
  canShowOrdinaryConstraints,
  canShowAutoLayoutSizing,
  layoutInspectorMode,
} from "./auto-layout-shortcut";

describe("Auto Layout editor shortcut", () => {
  it("enables a suggested flow and removes it with Alt/Option", () => {
    const document = createWelcomeDocument();
    const selection = {
      nodeIds: ["frame_welcome"],
      anchorNodeId: "frame_welcome",
    };
    expect(
      autoLayoutShortcutRequest(
        {
          altKey: false,
          ctrlKey: false,
          key: "A",
          metaKey: false,
          shiftKey: true,
        },
        document,
        selection,
      ),
    ).toMatchObject({
      frameId: "frame_welcome",
      autoLayout: { mode: "horizontal" },
    });
    expect(
      autoLayoutShortcutRequest(
        {
          altKey: true,
          ctrlKey: false,
          key: "a",
          metaKey: false,
          shiftKey: true,
        },
        document,
        selection,
      ),
    ).toEqual({ frameId: "frame_welcome", autoLayout: { mode: "none" } });
  });

  it("ignores non-Frame or modified shortcuts and hides flow-child constraints", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("missing Frame");
    frame.properties.autoLayout = {
      mode: "vertical",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 0,
      primaryAlignment: "start",
      counterAlignment: "start",
    };
    expect(
      autoLayoutShortcutRequest(
        {
          altKey: false,
          ctrlKey: true,
          key: "a",
          metaKey: false,
          shiftKey: true,
        },
        document,
        { nodeIds: ["frame_welcome"] },
      ),
    ).toBeNull();
    expect(
      canShowOrdinaryConstraints(document, document.nodesById.title_welcome),
    ).toBe(false);
    expect(
      canShowAutoLayoutSizing(document, document.nodesById.title_welcome),
    ).toBe(true);
    expect(
      layoutInspectorMode(document, document.nodesById.title_welcome),
    ).toBe("sizing");
    document.nodesById.title_welcome.layoutPositioning = "absolute";
    expect(
      layoutInspectorMode(document, document.nodesById.title_welcome),
    ).toBe("absolute");
    expect(
      canShowOrdinaryConstraints(document, document.nodesById.title_welcome),
    ).toBe(true);
    expect(
      canShowAutoLayoutSizing(document, document.nodesById.title_welcome),
    ).toBe(false);
    delete document.nodesById.title_welcome.layoutPositioning;
    frame.properties.autoLayout = {
      mode: "horizontal",
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      gap: 8,
      primaryAlignment: "start",
      counterAlignment: "start",
      wrap: { mode: "wrap", counterGap: 12 },
    };
    expect(
      layoutInspectorMode(document, document.nodesById.title_welcome),
    ).toBe("wrap-sizing");
    frame.properties.autoLayout = { mode: "none" };
    expect(
      canShowOrdinaryConstraints(document, document.nodesById.title_welcome),
    ).toBe(true);
  });
});
