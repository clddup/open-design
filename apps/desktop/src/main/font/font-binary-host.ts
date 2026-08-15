import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type {
  FontBinaryDescriptor,
  FontBinaryPayload,
} from "../../shared/desktop-api.js";

export const MAX_FONT_BINARY_BYTES = 32 * 1024 * 1024;
const fontIdPattern = /^font_([a-f0-9]{64})$/;
const metadataSuffix = ".font.json";

type StoredFontMetadata = FontBinaryDescriptor & { version: 1 };

export class FontBinaryHost {
  constructor(private readonly root: string) {}

  async importFiles(paths: readonly string[]): Promise<FontBinaryDescriptor[]> {
    if (paths.length > 16) throw new RangeError("Select at most 16 font files");
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const result: FontBinaryDescriptor[] = [];
    const seen = new Set<string>();
    for (const path of paths) {
      const file = await stat(path);
      if (!file.isFile()) throw new TypeError("Font import must target a file");
      assertFontSize(file.size);
      const bytes = await readFile(path);
      assertFontSize(bytes.byteLength);
      const format = detectFontFormat(bytes, path);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const fontId = `font_${digest}` as const;
      if (seen.has(fontId)) continue;
      seen.add(fontId);
      const descriptor: FontBinaryDescriptor = {
        byteSize: bytes.byteLength,
        fontId,
        format,
        name: boundedFileName(path),
      };
      await writeContentAddressedFile(join(this.root, digest), bytes);
      await writeContentAddressedFile(
        join(this.root, `${digest}${metadataSuffix}`),
        Buffer.from(
          JSON.stringify({
            ...descriptor,
            version: 1,
          } satisfies StoredFontMetadata),
          "utf8",
        ),
      );
      result.push(descriptor);
    }
    return result;
  }

  async list(): Promise<FontBinaryDescriptor[]> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const entries = await readdir(this.root);
    const descriptors: FontBinaryDescriptor[] = [];
    for (const entry of entries.sort()) {
      if (!entry.endsWith(metadataSuffix)) continue;
      try {
        const value: unknown = JSON.parse(
          await readFile(join(this.root, entry), "utf8"),
        );
        if (!isStoredFontMetadata(value)) continue;
        const digest = fontIdPattern.exec(value.fontId)?.[1];
        if (!digest || entry !== `${digest}${metadataSuffix}`) continue;
        const content = await stat(join(this.root, digest));
        if (content.isFile() && content.size === value.byteSize) {
          descriptors.push(snapshot(value));
        }
      } catch {
        // Ignore incomplete or corrupt entries; read() remains strict.
      }
    }
    return descriptors;
  }

  async read(fontId: string): Promise<FontBinaryPayload> {
    const digest = fontIdPattern.exec(fontId)?.[1];
    if (!digest) throw new TypeError("Invalid font ID");
    const metadata: unknown = JSON.parse(
      await readFile(join(this.root, `${digest}${metadataSuffix}`), "utf8"),
    );
    if (!isStoredFontMetadata(metadata) || metadata.fontId !== fontId) {
      throw new TypeError("Stored font metadata is invalid");
    }
    const bytes = await readFile(join(this.root, digest));
    assertFontSize(bytes.byteLength);
    if (bytes.byteLength !== metadata.byteSize) {
      throw new TypeError("Stored font size does not match metadata");
    }
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (
      actualDigest !== digest ||
      detectFontFormat(bytes, metadata.name) !== metadata.format
    ) {
      throw new TypeError("Stored font content failed integrity validation");
    }
    return { ...snapshot(metadata), bytes: Uint8Array.from(bytes) };
  }
}

function detectFontFormat(
  bytes: Uint8Array,
  path: string,
): FontBinaryDescriptor["format"] {
  if (bytes.byteLength < 12) throw new TypeError("Font binary is truncated");
  const magic = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0);
  const extension = extname(path).toLowerCase();
  if (magic === 0x7474_6366 && extension === ".ttc") return "ttc";
  if (magic === 0x4f54_544f && extension === ".otf") return "otf";
  if (
    (magic === 0x0001_0000 || magic === 0x7472_7565) &&
    extension === ".ttf"
  ) {
    return "ttf";
  }
  throw new TypeError("Fonts must be valid TTF, OTF, or TTC files");
}

function assertFontSize(size: number): void {
  if (
    !Number.isSafeInteger(size) ||
    size < 12 ||
    size > MAX_FONT_BINARY_BYTES
  ) {
    throw new RangeError("Font files must be between 12 bytes and 32 MB");
  }
}

function boundedFileName(path: string): string {
  const name = basename(path).normalize("NFC");
  if (!name || name.length > 255 || hasControlCharacter(name)) {
    throw new TypeError("Font file name is invalid");
  }
  return name;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

function isStoredFontMetadata(value: unknown): value is StoredFontMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return (
    metadata.version === 1 &&
    typeof metadata.fontId === "string" &&
    fontIdPattern.test(metadata.fontId) &&
    typeof metadata.name === "string" &&
    metadata.name.length > 0 &&
    metadata.name.length <= 255 &&
    Number.isSafeInteger(metadata.byteSize) &&
    Number(metadata.byteSize) >= 12 &&
    Number(metadata.byteSize) <= MAX_FONT_BINARY_BYTES &&
    (metadata.format === "ttf" ||
      metadata.format === "otf" ||
      metadata.format === "ttc") &&
    Object.keys(metadata).every((key) =>
      ["version", "fontId", "name", "byteSize", "format"].includes(key),
    )
  );
}

function snapshot(value: StoredFontMetadata): FontBinaryDescriptor {
  return {
    byteSize: value.byteSize,
    fontId: value.fontId,
    format: value.format,
    name: value.name,
  };
}

async function writeContentAddressedFile(
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}
