import type { DesignDocument } from "@opendesign/design-contracts";
import {
  BOOLEAN_GEOMETRY_RESOLVER_VERSION,
  type BooleanGeometryResolution,
} from "@opendesign/geometry-service/boolean-resolver";
import { exportSvg } from "@opendesign/import-export-service";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_SVG_EXPORT_PADDING,
  MAX_SVG_EXPORT_TITLE_CHARACTERS,
  createWelcomeDocument,
  getNodeBounds,
  getWorldTransform,
  multiplyTransforms,
  normalizeDesignDocument,
  planSvgExportRequest,
  type SvgExportBooleanSnapshot,
} from "./index.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

function input(
  document: DesignDocument,
  rootNodeIds: readonly string[],
  overrides: Partial<Parameters<typeof planSvgExportRequest>[1]> = {},
): Parameters<typeof planSvgExportRequest>[1] {
  return {
    pageId: "page_welcome",
    rootNodeIds,
    baseRevision: document.revision,
    ...overrides,
  };
}

function brandDocument(): DesignDocument {
  return normalizeDesignDocument(
    JSON.parse(
      readFileSync(
        join(
          repositoryRoot,
          "fixtures/professional/OD-BRAND-01/document.opendesign",
        ),
        "utf8",
      ),
    ) as unknown,
  );
}

function brandBooleanResolution(): BooleanGeometryResolution {
  return {
    computedNodeIds: ["brand_mark"],
    issues: [],
    pageId: "page_brand_01",
    resolverVersion: BOOLEAN_GEOMETRY_RESOLVER_VERSION,
    resultsByNodeId: new Map([
      [
        "brand_mark",
        {
          nodeId: "brand_mark",
          bounds: { x: 0, y: 0, width: 280, height: 280 },
          empty: false,
          fillRule: "nonzero",
          path: "M 0 0 H 280 V 280 H 0 Z",
          provider: "skia-pathkit",
          providerVersion: "1.0.0",
        },
      ],
    ]),
    reusedNodeIds: [],
  };
}

function booleanSnapshot(document: DesignDocument): SvgExportBooleanSnapshot {
  return {
    documentId: document.documentId,
    revision: document.revision,
    resolution: brandBooleanResolution(),
  };
}

