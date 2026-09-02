import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { SnapGuideLine } from "@opendesign/geometry-service/snapping";
import { describe, expect, it, vi } from "vitest";
import { DirectTransformSnapSession } from "./direct-transform-snap-session.js";
import type { LeaferEngineSyncInput } from "./types.js";

describe("DirectTransformSnapSession mixed-affine multi resize", () => {
  it("snaps the real axis-aligned selection box across different parents", () => {
    const fixture = createMixedAffineFixture();
    const onLines = vi.fn();
    const session = createSession(fixture, onLines);

    expect(beginResize(session, fixture.input)).toBe(true);
    expect(
      session.resolveResize({
        aroundCenter: false,
        direction: 3,
        lockRatio: false,
        scaleX: 259 / 256,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 260 / 256, scaleY: 1 });
    expect(onLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ axis: "x", position: 300 }),
    ]);

    fixture.input.document.revision += 1;
    session.refresh({
      engineInput: fixture.input,
      excludedNodeIds: new Set(fixture.input.selection.nodeIds),
      selectedNodeIds: fixture.input.selection.nodeIds,
    });
    expect(
      session.resolveResize({
        aroundCenter: false,
        direction: 3,
        lockRatio: false,
        scaleX: 259 / 256,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 260 / 256, scaleY: 1 });
  });

  it("uses object targets and pixel-grid fallback for the same selection box", () => {
    const objectFixture = createMixedAffineFixture();
    objectFixture.input.document.pagesById.page_welcome!.guides = [];
    objectFixture.input.document.nodesById.shape_accent!.transform = [
      1, 0, 0, 1, 300, 80,
    ];
    objectFixture.input.snapSettings = {
      geometry: false,
      objects: true,
      pixelGrid: false,
    };
    const onObjectLines = vi.fn();
    const objectSession = createSession(objectFixture, onObjectLines);
    expect(beginResize(objectSession, objectFixture.input)).toBe(true);
    expect(
      objectSession.resolveResize({
        aroundCenter: false,
        direction: 3,
        lockRatio: false,
        scaleX: 259 / 256,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 260 / 256, scaleY: 1 });
    expect(onObjectLines).toHaveBeenLastCalledWith([
      expect.objectContaining({ axis: "x", position: 300, source: "object" }),
    ]);

    const pixelFixture = createMixedAffineFixture();
    pixelFixture.input.document.pagesById.page_welcome!.guides = [];
    pixelFixture.input.snapSettings = {
      geometry: false,
      objects: false,
      pixelGrid: true,
    };
    const onPixelLines = vi.fn();
    const pixelSession = createSession(pixelFixture, onPixelLines);
    expect(beginResize(pixelSession, pixelFixture.input)).toBe(true);
    expect(
      pixelSession.resolveResize({
        aroundCenter: false,
        direction: 3,
        lockRatio: false,
        scaleX: 259.4 / 256,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 259 / 256, scaleY: 1 });
    expect(onPixelLines).toHaveBeenLastCalledWith([]);
  });

  it("keeps ratio, center-resize, and Control suppression semantics", () => {
    const fixture = createMixedAffineFixture();
    const session = createSession(fixture, vi.fn());
    expect(beginResize(session, fixture.input)).toBe(true);

    session.handleKeyDown(keyEvent("ShiftLeft", "Shift"));
    expect(
      session.resolveResize({
        aroundCenter: false,
        direction: 4,
        lockRatio: session.ratioLocked,
        scaleX: 259 / 256,
        scaleY: 259 / 256,
      }),
    ).toEqual({ scaleX: 260 / 256, scaleY: 260 / 256 });
    session.handleKeyUp(keyEvent("ShiftLeft", "Shift"));

    expect(
      session.resolveResize({
        aroundCenter: true,
        direction: 3,
        lockRatio: false,
        scaleX: 131 / 128,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 132 / 128, scaleY: 1 });

    session.handleKeyDown(keyEvent("ControlLeft", "Control"));
    expect(
      session.resolveResize({
        aroundCenter: false,
        direction: 3,
        lockRatio: false,
        scaleX: 259 / 256,
        scaleY: 1,
      }),
    ).toEqual({ scaleX: 259 / 256, scaleY: 1 });
  });
});

function createSession(
  fixture: ReturnType<typeof createMixedAffineFixture>,
  onLines: (lines: readonly SnapGuideLine[]) => void,
) {
  return new DirectTransformSnapSession({
    currentDocument: () => fixture.input.document,
    element: (nodeId) => fixture.elements.get(nodeId) as never,
    onLines,
  });
}

function beginResize(
  session: DirectTransformSnapSession,
  input: LeaferEngineSyncInput,
) {
  return session.beginResize({
    engineInput: input,
    excludedNodeIds: new Set(input.selection.nodeIds),
    selectedNodeIds: input.selection.nodeIds,
  });
}

function createMixedAffineFixture() {
  const document = structuredClone(createWelcomeDocument());
  document.nodesById.frame_welcome!.transform = [1, 0, 0, 1, 0, 0];
  document.nodesById.feature_group!.transform = [1, 0, 0, 1, 200, 0];
  document.nodesById.title_welcome!.transform = [0, 1, -1, 0, 100, 100];
  document.nodesById.title_welcome!.size = { width: 100, height: 60 };
  document.nodesById.feature_two!.transform = [1, 0.25, 0.4, 1, 0, 120];
  document.nodesById.feature_two!.size = { width: 80, height: 40 };
  document.pagesById.page_welcome!.guides = [{ axis: "X", offset: 300 }];
  const selection = {
    anchorNodeId: "feature_two",
    nodeIds: ["title_welcome", "feature_two"],
  };
  const input: LeaferEngineSyncInput = {
    document,
    pageId: "page_welcome",
    rulerGuidesVisible: true,
    selection,
    snapSettings: { geometry: false, objects: false, pixelGrid: false },
    tool: "select",
    viewport: { panX: 0, panY: 0, zoom: 1, width: 800, height: 600 },
  };
  return {
    elements: new Map([
      ["title_welcome", elementFixture(document.nodesById.title_welcome!)],
      ["feature_two", elementFixture(document.nodesById.feature_two!)],
    ]),
    input,
  };
}

function elementFixture(node: {
  size: { height: number; width: number };
  transform: readonly [number, number, number, number, number, number];
}) {
  return {
    height: node.size.height,
    localTransform: {
      a: node.transform[0],
      b: node.transform[1],
      c: node.transform[2],
      d: node.transform[3],
      e: node.transform[4],
      f: node.transform[5],
    },
    tag: "Rect",
    width: node.size.width,
  };
}

function keyEvent(code: string, key: string): KeyboardEvent {
  return { code, key } as KeyboardEvent;
}
