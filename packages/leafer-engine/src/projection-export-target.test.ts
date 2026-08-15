import { createWelcomeDocument } from "@opendesign/editor-runtime";
import type { Transform } from "@opendesign/design-contracts";
import { describe, expect, it, vi } from "vitest";
import { projectDesignPage } from "./mapping.js";
import {
  createProjectionExportTarget,
  type ProjectionExportFactory,
} from "./projection-export-target.js";
import {
  projectResolvedTextRuns,
  textRunFragmentElementId,
  type LeaferTextRunProjectionResolution,
} from "./text-run-projection.js";

class FakeExportElement {
  children: FakeExportElement[] = [];
  data: Record<string, unknown> = {};
  readonly destroy = vi.fn();
  readonly remove = vi.fn();
  specId?: string;
  transform: Transform = [1, 0, 0, 1, 0, 0];

  constructor(readonly tag: string) {}
}

const factory: ProjectionExportFactory<FakeExportElement> = {
  addAt: (parent, child, index) => parent.children.splice(index, 0, child),
  applyData: (element, spec) => {
    element.data = spec.data;
    element.specId = spec.id;
  },
  create: (tag) => new FakeExportElement(tag),
  createWrapper: () => new FakeExportElement("Group"),
  setTransform: (element, transform) => {
    element.transform = transform;
  },
};

describe("rich Text projection export target", () => {
  it("exports a Text as one local composite instead of its transparent proxy", () => {
    const projection = richTextProjection();
    const target = createProjectionExportTarget(
      projection,
      { kind: "node", nodeId: "title_welcome" },
      factory,
    );
    if (!target) throw new Error("Missing derived Text export target");

    expect(target.element.tag).toBe("Group");
    expect(target.element.children.map(({ specId }) => specId)).toEqual([
      "title_welcome",
      textRunFragmentElementId("title_welcome", 0),
      textRunFragmentElementId("title_welcome", 1),
    ]);
    expect(target.element.children[0]).toMatchObject({
      data: { fill: "rgba(0, 0, 0, 0)" },
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(target.element.children[1]).toMatchObject({
      data: { fill: "#111827", text: "Design " },
      transform: [1, 0, 0, 1, 0, 0],
    });
    expect(target.element.children[2]).toMatchObject({
      data: { fill: "#7c3aed", text: "faster" },
      transform: [1, 0, 0, 1, 120, 0],
    });

    target.dispose();
    target.dispose();
    expect(target.element.remove).toHaveBeenCalledTimes(1);
    expect(target.element.destroy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds Frame and Page roots with fragments in stable paint order", () => {
    const projection = richTextProjection();
    const frame = createProjectionExportTarget(
      projection,
      { kind: "node", nodeId: "frame_welcome" },
      factory,
    );
    const page = createProjectionExportTarget(
      projection,
      { kind: "page" },
      factory,
    );
    if (!frame || !page) throw new Error("Missing derived export targets");

    expect(frame.element.tag).toBe("Frame");
    expect(frame.element.transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(frame.element.children.map(({ specId }) => specId)).toEqual(
      expect.arrayContaining([
        "title_welcome",
        textRunFragmentElementId("title_welcome", 0),
        textRunFragmentElementId("title_welcome", 1),
      ]),
    );
    const titleIndex = frame.element.children.findIndex(
      ({ specId }) => specId === "title_welcome",
    );
    expect(
      frame.element.children
        .slice(titleIndex, titleIndex + 3)
        .map(({ specId }) => specId),
    ).toEqual([
      "title_welcome",
      textRunFragmentElementId("title_welcome", 0),
      textRunFragmentElementId("title_welcome", 1),
    ]);
    expect(page.element.tag).toBe("Group");
    expect(page.element.children[0]).toMatchObject({
      specId: "frame_welcome",
      transform: projection.elementsById.get("frame_welcome")?.transform,
    });
  });

  it("keeps ordinary targets on the existing fast export path", () => {
    const base = projectDesignPage(createWelcomeDocument(), "page_welcome");
    expect(
      createProjectionExportTarget(
        base,
        { kind: "node", nodeId: "title_welcome" },
        factory,
      ),
    ).toBeNull();
    expect(
      createProjectionExportTarget(
        richTextProjection(),
        { kind: "node", nodeId: "feature_one" },
        factory,
      ),
    ).toBeNull();
  });

  it("rejects a non-invertible Text source transform", () => {
    const document = structuredClone(createWelcomeDocument());
    const title = document.nodesById.title_welcome;
    if (!title || title.kind !== "text") throw new Error("Missing title");
    title.properties.content = "Design faster";
    title.transform = [0, 0, 0, 1, 120, 80];
    const base = projectDesignPage(document, "page_welcome");
    expect(() =>
      createProjectionExportTarget(
        projectResolvedTextRuns(base, resolution(base)),
        { kind: "node", nodeId: title.id },
        factory,
      ),
    ).toThrow("source transform is not invertible");
  });
});

function richTextProjection() {
  const document = structuredClone(createWelcomeDocument());
  const title = document.nodesById.title_welcome;
  if (!title || title.kind !== "text") throw new Error("Missing title");
  title.properties.content = "Design faster";
  const base = projectDesignPage(document, "page_welcome");
  return projectResolvedTextRuns(base, resolution(base));
}

function resolution(
  base: ReturnType<typeof projectDesignPage>,
): LeaferTextRunProjectionResolution {
  return {
    documentId: base.documentId,
    pageId: base.pageId,
    revision: base.revision,
    resultsByNodeId: new Map([
      [
        "title_welcome",
        {
          nodeId: "title_welcome",
          fragments: [
            {
              data: { fill: "#111827" },
              start: 0,
              end: 7,
              text: "Design ",
              x: 0,
              y: 0,
              width: 120,
              height: 40,
            },
            {
              data: { fill: "#7c3aed" },
              start: 7,
              end: 13,
              text: "faster",
              x: 120,
              y: 0,
              width: 100,
              height: 40,
            },
          ],
        },
      ],
    ]),
  };
}
