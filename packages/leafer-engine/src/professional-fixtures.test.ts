import {
  isDesignDocument,
  type DesignDocument,
} from "@opendesign/design-contracts";
import { createBooleanGeometryResolver } from "@opendesign/geometry-service/boolean-resolver";
import { createPathKitGeometryProvider } from "@opendesign/geometry-service/vector-path";
import type { VectorGeometryProvider } from "@opendesign/geometry-service/vector-path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  booleanResultElementId,
  projectDesignPage,
  projectResolvedBooleanGeometry,
} from "./mapping.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = readJson<ProfessionalFixtureManifest>(
  "fixtures/professional/manifest.json",
);
const require = createRequire(import.meta.url);
let geometryProvider: VectorGeometryProvider;

beforeAll(async () => {
  const wasmPath = require.resolve("pathkit-wasm/bin/pathkit.wasm");
  geometryProvider = await createPathKitGeometryProvider({
    wasmBinary: readFileSync(wasmPath),
  });
});

describe("professional fixture Leafer projection", () => {
  it.each(manifest.fixtures)(
    "$id projects every authoritative node without fidelity warnings",
    (fixture) => {
      const document = readDocument(fixture.files.finalDocument.path);
      const baseProjection = projectDesignPage(document, fixture.pageId);
      const resolution = createBooleanGeometryResolver(
        geometryProvider,
      ).resolve(document, fixture.pageId);
      const projection = projectResolvedBooleanGeometry(
        baseProjection,
        document,
        resolution,
      );

      expect(projection.rootIds).toEqual([fixture.artboardId]);
      expect(projection.warnings).toEqual([]);
      expect(projection.elementsById.size).toBe(
        Object.keys(document.nodesById).length +
          fixture.requiredBooleanNodeIds.length,
      );
      expect(
        projection.elementsById.get(fixture.compositeGroupId),
      ).toMatchObject({
        tag: "Group",
        parentId: fixture.artboardId,
      });

      for (const nodeId of fixture.requiredPathNodeIds) {
        const path = projection.elementsById.get(nodeId);
        expect(path).toMatchObject({
          tag: "Path",
        });
        expect(
          isWithinComposite(document, nodeId, fixture.compositeGroupId),
        ).toBe(true);
        expect(typeof path?.data.path).toBe("string");
      }

      const gradient = projection.elementsById.get(
        fixture.projectionExpectations.gradientNodeId,
      );
      expect(JSON.stringify(gradient?.data.fill)).toMatch(
        /"type":"(linear|radial|angular)"/,
      );
      const effect = projection.elementsById.get(
        fixture.projectionExpectations.effectNodeId,
      );
      expect(effect?.data.shadow).not.toBeNull();

      const maskNodeId = fixture.projectionExpectations.maskNodeId;
      if (maskNodeId) {
        expect(projection.elementsById.get(maskNodeId)?.data.mask).toBe(
          "grayscale",
        );
      }
      const imageNodeId = fixture.projectionExpectations.imageNodeId;
      if (imageNodeId) {
        const fill = projection.elementsById.get(imageNodeId)?.data.fill as
          { type?: unknown; url?: unknown } | undefined;
        expect(fill?.type).toBe("image");
        expect(typeof fill?.url).toBe("string");
        if (typeof fill?.url === "string") {
          expect(fill.url).toMatch(/^data:image\/png;base64,/);
        }
      }

      for (const booleanNodeId of fixture.requiredBooleanNodeIds) {
        const source = document.nodesById[booleanNodeId];
        const result = resolution.resultsByNodeId.get(booleanNodeId);
        const resultId = booleanResultElementId(booleanNodeId);
        expect(source).toMatchObject({ kind: "boolean" });
        expect(result).toMatchObject({
          empty: false,
          nodeId: booleanNodeId,
          provider: "skia-pathkit",
          providerVersion: "1.0.0",
        });
        expect(projection.elementsById.get(booleanNodeId)?.childIds[0]).toBe(
          resultId,
        );
        expect(projection.elementsById.get(resultId)).toMatchObject({
          kind: "path",
          parentId: booleanNodeId,
          tag: "Path",
          data: {
            editable: false,
            visible: true,
          },
        });
        source?.childIds.forEach((operandId) => {
          expect(projection.elementsById.get(operandId)?.data.visible).toBe(
            false,
          );
        });
      }

      if (fixture.booleanExpectations) {
        const result = resolution.resultsByNodeId.get(
          fixture.booleanExpectations.nodeId,
        );
        expect(result).toMatchObject({
          bounds: fixture.booleanExpectations.resultBounds,
          provider: fixture.booleanExpectations.provider,
          providerVersion: fixture.booleanExpectations.providerVersion,
        });
        expect(sha256(result?.path ?? "")).toBe(
          fixture.booleanExpectations.resultPathSha256,
        );
      }
    },
  );
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function readDocument(relativePath: string): DesignDocument {
  const value: unknown = readJson(relativePath);
  if (!isDesignDocument(value)) {
    throw new Error(`Invalid professional fixture document: ${relativePath}`);
  }
  return value;
}

function readJson<T = unknown>(relativePath: string): T {
  return JSON.parse(
    readFileSync(join(repositoryRoot, relativePath), "utf8"),
  ) as T;
}

interface ProfessionalFixtureManifest {
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
    provider: string;
    providerVersion: string;
    resultBounds: { x: number; y: number; width: number; height: number };
    resultPathSha256: string;
  } | null;
  projectionExpectations: {
    gradientNodeId: string;
    effectNodeId: string;
    maskNodeId: string | null;
    imageNodeId: string | null;
  };
  files: { finalDocument: { path: string } };
}
