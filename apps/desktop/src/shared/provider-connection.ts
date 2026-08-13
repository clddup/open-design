export type ProviderConnectionResult = {
  status: "compatible" | "text-only" | "unreachable";
  ok: boolean;
  message: string;
  providerId: string;
  modelId: string;
  latencyMs: number;
  textLatencyMs?: number;
  toolLatencyMs?: number;
};

export function isProviderConnectionResult(
  value: unknown,
): value is ProviderConnectionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const optionalKeys = ["textLatencyMs", "toolLatencyMs"].filter(
    (key) => result[key] !== undefined,
  );
  return (
    ["compatible", "text-only", "unreachable"].includes(
      String(result.status),
    ) &&
    result.ok === (result.status === "compatible") &&
    typeof result.message === "string" &&
    result.message.length > 0 &&
    result.message.length <= 2_000 &&
    isProviderId(result.providerId) &&
    isStableName(result.modelId, 256) &&
    isNonNegativeNumber(result.latencyMs) &&
    isOptionalNonNegativeNumber(result.textLatencyMs) &&
    isOptionalNonNegativeNumber(result.toolLatencyMs) &&
    hasExactKeys(result, [
      "status",
      "ok",
      "message",
      "providerId",
      "modelId",
      "latencyMs",
      ...optionalKeys,
    ])
  );
}

function isProviderId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/u.test(value)
  );
}

function isStableName(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    })
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isOptionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || isNonNegativeNumber(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}
