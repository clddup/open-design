import {
  canonicalJsonStringify,
  documentContentFingerprint,
  normalizeDesignDocument,
} from "@opendesign/editor-runtime";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  isProfessionalFixtureId,
  isProfessionalFixtureSmokeResult,
  type ProfessionalFixtureId,
  type ProfessionalFixtureSmokeBootstrap,
  type ProfessionalFixtureSmokeResult,
} from "../shared/professional-fixture-smoke";
import { isDesignTransaction } from "@opendesign/design-contracts";
import type { App, BrowserWindow, IpcMainInvokeEvent } from "electron";

const MAX_FIXTURE_FILE_BYTES = 32 * 1024 * 1024;

type ProfessionalFixtureSmokeIpcRegistrar = {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  ): void;
};

export type ProfessionalFixtureSmokeConfiguration = {
  fixtureId: ProfessionalFixtureId;
  outputRoot: string;
};

type ProfessionalFixtureSmokeHost = {
  register: (
    ipc: ProfessionalFixtureSmokeIpcRegistrar,
    app: App,
    assertRenderer: (event: Electron.IpcMainInvokeEvent) => void,
    getWindow: () => BrowserWindow | null,
  ) => void;
  startTimeout: (exit: (code: number) => void) => void;
};

export type ProfessionalFixtureSmokeApplication = {
  active: boolean;
  home: string;
  path: (...segments: string[]) => string;
  register: (
    ipc: ProfessionalFixtureSmokeIpcRegistrar,
    assertRenderer: (event: Electron.IpcMainInvokeEvent) => void,
    getWindow: () => BrowserWindow | null,
  ) => void;
  startTimeout: () => void;
  show: (window: BrowserWindow | null) => void;
};

export type ProfessionalFixtureSmokeReport = {
  version: 1;
  fixtureId: ProfessionalFixtureId;
  ok: boolean;
  platform: NodeJS.Platform;
  appVersion: string;
  devicePixelRatio?: number;
  viewport?: { width: number; height: number };
  revision?: number;
  captures?: {
    initial: { file: string; width: number; height: number; sha256: string };
    refined: { file: string; width: number; height: number; sha256: string };
    window: { file: string; sha256: string };
  };
  finalDocument?: { file: string; sha256: string };
  message?: string;
};

export function resolveProfessionalFixtureSmokeConfiguration(
  environment: NodeJS.ProcessEnv,
): ProfessionalFixtureSmokeConfiguration | null {
  const fixtureValue = environment.OPENDESIGN_PROFESSIONAL_FIXTURE_SMOKE;
  const outputValue = environment.OPENDESIGN_PROFESSIONAL_FIXTURE_OUTPUT;
  if (fixtureValue === undefined && outputValue === undefined) return null;
  if (!isProfessionalFixtureId(fixtureValue)) {
    throw new Error("Invalid professional fixture smoke ID");
  }
  if (!outputValue || !isAbsolute(outputValue)) {
    throw new Error("Professional fixture smoke output must be absolute");
  }
  return { fixtureId: fixtureValue, outputRoot: resolve(outputValue) };
}

export function configureFixtureSmoke(
  app: App,
  environment: NodeJS.ProcessEnv,
  defaultHome: string,
): ProfessionalFixtureSmokeApplication {
  const configuration =
    resolveProfessionalFixtureSmokeConfiguration(environment);
  const host = createProfessionalFixtureSmokeHost(configuration);
  if (configuration) {
    app.setPath("userData", join(configuration.outputRoot, "user-data"));
  }
  return {
    active: configuration !== null,
    home: configuration ? join(configuration.outputRoot, "home") : defaultHome,
    path: (...segments) =>
      join(
        configuration ? join(configuration.outputRoot, "home") : defaultHome,
        ...segments,
      ),
    register: (ipc, assertRenderer, getWindow) =>
      host.register(ipc, app, assertRenderer, getWindow),
    startTimeout: () => host.startTimeout((code) => app.exit(code)),
    show: (window) => {
      if (!configuration) window?.show();
    },
  };
}

