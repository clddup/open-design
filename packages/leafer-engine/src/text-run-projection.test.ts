import { createWelcomeDocument } from "@opendesign/editor-runtime";
import { describe, expect, it } from "vitest";
import { projectDesignPage } from "./mapping.js";
import {
  projectResolvedTextRuns,
  textRunEditProxyElementId,
  textRunFragmentElementIds,
  textRunFragmentElementId,
} from "./text-run-projection.js";

describe("native rich-text projection boundary", () => {
  it("keeps one authoritative Text proxy and adds native synthetic fragments", () => {
    const document = createWelcomeDocument();
    const base = projectDesignPage(document, "page_welcome");
    const source = base.elementsById.get("title_welcome");
    if (!source) throw new Error("Missing title projection");
    const content = String(source.data.text);
    const split = 7;
    const firstId = textRunFragmentElementId(source.id, 0);
    const secondId = textRunFragmentElementId(source.id, 1);
    const projection = projectResolvedTextRuns(base, {
      documentId: base.documentId,
      pageId: base.pageId,
      revision: base.revision,
      resultsByNodeId: new Map([
        [
          source.id,
          {
            nodeId: source.id,
            fragments: [
              {
                start: 0,
                end: split,
                text: content.slice(0, split),
                x: 0,
                y: 0,
                width: 92,
                height: 40,
                data: {
                  fill: "#111827",
                  fontFamily: "Inter",
                  fontSize: 32,
                  fontWeight: 700,
                },
              },
              {
                start: split,
                end: content.length,
                text: content.slice(split),
                x: 92,
                y: 0,
                width: 380,
                height: 40,
                data: {
                  fill: "#7c3aed",
                  fontFamily: "Inter",
                  fontSize: 32,
                  fontWeight: 500,
                },
              },
            ],
          },
        ],
      ]),
    });

    expect(projection.elementsById.get(source.id)).toMatchObject({
      id: source.id,
      kind: "text",
      tag: "Text",
      data: {
        fill: "rgba(0, 0, 0, 0)",
        hitFill: "all",
        text: content,
        data: {
          opendesignNodeId: source.id,
          opendesignTextEditProxy: true,
        },
      },
    });
    expect(projection.elementsById.get(firstId)).toMatchObject({
      id: firstId,
      kind: "text",
      parentId: source.parentId,
      tag: "Text",
      data: {
        editable: "single",
        fill: "#111827",
        fontWeight: 700,
        text: content.slice(0, split),
        data: {
          opendesignNodeId: source.id,
          opendesignProjectionId: firstId,
          opendesignSynthetic: true,
          opendesignTextRun: { start: 0, end: split },
        },
      },
    });
    expect(projection.elementsById.get(secondId)).toMatchObject({
      transform: [
        source.transform[0],
        source.transform[1],
        source.transform[2],
        source.transform[3],
        source.transform[4] + source.transform[0] * 92,
        source.transform[5] + source.transform[1] * 92,
      ],
      data: { fill: "#7c3aed", fontWeight: 500 },
    });
    const parent = source.parentId
      ? projection.elementsById.get(source.parentId)
      : undefined;
    expect(parent?.childIds).toEqual(
      expect.arrayContaining([source.id, firstId, secondId]),
    );
    expect(parent?.childIds.indexOf(firstId)).toBe(
      (parent?.childIds.indexOf(source.id) ?? -2) + 1,
    );
    expect(parent?.childIds.indexOf(secondId)).toBe(
      (parent?.childIds.indexOf(source.id) ?? -3) + 2,
    );
    expect(textRunEditProxyElementId(projection, source.id)).toBe(source.id);
    expect(textRunEditProxyElementId(projection, firstId)).toBe(source.id);
    expect(textRunEditProxyElementId(projection, secondId)).toBe(source.id);
    expect(textRunFragmentElementIds(projection, source.id)).toEqual([
      firstId,
      secondId,
    ]);
  });

  it("projects shaped glyph outlines as disposable native Paths", () => {
    const base = projectDesignPage(createWelcomeDocument(), "page_welcome");
    const source = base.elementsById.get("title_welcome");
    if (!source) throw new Error("Missing title projection");
    const content = String(source.data.text);
    const glyphId = textRunFragmentElementId(source.id, 0);
    const projection = projectResolvedTextRuns(base, {
      documentId: base.documentId,
      pageId: base.pageId,
      revision: base.revision,
      resultsByNodeId: new Map([
        [
          source.id,
          {
            nodeId: source.id,
            fragments: [
              {
                baseline: 30,
                data: { fill: "#7c3aed" },
                end: content.length,
                glyphs: [
                  {
                    clusterEnd: content.length,
                    clusterStart: 0,
                    glyphId: 73,
                    path: "M0 0L20 0L20 30Z",
                    x: 4,
                    xAdvance: 22,
                    y: 2,
                    yAdvance: 0,
                  },
                ],
                height: 40,
                start: 0,
                text: content,
                width: 22,
                x: 10,
                y: 6,
              },
            ],
          },
        ],
      ]),
    });

    expect(projection.elementsById.get(glyphId)).toMatchObject({
      id: glyphId,
      kind: "path",
      parentId: source.parentId,
      tag: "Path",
      data: {
        fill: "#7c3aed",
        path: "M0 0L20 0L20 30Z",
        data: {
          opendesignGlyphId: 73,
          opendesignNodeId: source.id,
          opendesignSynthetic: true,
          opendesignTextRun: { start: 0, end: content.length },
        },
      },
    });
    expect(textRunEditProxyElementId(projection, glyphId)).toBe(source.id);
    expect(textRunFragmentElementIds(projection, source.id)).toEqual([glyphId]);
  });

  it("rejects stale document and revision identities", () => {
    const base = projectDesignPage(createWelcomeDocument(), "page_welcome");
    expect(() =>
      projectResolvedTextRuns(base, {
        documentId: "another-document",
        pageId: base.pageId,
        revision: base.revision,
        resultsByNodeId: new Map(),
      }),
    ).toThrow("cannot project document");
    expect(() =>
      projectResolvedTextRuns(base, {
        documentId: base.documentId,
        pageId: base.pageId,
        revision: base.revision + 1,
        resultsByNodeId: new Map(),
      }),
    ).toThrow("cannot project revision");
  });

  it("rejects incomplete or detached provider output", () => {
    const base = projectDesignPage(createWelcomeDocument(), "page_welcome");
    expect(() =>
      projectResolvedTextRuns(base, {
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
                  start: 0,
                  end: 1,
                  text: "D",
                  x: 0,
                  y: 0,
                  width: 10,
                  height: 20,
                  data: {},
                },
              ],
            },
          ],
        ]),
      }),
    ).toThrow("does not cover source text");
  });

  it("rejects equal-length fragments that do not preserve source characters", () => {
    const base = projectDesignPage(createWelcomeDocument(), "page_welcome");
    const source = base.elementsById.get("title_welcome");
    if (!source) throw new Error("Missing title projection");
    const content = String(source.data.text);
    expect(() =>
      projectResolvedTextRuns(base, {
        documentId: base.documentId,
        pageId: base.pageId,
        revision: base.revision,
        resultsByNodeId: new Map([
          [
            source.id,
            {
              nodeId: source.id,
              fragments: [
                {
                  start: 0,
                  end: content.length,
                  text: "x".repeat(content.length),
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 40,
                  data: {},
                },
              ],
            },
          ],
        ]),
      }),
    ).toThrow("fragments are invalid");
  });
});
