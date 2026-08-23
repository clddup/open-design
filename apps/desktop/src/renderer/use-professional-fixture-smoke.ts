import type { EditorRuntime } from "@opendesign/editor-runtime";
import { useEffect, useRef } from "react";
import type { DesktopApi } from "../shared/desktop-api";
import type { ProfessionalFixtureSmokeBootstrap } from "../shared/professional-fixture-smoke";
import { captureDesignTarget } from "./features/design-tools/design-capture";

type FixtureSmokePresentation = (
  bootstrap: ProfessionalFixtureSmokeBootstrap,
) => void;

export function useProfessionalFixtureSmoke(input: {
  desktop: DesktopApi | undefined;
  activatePage: (pageId: string) => void;
  replaceDocument: (document: unknown, name?: string) => EditorRuntime;
  setView: () => void;
}): void {
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !input.desktop) return;
    started.current = true;
    const desktop = input.desktop;
    const present: FixtureSmokePresentation = (bootstrap) => {
      input.setView();
      input.activatePage(bootstrap.pageId);
    };
    void runProfessionalFixtureSmoke({ ...input, desktop, present }).catch(
      (error: unknown) => {
        console.error(
          `Professional fixture smoke failed before reporting: ${errorMessage(error)}`,
        );
      },
    );
  }, [input]);
}

export async function runProfessionalFixtureSmoke(input: {
  desktop: Pick<
    DesktopApi,
    "getProfessionalFixtureSmoke" | "reportProfessionalFixtureSmoke"
  >;
  present: FixtureSmokePresentation;
  replaceDocument: (document: unknown, name?: string) => EditorRuntime;
  nextPaint?: () => Promise<void>;
}): Promise<boolean> {
  const bootstrap = await input.desktop.getProfessionalFixtureSmoke();
  if (!bootstrap) return false;
  const nextPaint = input.nextPaint ?? waitForTwoAnimationFrames;
  try {
    const runtime = input.replaceDocument(
      bootstrap.initialDocument,
      `${bootstrap.fixtureId}-smoke.opendesign`,
    );
    input.present(bootstrap);
    await nextPaint();
    const initial = await captureDesignTarget(
      runtime.getSnapshot().document,
      captureTarget(bootstrap),
    );
    const preview = runtime.preview(bootstrap.refinement);
    if (!preview.ok) {
      throw new Error(
        `Fixture refinement preview failed: ${preview.error.message}`,
      );
    }
    const applied = runtime.apply(bootstrap.refinement);
    if (!applied.ok) {
      throw new Error(
        `Fixture refinement apply failed: ${applied.error.message}`,
      );
    }
    await nextPaint();
    const finalDocument = runtime.getSnapshot().document;
    const refined = await captureDesignTarget(
      finalDocument,
      captureTarget(bootstrap),
    );
    await nextPaint();
    await input.desktop.reportProfessionalFixtureSmoke({
      ok: true,
      fixtureId: bootstrap.fixtureId,
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      initial,
      refined,
      finalDocument,
    });
    return true;
  } catch (error) {
    await input.desktop.reportProfessionalFixtureSmoke({
      ok: false,
      fixtureId: bootstrap.fixtureId,
      message: errorMessage(error).slice(0, 4_000),
    });
    return false;
  }
}

function captureTarget(bootstrap: ProfessionalFixtureSmokeBootstrap) {
  return {
    kind: "frame" as const,
    pageId: bootstrap.pageId,
    nodeId: bootstrap.artboardId,
  };
}

function waitForTwoAnimationFrames(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => resolve()),
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