function createProfessionalFixtureSmokeHost(
  configuration: ProfessionalFixtureSmokeConfiguration | null,
): ProfessionalFixtureSmokeHost {
  let reported = false;
  return {
    register(ipc, app, assertRenderer, getWindow) {
      const fixtureOwnerRoot = app.isPackaged
        ? process.resourcesPath
        : join(app.getAppPath(), "../..");
      ipc.handle(
        "professional-fixture-smoke:get",
        async (event, ...args: unknown[]) => {
          assertRenderer(event);
          assertArgumentCount(args, 0);
          if (!configuration) return null;
          return loadProfessionalFixtureSmoke(
            fixtureOwnerRoot,
            configuration.fixtureId,
          );
        },
      );
      ipc.handle(
        "professional-fixture-smoke:report",
        async (event, ...args: unknown[]) => {
          assertRenderer(event);
          assertArgumentCount(args, 1);
          if (!configuration) {
            throw new Error("Professional fixture smoke is unavailable");
          }
          if (reported) {
            throw new Error("Professional fixture smoke was already reported");
          }
          const result = args[0];
          if (
            !isProfessionalFixtureSmokeResult(result) ||
            result.fixtureId !== configuration.fixtureId
          ) {
            throw new TypeError("Invalid professional fixture smoke result");
          }
          reported = true;
          try {
            await requireProfessionalFixtureSmokeFinalDocument(
              fixtureOwnerRoot,
              result,
            );
            const window = getWindow();
            const windowPng = window
              ? await window.webContents
                  .capturePage()
                  .then((image) => image.toPNG())
              : new Uint8Array();
            const report = await writeProfessionalFixtureSmokeEvidence({
              result,
              outputRoot: configuration.outputRoot,
              platform: process.platform,
              appVersion: app.getVersion(),
              windowPng,
            });
            console.log(
              `Professional fixture smoke ${report.ok ? "passed" : "failed"}: ${report.fixtureId} ${configuration.outputRoot}`,
            );
            setImmediate(() => app.exit(report.ok ? 0 : 1));
          } catch (error) {
            console.error(
              `Professional fixture smoke evidence failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            setImmediate(() => app.exit(1));
            throw error;
          }
        },
      );
    },
    startTimeout(exit) {
      if (!configuration) return;
      setTimeout(() => {
        if (reported) return;
        console.error("Professional fixture smoke timed out after 90 seconds");
        exit(1);
      }, 90_000).unref();
    },
  };
}

export async function loadProfessionalFixtureSmoke(
  repositoryRoot: string,
  fixtureId: ProfessionalFixtureId,
): Promise<ProfessionalFixtureSmokeBootstrap> {
  const fixtureRoot = join(
    repositoryRoot,
    "fixtures",
    "professional",
    fixtureId,
  );
  const [manifestText, initialText, refinementText] = await Promise.all([
    readBoundedText(
      join(repositoryRoot, "fixtures", "professional", "manifest.json"),
    ),
    readBoundedText(join(fixtureRoot, "initial.opendesign")),
    readBoundedText(join(fixtureRoot, "refinement.transaction.json")),
  ]);
  const manifest = JSON.parse(manifestText) as unknown;
  const fixture = fixtureManifestEntry(manifest, fixtureId);
  const initialDocument = normalizeDesignDocument(JSON.parse(initialText));
  const refinement = JSON.parse(refinementText) as unknown;
  if (!isDesignTransaction(refinement)) {
    throw new TypeError(`Invalid refinement transaction for ${fixtureId}`);
  }
  if (initialDocument.pagesById[fixture.pageId] === undefined) {
    throw new Error(`Fixture Page is unavailable: ${fixture.pageId}`);
  }
  if (initialDocument.nodesById[fixture.artboardId]?.kind !== "frame") {
    throw new Error(
      `Fixture artboard Frame is unavailable: ${fixture.artboardId}`,
    );
  }
  return {
    fixtureId,
    pageId: fixture.pageId,
    artboardId: fixture.artboardId,
    initialDocument,
    refinement,
  };
}

export async function writeProfessionalFixtureSmokeEvidence(input: {
  result: ProfessionalFixtureSmokeResult;
  outputRoot: string;
  platform: NodeJS.Platform;
  appVersion: string;
  windowPng: Uint8Array;
}): Promise<ProfessionalFixtureSmokeReport> {
  await mkdir(input.outputRoot, { recursive: true });
  if (!input.result.ok) {
    const report: ProfessionalFixtureSmokeReport = {
      version: 1,
      fixtureId: input.result.fixtureId,
      ok: false,
      platform: input.platform,
      appVersion: input.appVersion,
      message: input.result.message,
    };
    await writeReport(input.outputRoot, report);
    return report;
  }

  const initialFile = "initial.jpg";
  const refinedFile = "refined.jpg";
  const windowFile = "window.png";
  const finalFile = "final.opendesign";
  const finalBytes = Buffer.from(
    `${canonicalJsonStringify(input.result.finalDocument)}\n`,
  );
  await Promise.all([
    writeFile(join(input.outputRoot, initialFile), input.result.initial.bytes),
    writeFile(join(input.outputRoot, refinedFile), input.result.refined.bytes),
    writeFile(join(input.outputRoot, windowFile), input.windowPng),
    writeFile(join(input.outputRoot, finalFile), finalBytes),
  ]);
  const report: ProfessionalFixtureSmokeReport = {
    version: 1,
    fixtureId: input.result.fixtureId,
    ok: true,
    platform: input.platform,
    appVersion: input.appVersion,
    devicePixelRatio: input.result.devicePixelRatio,
    viewport: input.result.viewport,
    revision: input.result.finalDocument.revision,
    captures: {
      initial: {
        file: initialFile,
        width: input.result.initial.width,
        height: input.result.initial.height,
        sha256: sha256(input.result.initial.bytes),
      },
      refined: {
        file: refinedFile,
        width: input.result.refined.width,
        height: input.result.refined.height,
        sha256: sha256(input.result.refined.bytes),
      },
      window: { file: windowFile, sha256: sha256(input.windowPng) },
    },
    finalDocument: { file: finalFile, sha256: sha256(finalBytes) },
  };
  await writeReport(input.outputRoot, report);
  return report;
}

export async function requireProfessionalFixtureSmokeFinalDocument(
  repositoryRoot: string,
  result: ProfessionalFixtureSmokeResult,
): Promise<void> {
  if (!result.ok) return;
  const expectedText = await readBoundedText(
    join(
      repositoryRoot,
      "fixtures",
      "professional",
      result.fixtureId,
      "document.opendesign",
    ),
  );
  const expected = normalizeDesignDocument(JSON.parse(expectedText));
  if (
    documentContentFingerprint(result.finalDocument) !==
    documentContentFingerprint(expected)
  ) {
    throw new Error(
      `Professional fixture smoke final document does not match ${result.fixtureId}`,
    );
  }
}

async function readBoundedText(path: string): Promise<string> {
  const bytes = await readFile(path);
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FIXTURE_FILE_BYTES) {
    throw new Error(`Professional fixture file size is invalid: ${path}`);
  }
  return bytes.toString("utf8");
}

function fixtureManifestEntry(
  value: unknown,
  fixtureId: ProfessionalFixtureId,
): { pageId: string; artboardId: string } {
  if (!isRecord(value) || !Array.isArray(value.fixtures)) {
    throw new TypeError("Invalid professional fixture manifest");
  }
  const fixtures: unknown[] = value.fixtures;
  const fixture = fixtures.find(
    (candidate) => isRecord(candidate) && candidate.id === fixtureId,
  );
  if (
    !isRecord(fixture) ||
    !safeIdentifier(fixture.pageId) ||
    !safeIdentifier(fixture.artboardId)
  ) {
    throw new TypeError(
      `Invalid professional fixture manifest entry: ${fixtureId}`,
    );
  }
  return { pageId: fixture.pageId, artboardId: fixture.artboardId };
}

function safeIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function assertArgumentCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError("Unexpected IPC arguments");
}

async function writeReport(
  outputRoot: string,
  report: ProfessionalFixtureSmokeReport,
): Promise<void> {
  await writeFile(
    join(outputRoot, "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}
