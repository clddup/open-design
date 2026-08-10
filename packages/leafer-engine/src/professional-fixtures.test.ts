import {
  isDesignDocument,
  type DesignDocument,
} from "@opendesign/design-contracts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { projectDesignPage } from "./mapping.js";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const manifest = readJson<ProfessionalFixtureManifest>(
  "fixtures/professional/manifest.json",
);

describe("professional fixture Leafer projection", () => {
  it.each(manifest.fixtures)(
    "$id projects every authoritative node without fidelity warnings",
    (fixture) => {
      const document = readDocument(fixture.files.finalDocument.path);
      const projection = projectDesignPage(document, fixture.pageId);

      expect(projection.rootIds).toEqual([fixture.artboardId]);
      expect(projection.warnings).toEqual([]);
      expect(projection.elementsById.size).toBe(
        Object.keys(document.nodesById).length,
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
          parentId: fixture.compositeGroupId,
        });
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
    },
  );
});

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
  projectionExpectations: {
    gradientNodeId: string;
    effectNodeId: string;
    maskNodeId: string | null;
    imageNodeId: string | null;
  };
  files: { finalDocument: { path: string } };
}
