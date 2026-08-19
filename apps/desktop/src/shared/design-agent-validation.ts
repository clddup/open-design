import type { Point } from "@opendesign/design-contracts";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function safeLabel(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}

export function safePageName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 256 &&
    !/\p{Cc}/u.test(value)
  );
}

export function optionalIndex(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && Number(value) >= 0);
}

export function onlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function finiteBoundedPoint(
  value: unknown,
  maximum: number,
): value is Point {
  return (
    isRecord(value) &&
    finiteBounded(value.x, maximum) &&
    finiteBounded(value.y, maximum) &&
    exactKeys(value, ["x", "y"])
  );
}

export function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

export function positiveBounded(
  value: unknown,
  maximum: number,
): value is number {
  return positive(value) && value <= maximum;
}

export function finiteBounded(
  value: unknown,
  maximum: number,
): value is number {
  return finite(value) && Math.abs(value) <= maximum;
}

export function boundedText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

export function substantiveReviewText(value: unknown): value is string {
  if (!boundedText(value, 1_000) || value.trim().length < 12) return false;
  return !/^(?:looks? good|fine|great|okay|ok|no issues?|很好|不错|没问题|可以|正常)[.!。！\s]*$/i.test(
    value.trim(),
  );
}

export function boundedTextArray(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumTextLength: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= minimumItems &&
    value.length <= maximumItems &&
    value.every((item) => boundedText(item, maximumTextLength))
  );
}