describe("SVG export request planner", () => {
  it("exports one nested layer at an origin-normalized viewport", () => {
    const document = createWelcomeDocument();
    const plan = planSvgExportRequest(
      document,
      input(document, ["feature_one"], {
        settings: {
          includeLayerIds: true,
          title: "  Structured card  ",
        },
      }),
    );

    expect(plan).toMatchObject({
      ok: true,
      documentId: document.documentId,
      revision: document.revision,
      pageId: "page_welcome",
      rootNodeIds: ["feature_one"],
      sourceBounds: { x: 144, y: 404, width: 304, height: 220 },
      request: {
        rootNodeIds: ["feature_one"],
        viewport: { x: 0, y: 0, width: 304, height: 220 },
        rootTransformOverrides: {
          feature_one: [1, 0, 0, 1, 0, 0],
        },
        includeLayerIds: true,
        title: "Structured card",
      },
    });
    if (!plan.ok) return;
    expect(plan.request.document).toBe(document);

    const exported = exportSvg(plan.request);
    expect(exported).toMatchObject({
      ok: true,
      exportedNodeIds: ["feature_one"],
      viewport: { x: 0, y: 0, width: 304, height: 220 },
      issues: [],
    });
    if (!exported.ok) return;
    expect(exported.svg).toContain('viewBox="0 0 304 220"');
    expect(exported.svg).toContain("<title>Structured card</title>");
    expect(exported.svg).toContain('data-opendesign-id="feature_one"');
    expect(exported.svg).not.toContain("feature_two");
  });

  it("uses canvas paint order and supports explicit padding for a composite selection", () => {
    const document = createWelcomeDocument();
    const plan = planSvgExportRequest(
      document,
      input(document, ["feature_three", "feature_one"], {
        settings: { padding: 10 },
      }),
    );

    expect(plan).toMatchObject({
      ok: true,
      rootNodeIds: ["feature_one", "feature_three"],
      sourceBounds: { x: 144, y: 404, width: 892, height: 220 },
      request: {
        viewport: { x: 0, y: 0, width: 912, height: 240 },
        rootTransformOverrides: {
          feature_one: [1, 0, 0, 1, 10, 10],
          feature_three: [1, 0, 0, 1, 730, 34],
        },
      },
    });
    if (!plan.ok) return;
    const exported = exportSvg(plan.request);
    expect(exported).toMatchObject({
      ok: true,
      exportedNodeIds: ["feature_one", "feature_three"],
    });
  });

  it("derives Group bounds from rendered children but preserves selected Frame dimensions", () => {
    const document = createWelcomeDocument();
    const groupPlan = planSvgExportRequest(
      document,
      input(document, ["feature_group"]),
    );
    expect(groupPlan).toMatchObject({
      ok: true,
      sourceBounds: { x: 144, y: 404, width: 892, height: 220 },
      request: {
        viewport: { x: 0, y: 0, width: 892, height: 220 },
        rootTransformOverrides: {
          feature_group: [1, 0, 0, 1, 0, 0],
        },
      },
    });

    const framePlan = planSvgExportRequest(
      document,
      input(document, ["frame_welcome"]),
    );
    expect(framePlan).toMatchObject({
      ok: true,
      sourceBounds: { x: 80, y: 64, width: 1120, height: 720 },
      request: {
        viewport: { x: 0, y: 0, width: 1120, height: 720 },
        rootTransformOverrides: {
          frame_welcome: [1, 0, 0, 1, 0, 0],
        },
      },
    });
  });

  it("preserves nested affine geometry while normalizing the artifact origin", () => {
    const changed = structuredClone(createWelcomeDocument());
    changed.nodesById.frame_welcome!.transform = [
      0.8660254, 0.5, -0.5, 0.8660254, 120, 72,
    ];
    changed.nodesById.feature_group!.transform = [1.1, 0.2, -0.1, 0.9, 64, 340];
    const document = normalizeDesignDocument(changed);
    const bounds = getNodeBounds(document, "feature_one")!;
    const world = getWorldTransform(document, "feature_one")!;
    const expected = multiplyTransforms(
      [1, 0, 0, 1, -bounds.x, -bounds.y],
      world,
    );
    const plan = planSvgExportRequest(
      document,
      input(document, ["feature_one"]),
    );

    expect(plan).toMatchObject({ ok: true, sourceBounds: bounds });
    if (!plan.ok) return;
    expect(plan.request.rootTransformOverrides?.feature_one).toEqual(expected);
    expect(plan.request.viewport.width).toBeCloseTo(bounds.width, 10);
    expect(plan.request.viewport.height).toBeCloseTo(bounds.height, 10);
  });

  it("allows locked read-only targets without changing document state", () => {
    const locked = structuredClone(createWelcomeDocument());
    locked.nodesById.feature_one!.locked = true;
    const document = normalizeDesignDocument(locked);
    const before = JSON.stringify(document);
    expect(
      planSvgExportRequest(document, input(document, ["feature_one"])),
    ).toMatchObject({ ok: true });
    expect(JSON.stringify(document)).toBe(before);
  });

  it("rejects stale, missing, cross-page, duplicate, nested, and empty selections", () => {
    const document = createWelcomeDocument();
    expect(
      planSvgExportRequest(
        document,
        input(document, ["feature_one"], { baseRevision: -1 }),
      ),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(planSvgExportRequest(document, input(document, []))).toMatchObject({
      ok: false,
      code: "invalid-selection",
    });
    expect(
      planSvgExportRequest(
        document,
        input(document, ["feature_one", "feature_one"]),
      ),
    ).toMatchObject({ ok: false, code: "invalid-selection" });
    expect(
      planSvgExportRequest(document, input(document, ["missing_node"])),
    ).toMatchObject({ ok: false, code: "not-found" });
    expect(
      planSvgExportRequest(
        document,
        input(document, ["frame_welcome", "feature_one"]),
      ),
    ).toMatchObject({ ok: false, code: "invalid-selection" });

    const crossPage = structuredClone(document);
    crossPage.pageOrder.push("page_other");
    crossPage.pagesById.page_other = {
      id: "page_other",
      name: "Other",
      rootNodeIds: [],
      extensions: {},
    };
    const normalized = normalizeDesignDocument(crossPage);
    expect(
      planSvgExportRequest(
        normalized,
        input(normalized, ["feature_one"], { pageId: "page_other" }),
      ),
    ).toMatchObject({ ok: false, code: "out-of-scope" });
  });

  it("rejects invalid padding, titles, and zero-area artifacts", () => {
    const document = createWelcomeDocument();
    for (const padding of [
      -1,
      Number.POSITIVE_INFINITY,
      MAX_SVG_EXPORT_PADDING + 1,
    ]) {
      expect(
        planSvgExportRequest(
          document,
          input(document, ["feature_one"], { settings: { padding } }),
        ),
      ).toMatchObject({ ok: false, code: "invalid-settings" });
    }
    expect(
      planSvgExportRequest(
        document,
        input(document, ["feature_one"], {
          settings: { title: "x".repeat(MAX_SVG_EXPORT_TITLE_CHARACTERS + 1) },
        }),
      ),
    ).toMatchObject({ ok: false, code: "invalid-settings" });

    const empty = structuredClone(document);
    empty.nodesById.feature_one!.size = { width: 0, height: 0 };
    expect(
      planSvgExportRequest(
        normalizeDesignDocument(empty),
        input(empty, ["feature_one"]),
      ),
    ).toMatchObject({ ok: false, code: "invalid-bounds" });
  });

  it("binds Boolean geometry to the exact document revision and Page", () => {
    const document = brandDocument();
    const baseInput = {
      pageId: "page_brand_01",
      rootNodeIds: ["brand_mark"],
      baseRevision: document.revision,
    } as const;

    expect(planSvgExportRequest(document, baseInput)).toMatchObject({
      ok: false,
      code: "invalid-geometry",
    });
    expect(
      planSvgExportRequest(document, {
        ...baseInput,
        booleanSnapshot: {
          ...booleanSnapshot(document),
          revision: document.revision - 1,
        },
      }),
    ).toMatchObject({ ok: false, code: "conflict" });
    expect(
      planSvgExportRequest(document, {
        ...baseInput,
        booleanSnapshot: {
          ...booleanSnapshot(document),
          resolution: {
            ...brandBooleanResolution(),
            issues: [
              {
                code: "provider-failure",
                message: "Path operation failed",
                nodeId: "brand_mark",
              },
            ],
          },
        },
      }),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });
    const incompatibleResolution = {
      ...brandBooleanResolution(),
      resolverVersion: 999,
    } as unknown as BooleanGeometryResolution;
    expect(
      planSvgExportRequest(document, {
        ...baseInput,
        booleanSnapshot: {
          ...booleanSnapshot(document),
          resolution: incompatibleResolution,
        },
      }),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });

    const plan = planSvgExportRequest(document, {
      ...baseInput,
      booleanSnapshot: booleanSnapshot(document),
      settings: { includeLayerIds: true },
    });
    expect(plan).toMatchObject({
      ok: true,
      sourceBounds: { x: 124, y: 146, width: 288, height: 288 },
      request: {
        viewport: { x: 0, y: 0, width: 288, height: 288 },
        rootTransformOverrides: { brand_mark: [1, 0, 0, 1, 4, 4] },
        resolvedBooleanPaths: {
          brand_mark: {
            path: "M 0 0 H 280 V 280 H 0 Z",
            provider: "skia-pathkit",
            providerVersion: "1.0.0",
          },
        },
      },
    });
    if (!plan.ok) return;
    const exported = exportSvg(plan.request);
    expect(exported).toMatchObject({
      ok: true,
      exportedNodeIds: ["brand_mark"],
    });
    if (!exported.ok) return;
    expect(exported.issues.map((issue) => issue.code)).toEqual([
      "effect-omitted",
      "angular-gradient-flattened",
      "stroke-alignment-flattened",
      "boolean-flattened",
    ]);
    expect(exported.svg).not.toContain("brand_mark_outer");
  });

  it("requires Boolean geometry for a selected container's rendered subtree", () => {
    const document = brandDocument();
    expect(
      planSvgExportRequest(document, {
        pageId: "page_brand_01",
        rootNodeIds: ["brand_artboard"],
        baseRevision: document.revision,
      }),
    ).toMatchObject({ ok: false, code: "invalid-geometry" });
  });
});
