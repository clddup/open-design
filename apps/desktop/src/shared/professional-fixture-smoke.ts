import {
  isDesignDocument,
  isDesignTransaction,
  type DesignDocument,
  type DesignTransaction,
} from "@opendesign/design-contracts";

export const PROFESSIONAL_FIXTURE_IDS = [
  "OD-PENGUIN-01",
  "OD-POSTER-01",
  "OD-BRAND-01",
] as const;

export type ProfessionalFixtureId = (typeof PROFESSIONAL_FIXTURE_IDS)[number];

export type ProfessionalFixtureSmokeBootstrap = {
  fixtureId: ProfessionalFixtureId;
  pageId: string;
  artboardId: string;
  initialDocument: DesignDocument;
  refinement: DesignTransaction;
};

export type ProfessionalFixtureCaptureEvidence = {
  bytes: Uint8Array;
  width: number;
  height: number;
  mimeType: "image/jpeg";
};

export type ProfessionalFixtureSmokeResult =
  | {
      ok: true;
      fixtureId: ProfessionalFixtureId;
      devicePixelRatio: number;
      viewport: { width: number; height: number };
      initial: ProfessionalFixtureCaptureEvidence;
      refined: ProfessionalFixtureCaptureEvidence;
      finalDocument: DesignDocument;
    }
  | {
      ok: false;
      fixtureId: ProfessionalFixtureId;
      message: string;
    };

export function isProfessionalFixtureId(
  value: unknown,
): value is ProfessionalFixtureId {
  return PROFESSIONAL_FIXTURE_IDS.includes(value as ProfessionalFixtureId);
}

export function isProfessionalFixtureSmokeBootstrap(
  value: unknown,
): value is ProfessionalFixtureSmokeBootstrap {
  return (
    isRecord(value) &&
    isProfessionalFixtureId(value.fixtureId) &&
    safeId(value.pageId) &&
    safeId(value.artboardId) &&
    isDesignDocument(value.initialDocument) &&
    isDesignTransaction(value.refinement) &&
    Object.keys(value).every((key) =>
      [
        "fixtureId",
        "pageId",
        "artboardId",
        "initialDocument",
        "refinement",
      ].includes(key),
    )
  );
}

export function isProfessionalFixtureSmokeResult(
  value: unknown,
): value is ProfessionalFixtureSmokeResult {
  if (!isRecord(value) || !isProfessionalFixtureId(value.fixtureId)) {
    return false;
  }
  if (value.ok === false) {
    return (
      typeof value.message === "string" &&
      value.message.length > 0 &&
      value.message.length <= 4_000 &&
      onlyKeys(value, ["ok", "fixtureId", "message"])
    );
  }
  return (
    value.ok === true &&
    finitePositive(value.devicePixelRatio) &&
    isViewport(value.viewport) &&
    isCapture(value.initial) &&
    isCapture(value.refined) &&
    isDesignDocument(value.finalDocument) &&
    onlyKeys(value, [
      "ok",
      "fixtureId",
      "devicePixelRatio",
      "viewport",
      "initial",
      "refined",
      "finalDocument",
    ])
  );
}

function isCapture(
  value: unknown,
): value is ProfessionalFixtureCaptureEvidence {
  return (
    isRecord(value) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength > 0 &&
    value.bytes.byteLength <= 32 * 1024 * 1024 &&
    positiveInteger(value.width) &&
    positiveInteger(value.height) &&
    value.mimeType === "image/jpeg" &&
    onlyKeys(value, ["bytes", "width", "height", "mimeType"])
  );
}

function isViewport(
  value: unknown,
): value is { width: number; height: number } {
  return (
    isRecord(value) &&
    positiveInteger(value.width) &&
    positiveInteger(value.height) &&
    onlyKeys(value, ["width", "height"])
  );
}

function positiveInteger(value: unknown): value is number {
  return (
    Number.isInteger(value) && Number(value) > 0 && Number(value) <= 100_000
  );
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(value).every((key) => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
