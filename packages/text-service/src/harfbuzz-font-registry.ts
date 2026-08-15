import type * as HarfBuzz from "harfbuzzjs";
import type { TextRunLayoutStyle } from "./text-run-layout.js";

const SFNT_MAGIC = 0x0001_0000;
const TRUE_TYPE_COLLECTION_MAGIC = 0x7474_6366;
const OPEN_TYPE_MAGIC = 0x4f54_544f;
const TRUE_TYPE_MAGIC = 0x7472_7565;
const MAX_FONT_BYTES = 32 * 1024 * 1024;

type HarfBuzzModule = typeof HarfBuzz;

export interface HarfBuzzFontFaceDescriptor {
  family: string;
  faceIndex: number;
  fontId: string;
  postScriptName: string | null;
  slant: "italic" | "normal";
  styleName: string;
  unitsPerEm: number;
  weight: number;
}

export interface RegisteredHarfBuzzFace {
  blob: HarfBuzz.Blob;
  descriptor: HarfBuzzFontFaceDescriptor;
  face: HarfBuzz.Face;
}

export interface HarfBuzzFontRegistry {
  list(): readonly HarfBuzzFontFaceDescriptor[];
  register(
    fontId: string,
    bytes: Uint8Array,
  ): readonly HarfBuzzFontFaceDescriptor[];
  resolve(style: TextRunLayoutStyle): RegisteredHarfBuzzFace | undefined;
  unregister(fontId: string): void;
}

export function createHarfBuzzFontRegistry(
  hb: HarfBuzzModule,
): HarfBuzzFontRegistry {
  const facesByKey = new Map<string, RegisteredHarfBuzzFace[]>();
  const facesByFontId = new Map<string, RegisteredHarfBuzzFace[]>();
  const list = () =>
    [...facesByFontId.values()]
      .flatMap((faces) => faces.map((face) => face.descriptor))
      .sort((left, right) =>
        faceSortKey(left).localeCompare(faceSortKey(right)),
      );
  const unregister = (fontId: string) => {
    const registered = facesByFontId.get(fontId);
    if (!registered) return;
    facesByFontId.delete(fontId);
    for (const candidate of registered) {
      const key = descriptorKey(candidate.descriptor);
      const remaining = (facesByKey.get(key) ?? []).filter(
        (face) => face.descriptor.fontId !== fontId,
      );
      if (remaining.length === 0) facesByKey.delete(key);
      else facesByKey.set(key, remaining);
    }
  };
  const register = (fontId: string, bytes: Uint8Array) => {
    assertFontId(fontId);
    assertFontBytes(bytes);
    unregister(fontId);
    const blob = new hb.Blob(Uint8Array.from(bytes).buffer);
    const count = sfntFaceCount(bytes);
    const registered: RegisteredHarfBuzzFace[] = [];
    try {
      for (let faceIndex = 0; faceIndex < count; faceIndex += 1) {
        const face = new hb.Face(blob, faceIndex);
        registered.push({
          blob,
          descriptor: inspectFace(face, fontId, faceIndex),
          face,
        });
      }
    } catch (error) {
      throw new TypeError(
        error instanceof Error && error.message
          ? `Font binary is malformed: ${error.message}`
          : "Font binary is malformed",
      );
    }
    if (registered.length === 0)
      throw new TypeError("Font has no usable faces");
    facesByFontId.set(fontId, registered);
    for (const candidate of registered) {
      const key = descriptorKey(candidate.descriptor);
      const matches = [...(facesByKey.get(key) ?? []), candidate].sort(
        (left, right) =>
          faceSortKey(left.descriptor).localeCompare(
            faceSortKey(right.descriptor),
          ),
      );
      facesByKey.set(key, matches);
    }
    return registered.map((face) => face.descriptor);
  };
  return {
    list,
    register,
    resolve: (style) => facesByKey.get(harfBuzzStyleKey(style))?.[0],
    unregister,
  };
}

