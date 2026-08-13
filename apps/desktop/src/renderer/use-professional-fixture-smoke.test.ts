import { isDesignTransaction } from "@opendesign/design-contracts";
import {
  EditorRuntime,
  normalizeDesignDocument,
} from "@opendesign/editor-runtime";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ProfessionalFixtureSmokeBootstrap,
  ProfessionalFixtureSmokeResult,
} from "../shared/professional-fixture-smoke";
import * as designCapture from "./design-capture";
import { runProfessionalFixtureSmoke } from "./use-professional-fixture-smoke";

vi.mock("./design-capture", { spy: true });

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const capture = vi.mocked(designCapture.captureDesignTarget);

beforeEach(() => {
  capture.mockReset();
  capture.mockResolvedValue({
    bytes: new Uint8Array([1, 2, 3]),
    width: 760,
    height: 760,
    mimeType: "image/jpeg",
  });
});

describe("professional fixture smoke renderer", () => {
  it("uses the workspace runtime for initial and refined production captures", async () => {
    const bootstrap = await fixture("OD-PENGUIN-01");
    const report = vi
      .fn<(result: ProfessionalFixtureSmokeResult) => Promise<void>>()
      .mockResolvedValue(undefined);
    const runtime = new EditorRuntime(bootstrap.initialDocument);
    const replaceDocument = vi.fn().mockReturnValue(runtime);
    const present = vi.fn();
    await expect(
      runProfessionalFixtureSmoke({
        desktop: {
          getProfessionalFixtureSmoke: vi.fn().mockResolvedValue(bootstrap),
          reportProfessionalFixtureSmoke: report,
        },
        replaceDocument,
        present,
        nextPaint: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe(true);
    expect(replaceDocument).toHaveBeenCalledWith(
      bootstrap.initialDocument,
      "OD-PENGUIN-01-smoke.opendesign",
    );
    expect(present).toHaveBeenCalledWith(bootstrap);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls[0]?.[0].revision).toBe(0);
    expect(capture.mock.calls[1]?.[0].revision).toBe(1);
    const result = report.mock.calls[0]?.[0];
    expect(result?.ok).toBe(true);
    expect(result?.fixtureId).toBe("OD-PENGUIN-01");
    expect(result?.ok ? result.finalDocument.revision : undefined).toBe(1);
  });

  it("reports capture failure instead of claiming completion", async () => {
    const bootstrap = await fixture("OD-PENGUIN-01");
    capture.mockRejectedValueOnce(new Error("capture unavailable"));
    const report = vi
      .fn<(result: ProfessionalFixtureSmokeResult) => Promise<void>>()
      .mockResolvedValue(undefined);
    await expect(
      runProfessionalFixtureSmoke({
        desktop: {
          getProfessionalFixtureSmoke: vi.fn().mockResolvedValue(bootstrap),
          reportProfessionalFixtureSmoke: report,
        },
        replaceDocument: () => new EditorRuntime(bootstrap.initialDocument),
        present: vi.fn(),
        nextPaint: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe(false);
    expect(report).toHaveBeenCalledWith({
      ok: false,
      fixtureId: "OD-PENGUIN-01",
      message: "capture unavailable",
    });
  });
});

async function fixture(
  fixtureId: "OD-PENGUIN-01",
): Promise<ProfessionalFixtureSmokeBootstrap> {
  const fixtureRoot = resolve(
    repositoryRoot,
    "fixtures/professional",
    fixtureId,
  );
  const [initial, refinement] = await Promise.all([
    readFile(resolve(fixtureRoot, "initial.opendesign"), "utf8"),
    readFile(resolve(fixtureRoot, "refinement.transaction.json"), "utf8"),
  ]);
  const initialValue: unknown = JSON.parse(initial);
  const refinementValue: unknown = JSON.parse(refinement);
  if (!isDesignTransaction(refinementValue)) {
    throw new TypeError(`Invalid fixture transaction: ${fixtureId}`);
  }
  return {
    fixtureId,
    pageId: "page_penguin_01",
    artboardId: "penguin_artboard",
    initialDocument: normalizeDesignDocument(initialValue),
    refinement: refinementValue,
  };
}
