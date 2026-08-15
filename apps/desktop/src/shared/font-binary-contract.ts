export type FontBinaryDescriptor = {
  byteSize: number;
  fontId: `font_${string}`;
  format: "otf" | "ttc" | "ttf";
  name: string;
};

export type FontBinaryPayload = FontBinaryDescriptor & {
  bytes: Uint8Array;
};

export type FontBinaryReadRequest = { fontId: `font_${string}` };

export function isFontBinaryDescriptor(
  value: unknown,
): value is FontBinaryDescriptor {
  return (
    isRecord(value) &&
    hasFontBinaryDescriptorFields(value) &&
    hasExactKeys(value, ["fontId", "name", "byteSize", "format"])
  );
}

export function isFontBinaryPayload(
  value: unknown,
): value is FontBinaryPayload {
  return (
    isRecord(value) &&
    hasFontBinaryDescriptorFields(value) &&
    value.bytes instanceof Uint8Array &&
    value.bytes.byteLength === value.byteSize &&
    hasExactKeys(value, ["fontId", "name", "byteSize", "format", "bytes"])
  );
}

export function isFontBinaryReadRequest(
  value: unknown,
): value is FontBinaryReadRequest {
  return (
    isRecord(value) &&
    typeof value.fontId === "string" &&
    /^font_[a-f0-9]{64}$/.test(value.fontId) &&
    hasExactKeys(value, ["fontId"])
  );
}

function hasFontBinaryDescriptorFields(
  value: Record<string, unknown>,
): boolean {
  return (
    typeof value.fontId === "string" &&
    /^font_[a-f0-9]{64}$/.test(value.fontId) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 255 &&
    !hasControlCharacter(value.name) &&
    Number.isSafeInteger(value.byteSize) &&
    Number(value.byteSize) >= 12 &&
    Number(value.byteSize) <= 32 * 1024 * 1024 &&
    (value.format === "ttf" || value.format === "otf" || value.format === "ttc")
  );
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