export function harfBuzzStyleKey(style: TextRunLayoutStyle): string {
  return [
    style.fontFamily,
    style.fontStyleName ?? "Regular",
    style.fontWeight,
    style.fontSlant,
  ]
    .map((part) => String(part).trim().toLocaleLowerCase("en-US"))
    .join("\u0000");
}

function inspectFace(
  face: HarfBuzz.Face,
  fontId: string,
  faceIndex: number,
): HarfBuzzFontFaceDescriptor {
  if (!Number.isFinite(face.upem) || face.upem <= 0) {
    throw new TypeError("Font face has no valid units-per-em");
  }
  if (face.collectUnicodes().length === 0) {
    throw new TypeError("Font face has no Unicode cmap");
  }
  const family = faceName(face, 16) ?? faceName(face, 1);
  const styleName = faceName(face, 17) ?? faceName(face, 2) ?? "Regular";
  if (!family) throw new TypeError("Font face has no family name");
  const os2 = face.referenceTable("OS/2");
  const weight =
    os2 && os2.byteLength >= 6
      ? clampInteger(
          new DataView(os2.buffer, os2.byteOffset, os2.byteLength).getUint16(4),
          1,
          1_000,
        )
      : 400;
  const selection =
    os2 && os2.byteLength >= 64
      ? new DataView(os2.buffer, os2.byteOffset, os2.byteLength).getUint16(62)
      : 0;
  return {
    family: boundedName(family),
    faceIndex,
    fontId,
    postScriptName: faceName(face, 6),
    slant:
      (selection & 1) === 1 || /italic|oblique/i.test(styleName)
        ? "italic"
        : "normal",
    styleName: boundedName(styleName),
    unitsPerEm: face.upem,
    weight,
  };
}

function faceName(face: HarfBuzz.Face, nameId: number): string | null {
  const candidates = face
    .listNames()
    .filter((entry) => entry.nameId === nameId);
  const preferred =
    candidates.find((entry) => /^en(?:-|$)/i.test(entry.language)) ??
    candidates[0];
  if (!preferred) return null;
  const value = face.getName(nameId, preferred.language).trim();
  return value ? boundedName(value) : null;
}

function sfntFaceCount(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0);
  if (magic === TRUE_TYPE_COLLECTION_MAGIC) {
    if (bytes.byteLength < 12) throw new TypeError("Truncated font collection");
    const count = view.getUint32(8);
    if (count < 1 || count > 256 || bytes.byteLength < 12 + count * 4) {
      throw new TypeError("Invalid font collection face count");
    }
    return count;
  }
  if (![SFNT_MAGIC, OPEN_TYPE_MAGIC, TRUE_TYPE_MAGIC].includes(magic)) {
    throw new TypeError("Unsupported SFNT signature");
  }
  return 1;
}

function assertFontBytes(bytes: Uint8Array): void {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 12 ||
    bytes.byteLength > MAX_FONT_BYTES
  ) {
    throw new RangeError("Font binary must be between 12 bytes and 32 MB");
  }
  sfntFaceCount(bytes);
}

function assertFontId(fontId: string): void {
  if (!/^font_[a-f0-9]{64}$/.test(fontId)) {
    throw new TypeError(
      "Font ID must be a content-addressed SHA-256 identifier",
    );
  }
}

function descriptorKey(descriptor: HarfBuzzFontFaceDescriptor): string {
  return [
    descriptor.family,
    descriptor.styleName,
    descriptor.weight,
    descriptor.slant,
  ]
    .map((part) => String(part).trim().toLocaleLowerCase("en-US"))
    .join("\u0000");
}

function faceSortKey(descriptor: HarfBuzzFontFaceDescriptor): string {
  return `${descriptorKey(descriptor)}\u0000${descriptor.fontId}\u0000${descriptor.faceIndex}`;
}

function boundedName(value: string): string {
  const normalized = [...value.normalize("NFC")]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 0x1f && code !== 0x7f;
    })
    .join("")
    .trim();
  if (!normalized || normalized.length > 512) {
    throw new TypeError("Font name is invalid");
  }
  return normalized;
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
