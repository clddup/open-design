import type { Transform } from "@opendesign/design-contracts";

export function formatSvgNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function sanitizeSvgXmlId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_.-]/g, "_");
  return /^[A-Za-z_]/.test(sanitized) ? sanitized : `od_${sanitized}`;
}

export function serializeSvgMatrixAttribute(transform: Transform): string {
  return `matrix(${transform.map(formatSvgNumber).join(" ")})`;
}
