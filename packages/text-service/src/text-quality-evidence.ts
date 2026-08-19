export const TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION = 1 as const;
export const MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS = 4_096;

export type TextLayoutQualityAxis = {
  horizontal: boolean;
  vertical: boolean;
};

export type TextLayoutQualitySize = {
  width: number;
  height: number;
};

export type TextLayoutQualityMeasurement =
  | {
      status: "measured";
      nodeId: string;
      provider: string;
      providerVersion: string;
      boxSize: TextLayoutQualitySize;
      fullContentSize: TextLayoutQualitySize;
      displayedContentSize: TextLayoutQualitySize;
      overflow: TextLayoutQualityAxis;
      truncated: boolean;
    }
  | {
      status: "unavailable";
      nodeId: string;
      message: string;
    };

export interface TextLayoutQualityEvidence {
  version: typeof TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION;
  documentId: string;
  revision: number;
  pageId: string;
  measurements: TextLayoutQualityMeasurement[];
}

export function isTextLayoutQualityEvidence(
  value: unknown,
): value is TextLayoutQualityEvidence {
  const record = recordValue(value);
  return (
    record !== null &&
    record.version === TEXT_LAYOUT_QUALITY_EVIDENCE_VERSION &&
    safeText(record.documentId) &&
    Number.isSafeInteger(record.revision) &&
    Number(record.revision) >= 0 &&
    safeText(record.pageId) &&
    Array.isArray(record.measurements) &&
    record.measurements.length <= MAX_TEXT_LAYOUT_QUALITY_MEASUREMENTS &&
    record.measurements.every(isTextLayoutQualityMeasurement) &&
    new Set(
      record.measurements.map(
        (measurement: TextLayoutQualityMeasurement) => measurement.nodeId,
      ),
    ).size === record.measurements.length &&
    recordKeysOnly(record, [
      "version",
      "documentId",
      "revision",
      "pageId",
      "measurements",
    ])
  );
}

function isTextLayoutQualityMeasurement(value: unknown): boolean {
  const record = recordValue(value);
  if (!record || !safeText(record.nodeId)) return false;
  if (record.status === "unavailable") {
    return (
      safeText(record.message, 4_000) &&
      recordKeysOnly(record, ["status", "nodeId", "message"])
    );
  }
  return (
    record.status === "measured" &&
    safeText(record.provider) &&
    safeText(record.providerVersion) &&
    isFiniteSize(record.boxSize) &&
    isFiniteSize(record.fullContentSize) &&
    isFiniteSize(record.displayedContentSize) &&
    isAxis(record.overflow) &&
    typeof record.truncated === "boolean" &&
    recordKeysOnly(record, [
      "status",
      "nodeId",
      "provider",
      "providerVersion",
      "boxSize",
      "fullContentSize",
      "displayedContentSize",
      "overflow",
      "truncated",
    ])
  );
}

function isFiniteSize(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record !== null &&
    finiteDimension(record.width) &&
    finiteDimension(record.height) &&
    recordKeysOnly(record, ["width", "height"])
  );
}

function isAxis(value: unknown): boolean {
  const record = recordValue(value);
  return (
    record !== null &&
    typeof record.horizontal === "boolean" &&
    typeof record.vertical === "boolean" &&
    recordKeysOnly(record, ["horizontal", "vertical"])
  );
}

function finiteDimension(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1_000_000
  );
}

function safeText(value: unknown, maximum = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function recordKeysOnly(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
