import {
  MIGRATABLE_DESIGN_SCHEMA_VERSIONS,
  isDesignTransaction,
  type DesignDocument,
  type DesignTransaction,
} from "@opendesign/design-contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolvePathPropertiesData } from "@opendesign/geometry-service/editable-vector";
import { diagnoseDesignPages } from "./diagnostics.js";
import {
  documentContentFingerprint,
  normalizeDesignDocument,
} from "./document.js";
import { EditorRuntime } from "./runtime.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = readJson<ProfessionalFixtureManifest>(
  "fixtures/professional/manifest.json",
);

describe("professional design fixtures", () => {
  it("pins the fixture and engine contract", () => {
    expect(manifest).toMatchObject({
      version: 1,
      engineBaseline: "leafer-editor@2.2.9",
    });
    expect(MIGRATABLE_DESIGN_SCHEMA_VERSIONS).toContain(
      manifest.documentSchemaVersion,
    );
    expect(manifest.fixtures.map((fixture) => fixture.id)).toEqual([
      "OD-PENGUIN-01",
      "OD-POSTER-01",
      "OD-BRAND-01",
    ]);
    expect(
      manifest.fixtures.every(
        (fixture) =>
          fixture.evidence.pixelBaseline === "pending" &&
          fixture.evidence.liveAgentReplay === "pending" &&
          fixture.evidence.professionalExport === "pending",
      ),
    ).toBe(true);
  });

  it.each(manifest.fixtures)(
    "$id replays through persistence and atomic history",
    (fixture) => {
      const initial = readDocument(fixture.files.initialDocument.path);
      const expectedFinal = readDocument(fixture.files.finalDocument.path);
      const refinement = readTransaction(
        fixture.files.refinementTransaction.path,
      );
      const runtime = new EditorRuntime(initial, {
        now: () => "2026-08-10T00:00:00.000Z",
      });

      expect(runtime.preview(refinement)).toMatchObject({
        ok: true,
        mode: "preview",
        revision: { revision: 1 },
      });
      expect(documentContentFingerprint(runtime.getSnapshot().document)).toBe(
        documentContentFingerprint(initial),
      );

      expect(runtime.apply(refinement)).toMatchObject({
        ok: true,
        mode: "apply",
        revision: { revision: 1 },
      });
      expect(documentContentFingerprint(runtime.getSnapshot().document)).toBe(
        documentContentFingerprint(expectedFinal),
      );
      expect(
        normalizeDesignDocument(
          JSON.parse(JSON.stringify(runtime.getSnapshot().document)),
        ),
      ).toEqual(runtime.getSnapshot().document);

      expect(runtime.undo()).toMatchObject({ ok: true, mode: "undo" });
      expect(documentContentFingerprint(runtime.getSnapshot().document)).toBe(
        documentContentFingerprint(initial),
      );
      expect(runtime.redo()).toMatchObject({ ok: true, mode: "redo" });
      expect(documentContentFingerprint(runtime.getSnapshot().document)).toBe(
        documentContentFingerprint(expectedFinal),
      );
    },
  );

  it.each(manifest.fixtures)(
    "$id satisfies its named hierarchy and render diagnostics",
    (fixture) => {
      const document = readDocument(fixture.files.finalDocument.path);
      const page = document.pagesById[fixture.pageId];
      const artboard = document.nodesById[fixture.artboardId];
      const composite = document.nodesById[fixture.compositeGroupId];

      expect(page?.rootNodeIds).toEqual([fixture.artboardId]);
      expect(artboard).toMatchObject({
        kind: "frame",
        parentId: null,
        size: fixture.artboard,
      });
      expect(composite).toMatchObject({
        kind: "group",
        parentId: fixture.artboardId,
      });
      expect(composite?.name.trim().length).toBeGreaterThan(0);

      for (const nodeId of fixture.requiredPathNodeIds) {
        const node = document.nodesById[nodeId];
        expect(node).toMatchObject({
          kind: "path",
        });
        expect(
          isWithinComposite(document, nodeId, fixture.compositeGroupId),
        ).toBe(true);
        if (node?.kind === "path") {
          expect(
            resolvePathPropertiesData(node.properties)?.trim().length,
          ).toBeGreaterThan(12);
        }
      }
      for (const nodeId of fixture.requiredBooleanNodeIds) {
        const node = document.nodesById[nodeId];
        expect(node).toMatchObject({
          kind: "boolean",
          parentId: fixture.compositeGroupId,
        });
        if (node?.kind === "boolean") {
          expect(node.childIds.length).toBeGreaterThanOrEqual(2);
          expect(node.properties).not.toHaveProperty("path");
        }
      }
      if (fixture.booleanExpectations) {
        expect(
          document.nodesById[fixture.booleanExpectations.nodeId],
        ).toMatchObject({
          kind: "boolean",
          properties: { operation: fixture.booleanExpectations.operation },
        });
      }

      const report = diagnoseDesignPages(document, [fixture.pageId]);
      expect(report).toMatchObject({ errorCount: 0, warningCount: 0 });
      for (const [feature, minimum] of Object.entries(
        fixture.minimumFeatures,
      )) {
        expect(
          report.features[feature as keyof typeof report.features],
          `${fixture.id} feature ${feature}`,
        ).toBeGreaterThanOrEqual(minimum);
      }
      expect(report.checkedNodeCount).toBe(
        Object.keys(document.nodesById).length,
      );
    },
  );
});

function readDocument(relativePath: string): DesignDocument {
  return normalizeDesignDocument(readJson(relativePath));
}

function isWithinComposite(
  document: DesignDocument,
  nodeId: string,
  compositeId: string,
): boolean {
  const seen = new Set<string>();
  let current = document.nodesById[nodeId];
  while (current?.parentId && !seen.has(current.parentId)) {
    if (current.parentId === compositeId) return true;
    seen.add(current.parentId);
    current = document.nodesById[current.parentId];
  }
  return false;
}

function readTransaction(relativePath: string): DesignTransaction {
  const value: unknown = readJson(relativePath);
  if (!isDesignTransaction(value)) {
    throw new Error(
      `Invalid professional fixture transaction: ${relativePath}`,
    );
  }
  return value;
}

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(
    readFileSync(join(repositoryRoot, relativePath), "utf8"),
  ) as T;
}

interface ProfessionalFixtureManifest {
  version: number;
  documentSchemaVersion: string;
  engineBaseline: string;
  fixtures: ProfessionalFixture[];
}

interface ProfessionalFixture {
  id: string;
  pageId: string;
  artboardId: string;
  compositeGroupId: string;
  requiredPathNodeIds: string[];
  requiredBooleanNodeIds: string[];
  booleanExpectations: {
    nodeId: string;
    operation: "union" | "subtract" | "intersect" | "exclude";
  } | null;
  minimumFeatures: Record<
    | "paths"
    | "gradients"
    | "glows"
    | "blurs"
    | "blends"
    | "masks"
    | "images"
    | "text",
    number
  >;
  artboard: { width: number; height: number };
  files: {
    initialDocument: FixtureArtifact;
    refinementTransaction: FixtureArtifact;
    finalDocument: FixtureArtifact;
  };
  evidence: {
    pixelBaseline: "pending";
    liveAgentReplay: "pending";
    professionalExport: "pending";
  };
}

interface FixtureArtifact {
  path: string;
  sha256: string;
}
