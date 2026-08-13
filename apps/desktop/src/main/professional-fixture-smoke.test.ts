import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadProfessionalFixtureSmoke,
  requireProfessionalFixtureSmokeFinalDocument,
  resolveProfessionalFixtureSmokeConfiguration,
  writeProfessionalFixtureSmokeEvidence,
} from "./professional-fixture-smoke";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("professional fixture smoke host", () => {
  it("requires a fixed fixture ID and an absolute output directory", () => {
    expect(resolveProfessionalFixtureSmokeConfiguration({})).toBeNull();
    expect(() =>
      resolveProfessionalFixtureSmokeConfiguration({
        OPENDESIGN_PROFESSIONAL_FIXTURE_SMOKE: "../../private",
        OPENDESIGN_PROFESSIONAL_FIXTURE_OUTPUT: "/tmp/output",
      }),
    ).toThrow("Invalid professional fixture smoke ID");
    expect(() =>
      resolveProfessionalFixtureSmokeConfiguration({
        OPENDESIGN_PROFESSIONAL_FIXTURE_SMOKE: "OD-PENGUIN-01",
        OPENDESIGN_PROFESSIONAL_FIXTURE_OUTPUT: "relative/output",
      }),
    ).toThrow("output must be absolute");
  });

  it.each(["OD-PENGUIN-01", "OD-POSTER-01"] as const)(
    "loads %s from repository-owned paths",
    async (fixtureId) => {
      const bootstrap = await loadProfessionalFixtureSmoke(
        repositoryRoot,
        fixtureId,
      );
      expect(bootstrap).toMatchObject({ fixtureId });
      expect(
        bootstrap.initialDocument.pagesById[bootstrap.pageId],
      ).toBeDefined();
      expect(
        bootstrap.initialDocument.nodesById[bootstrap.artboardId]?.kind,
      ).toBe("frame");
      expect(bootstrap.refinement.baseRevision).toBe(
        bootstrap.initialDocument.revision,
      );
    },
  );

  it("writes fixed evidence names, hashes and final revision", async () => {
    const outputRoot = await temporaryDirectory();
    const bootstrap = await loadProfessionalFixtureSmoke(
      repositoryRoot,
      "OD-PENGUIN-01",
    );
    const finalDocument = {
      ...bootstrap.initialDocument,
      revision: bootstrap.initialDocument.revision + 1,
    };
    const report = await writeProfessionalFixtureSmokeEvidence({
      result: {
        ok: true,
        fixtureId: bootstrap.fixtureId,
        devicePixelRatio: 2,
        viewport: { width: 1440, height: 920 },
        initial: capture([1, 2, 3]),
        refined: capture([4, 5, 6]),
        finalDocument,
      },
      outputRoot,
      platform: "darwin",
      appVersion: "0.0.0",
      windowPng: new Uint8Array([7, 8, 9]),
    });
    expect(report).toMatchObject({
      ok: true,
      fixtureId: "OD-PENGUIN-01",
      revision: finalDocument.revision,
      captures: {
        initial: { file: "initial.jpg" },
        refined: { file: "refined.jpg" },
        window: { file: "window.png" },
      },
      finalDocument: { file: "final.opendesign" },
    });
    const persisted = JSON.parse(
      await readFile(resolve(outputRoot, "report.json"), "utf8"),
    ) as { finalDocument: { sha256: string } };
    expect(persisted.finalDocument.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a renderer result that does not match the authoritative final fixture", async () => {
    const bootstrap = await loadProfessionalFixtureSmoke(
      repositoryRoot,
      "OD-PENGUIN-01",
    );
    await expect(
      requireProfessionalFixtureSmokeFinalDocument(repositoryRoot, {
        ok: true,
        fixtureId: bootstrap.fixtureId,
        devicePixelRatio: 2,
        viewport: { width: 1440, height: 920 },
        initial: capture([1]),
        refined: capture([2]),
        finalDocument: bootstrap.initialDocument,
      }),
    ).rejects.toThrow("does not match OD-PENGUIN-01");
  });
});

function capture(bytes: number[]) {
  return {
    bytes: new Uint8Array(bytes),
    width: 760,
    height: 760,
    mimeType: "image/jpeg" as const,
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    resolve(tmpdir(), "opendesign-professional-smoke-test-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}
