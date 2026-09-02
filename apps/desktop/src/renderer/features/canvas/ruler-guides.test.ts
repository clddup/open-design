import { describe, expect, it } from "vitest";
import {
  createWelcomeDocument,
  EditorRuntime,
} from "@opendesign/editor-runtime";
import {
  collectRulerGuideSegments,
  commitRulerGuideEdit,
  guidePlacementAtScreenPoint,
  resolveActiveGuideFrameId,
  rulerTicks,
  selectionRulerRanges,
} from "./ruler-guides";
import { collectRulerGuideDistanceMeasurements } from "./ruler-guide-measurements";

const viewport = {
  panX: 10,
  panY: 20,
  zoom: 2,
  width: 800,
  height: 600,
};

describe("ruler guide projection", () => {
  it("projects Page guides across the viewport and Frame guides through world transforms", () => {
    const document = structuredClone(createWelcomeDocument());
    document.pagesById.page_welcome.guides = [
      { axis: "X", offset: 50 },
      { axis: "X", offset: 5_000 },
    ];
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    frame.properties.guides = [{ axis: "Y", offset: 20 }];

    const segments = collectRulerGuideSegments(
      document,
      "page_welcome",
      viewport,
    );
    expect(segments.find(({ owner }) => owner.type === "page")).toMatchObject({
      start: { x: 110, y: 20 },
      end: { x: 110, y: 600 },
    });
    expect(segments.find(({ owner }) => owner.type === "frame")).toBeDefined();
    expect(segments.some(({ guide }) => guide.offset === 5_000)).toBe(false);
  });

  it("stores a dragged guide in the active Frame only when dropped inside it", () => {
    const document = createWelcomeDocument();
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    const selection = { nodeIds: ["feature_one"], anchorNodeId: "feature_one" };
    expect(resolveActiveGuideFrameId(document, selection)).toBe(frame.id);

    const insideDocumentX = frame.transform[4] + 40;
    const insideDocumentY = frame.transform[5] + 30;
    expect(
      guidePlacementAtScreenPoint(
        document,
        "page_welcome",
        viewport,
        "X",
        {
          x: insideDocumentX * viewport.zoom + viewport.panX,
          y: insideDocumentY * viewport.zoom + viewport.panY,
        },
        frame.id,
      ),
    ).toMatchObject({
      owner: { type: "frame", frameId: frame.id },
      guide: { axis: "X", offset: 40 },
    });

    expect(
      guidePlacementAtScreenPoint(
        document,
        "page_welcome",
        viewport,
        "X",
        { x: -200, y: -200 },
        frame.id,
      ).owner,
    ).toEqual({ type: "page", pageId: "page_welcome" });
  });

  it("derives bounded ruler ticks from pan and zoom", () => {
    const ticks = rulerTicks("X", viewport);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(500);
    expect(ticks.some(({ major }) => major)).toBe(true);
  });

  it("highlights the selected layer range instead of only its owning Frame", () => {
    const document = createWelcomeDocument();
    const frameRanges = selectionRulerRanges(
      document,
      { nodeIds: ["frame_welcome"], anchorNodeId: "frame_welcome" },
      viewport,
    );
    const childRanges = selectionRulerRanges(
      document,
      { nodeIds: ["feature_one"], anchorNodeId: "feature_one" },
      viewport,
    );

    expect(frameRanges).not.toBeNull();
    expect(childRanges).not.toBeNull();
    expect(childRanges!.x[1] - childRanges!.x[0]).toBeLessThan(
      frameRanges!.x[1] - frameRanges!.x[0],
    );
    const multiRanges = selectionRulerRanges(
      document,
      {
        nodeIds: ["feature_one", "feature_three"],
        anchorNodeId: "feature_one",
      },
      viewport,
    );
    expect(multiRanges).not.toBeNull();
    expect(multiRanges!.x[1] - multiRanges!.x[0]).toBeGreaterThan(
      childRanges!.x[1] - childRanges!.x[0],
    );
  });

  it("measures from an Alt-dragged guide to a selected top-level Frame and nearby objects", () => {
    const document = createWelcomeDocument();
    const selection = {
      nodeIds: ["frame_welcome"],
      anchorNodeId: "frame_welcome",
    };
    expect(
      collectRulerGuideDistanceMeasurements(
        document,
        "page_welcome",
        selection,
        {
          guide: { axis: "X", offset: 40 },
          owner: { type: "page", pageId: "page_welcome" },
        },
        { x: 90, y: 400 },
        viewport,
      ).map(({ id, value }) => ({ id, value })),
    ).toEqual([{ id: "x-after:frame:frame_welcome", value: 40 }]);

    expect(
      collectRulerGuideDistanceMeasurements(
        document,
        "page_welcome",
        selection,
        {
          guide: { axis: "X", offset: 120 },
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
        { x: 410, y: 400 },
        viewport,
      ).map(({ id, value }) => ({ id, value })),
    ).toEqual([
      { id: "x-before:frame:frame_welcome", value: 120 },
      { id: "x-after:frame:frame_welcome", value: 1_000 },
      { id: "x-before:node:title_welcome", value: 56 },
      { id: "x-after:node:title_welcome", value: 664 },
    ]);
  });

  it("does not invent guide redlines without one selected top-level Frame", () => {
    expect(
      collectRulerGuideDistanceMeasurements(
        createWelcomeDocument(),
        "page_welcome",
        { nodeIds: ["feature_one"], anchorNodeId: "feature_one" },
        {
          guide: { axis: "X", offset: 40 },
          owner: { type: "page", pageId: "page_welcome" },
        },
        { x: 90, y: 400 },
        viewport,
      ),
    ).toEqual([]);
  });

  it("fails open instead of measuring a rotated Frame through its world AABB", () => {
    const document = structuredClone(createWelcomeDocument());
    const frame = document.nodesById.frame_welcome;
    if (frame?.kind !== "frame") throw new Error("Missing fixture Frame");
    frame.transform = [0, 1, -1, 0, 80, 64];

    expect(
      collectRulerGuideDistanceMeasurements(
        document,
        "page_welcome",
        { nodeIds: [frame.id], anchorNodeId: frame.id },
        {
          guide: { axis: "X", offset: 40 },
          owner: { type: "page", pageId: "page_welcome" },
        },
        { x: 90, y: 400 },
        viewport,
      ),
    ).toEqual([]);
  });

  it("omits a rotated nearby object instead of measuring its world AABB", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (title?.kind !== "text") throw new Error("Missing fixture title");
    title.transform = [0, 1, -1, 0, 64, 108];

    expect(
      collectRulerGuideDistanceMeasurements(
        document,
        "page_welcome",
        {
          nodeIds: ["frame_welcome"],
          anchorNodeId: "frame_welcome",
        },
        {
          guide: { axis: "X", offset: 120 },
          owner: {
            type: "frame",
            pageId: "page_welcome",
            frameId: "frame_welcome",
          },
        },
        { x: 410, y: 400 },
        viewport,
      ).map(({ id, value }) => ({ id, value })),
    ).toEqual([
      { id: "x-before:frame:frame_welcome", value: 120 },
      { id: "x-after:frame:frame_welcome", value: 1_000 },
    ]);
  });

  it("rejects a stale guide edit without changing the document", () => {
    const runtime = new EditorRuntime(createWelcomeDocument());
    const result = commitRulerGuideEdit(
      runtime,
      {
        duplicate: false,
        expectedRevision: 1,
        target: {
          guide: { axis: "X", offset: 100 },
          owner: { type: "page", pageId: "page_welcome" },
        },
      },
      "stale_guide",
      "Move ruler guide",
    );

    expect(result).toEqual({ ok: false, code: "stale" });
    expect(runtime.getSnapshot().document.revision).toBe(0);
    expect(runtime.getSnapshot().document.pagesById.page_welcome?.guides).toBe(
      undefined,
    );
  });
});
