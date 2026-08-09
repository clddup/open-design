import {
  MAX_AGENT_ATTACHMENTS,
  MAX_AGENT_ATTACHMENT_BYTES,
  type AgentAttachment,
  type AgentDocumentAttachment,
  type AgentImageAttachment,
} from "@opendesign/agent-contracts";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

const MAX_TOTAL_ATTACHMENT_BYTES = 32 * 1024 * 1024;
const MAX_EXTRACTED_DOCUMENT_CHARACTERS = 200_000;
const MAX_DOCX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_DOCX_ENTRIES = 2_048;
const attachmentIdPattern = /^(image|file)_([a-f0-9]{64})$/;

type AttachmentMimeType = AgentAttachment["mimeType"];
type DocumentMimeType = AgentDocumentAttachment["mimeType"];

export type SelectedAgentAttachment = AgentAttachment & {
  previewDataUrl?: string;
};

export type ResolvedAgentAttachment =
  | {
      kind: "image";
      data: string;
      mimeType: AgentImageAttachment["mimeType"];
      byteSize: number;
    }
  | {
      kind: "document";
      text: string;
      mimeType: DocumentMimeType;
      byteSize: number;
      truncated: boolean;
      extractedCharacterCount: number;
    };

type StoredAttachmentMetadata = {
  version: 1;
  mimeType: AttachmentMimeType;
  byteSize: number;
  truncated?: boolean;
  extractedCharacterCount?: number;
};

type DocumentExtraction = {
  text: string;
  truncated: boolean;
  extractedCharacterCount: number;
};

export class AgentAttachmentHost {
  constructor(private readonly root: string) {}

  async importFiles(
    paths: readonly string[],
  ): Promise<SelectedAgentAttachment[]> {
    if (paths.length > MAX_AGENT_ATTACHMENTS) {
      throw new RangeError(
        `Select at most ${MAX_AGENT_ATTACHMENTS} attachments`,
      );
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const result: SelectedAgentAttachment[] = [];
    const seen = new Set<string>();
    let totalBytes = 0;
    for (const path of paths) {
      const file = await stat(path);
      if (!file.isFile()) throw new TypeError("Attachment must be a file");
      assertAttachmentSize(file.size);
      const bytes = await readFile(path);
      assertAttachmentSize(bytes.byteLength);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
        throw new RangeError("Attachments exceed the 32 MB total limit");
      }

      const mimeType = detectAttachmentMimeType(bytes, path);
      if (!mimeType) {
        throw new TypeError(
          "Attachments must be PNG, JPEG, WebP, GIF, PDF, DOCX, Markdown, text, CSV, HTML, JSON, or YAML files",
        );
      }
      const image = isImageMimeType(mimeType);
      const digest = attachmentDigest(bytes, image ? undefined : mimeType);
      const attachmentId = `${image ? "image" : "file"}_${digest}`;
      if (seen.has(attachmentId)) continue;
      seen.add(attachmentId);

      let extraction: DocumentExtraction | undefined;
      if (!image) extraction = await extractDocument(bytes, mimeType);
      await writeContentAddressedFile(join(this.root, digest), bytes);
      await writeContentAddressedFile(
        join(this.root, `${digest}.meta.json`),
        Buffer.from(
          JSON.stringify({
            version: 1,
            mimeType,
            byteSize: bytes.byteLength,
            ...(extraction === undefined
              ? {}
              : {
                  truncated: extraction.truncated,
                  extractedCharacterCount: extraction.extractedCharacterCount,
                }),
          } satisfies StoredAttachmentMetadata),
          "utf8",
        ),
      );
      if (extraction) {
        await writeContentAddressedFile(
          join(this.root, `${digest}.txt`),
          Buffer.from(extraction.text, "utf8"),
        );
      }

      result.push({
        attachmentId,
        name: basename(path).slice(0, 255),
        mimeType,
        byteSize: bytes.byteLength,
        ...(image
          ? {
              previewDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
            }
          : {}),
      });
    }
    return result;
  }

  async importImageBytes(
    name: string,
    value: Uint8Array,
  ): Promise<AgentImageAttachment & { previewDataUrl: string }> {
    const bytes = Buffer.from(value);
    assertAttachmentSize(bytes.byteLength);
    const mimeType = sniffImageMimeType(bytes);
    if (!mimeType) throw new TypeError("Reference is not a supported image");
    const digest = attachmentDigest(bytes);
    const attachmentId = `image_${digest}`;
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeContentAddressedFile(join(this.root, digest), bytes);
    await writeContentAddressedFile(
      join(this.root, `${digest}.meta.json`),
      Buffer.from(
        JSON.stringify({
          version: 1,
          mimeType,
          byteSize: bytes.byteLength,
        } satisfies StoredAttachmentMetadata),
        "utf8",
      ),
    );
    return {
      attachmentId,
      name: basename(name || "reference-image").slice(0, 255),
      mimeType,
      byteSize: bytes.byteLength,
      previewDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    };
  }

  async importBytes(
    name: string,
    value: Uint8Array,
  ): Promise<SelectedAgentAttachment> {
    const bytes = Buffer.from(value);
    assertAttachmentSize(bytes.byteLength);
    const mimeType = detectAttachmentMimeType(bytes, name);
    if (!mimeType) {
      throw new TypeError(
        "Attachment must be a supported image, PDF, DOCX, Markdown, text, CSV, HTML, JSON, or YAML file",
      );
    }
    const image = isImageMimeType(mimeType);
    const digest = attachmentDigest(bytes, image ? undefined : mimeType);
    const attachmentId = `${image ? "image" : "file"}_${digest}`;
    let extraction: DocumentExtraction | undefined;
    if (!image) extraction = await extractDocument(bytes, mimeType);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await writeContentAddressedFile(join(this.root, digest), bytes);
    await writeContentAddressedFile(
      join(this.root, `${digest}.meta.json`),
      Buffer.from(
        JSON.stringify({
          version: 1,
          mimeType,
          byteSize: bytes.byteLength,
          ...(extraction === undefined
            ? {}
            : {
                truncated: extraction.truncated,
                extractedCharacterCount: extraction.extractedCharacterCount,
              }),
        } satisfies StoredAttachmentMetadata),
        "utf8",
      ),
    );
    if (extraction) {
      await writeContentAddressedFile(
        join(this.root, `${digest}.txt`),
        Buffer.from(extraction.text, "utf8"),
      );
    }
    return {
      attachmentId,
      name: basename(name || "clipboard-attachment").slice(0, 255),
      mimeType,
      byteSize: bytes.byteLength,
      ...(image
        ? {
            previewDataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
          }
        : {}),
    };
  }

  async resolve(attachmentId: string): Promise<ResolvedAgentAttachment> {
    const match = attachmentIdPattern.exec(attachmentId);
    const kind = match?.[1];
    const digest = match?.[2];
    if (!kind || !digest) throw new TypeError("Invalid Agent attachment ID");
    const bytes = await readFile(join(this.root, digest));
    assertAttachmentSize(bytes.byteLength, "Stored Agent attachment");

    if (kind === "image") {
      const actualDigest = attachmentDigest(bytes);
      if (actualDigest !== digest) {
        throw new Error("Stored Agent attachment failed its integrity check");
      }
      const mimeType = sniffImageMimeType(bytes);
      if (!mimeType)
        throw new TypeError("Stored Agent image format is invalid");
      return {
        kind: "image",
        data: bytes.toString("base64"),
        mimeType,
        byteSize: bytes.byteLength,
      };
    }

    const metadata = await readMetadata(join(this.root, `${digest}.meta.json`));
    if (isImageMimeType(metadata.mimeType)) {
      throw new TypeError("Stored Agent document metadata is invalid");
    }
    if (
      metadata.byteSize !== bytes.byteLength ||
      attachmentDigest(bytes, metadata.mimeType) !== digest
    ) {
      throw new Error("Stored Agent attachment failed its integrity check");
    }
    const text = await readFile(join(this.root, `${digest}.txt`), "utf8");
    if (
      typeof metadata.truncated !== "boolean" ||
      typeof metadata.extractedCharacterCount !== "number" ||
      !Number.isInteger(metadata.extractedCharacterCount) ||
      metadata.extractedCharacterCount < text.length
    ) {
      throw new TypeError("Stored Agent document metadata is invalid");
    }
    return {
      kind: "document",
      text,
      mimeType: metadata.mimeType,
      byteSize: metadata.byteSize,
      truncated: metadata.truncated,
      extractedCharacterCount: metadata.extractedCharacterCount,
    };
  }

  async preview(attachmentId: string): Promise<string | null> {
    const resolved = await this.resolve(attachmentId);
    return resolved.kind === "image"
      ? `data:${resolved.mimeType};base64,${resolved.data}`
      : null;
  }
}

async function extractDocument(
  bytes: Buffer,
  mimeType: DocumentMimeType,
): Promise<DocumentExtraction> {
  let text: string;
  if (mimeType === "application/pdf") {
    const result = await extractPdfText(Uint8Array.from(bytes), {
      mergePages: true,
    });
    text = result.text;
  } else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    validateDocxArchive(bytes);
    const result = await mammoth.extractRawText({ buffer: bytes });
    const extractionError = result.messages.find(
      (message) => message.type === "error",
    );
    if (extractionError) throw new Error(extractionError.message);
    text = result.value;
  } else {
    text = decodeUtf8Text(bytes);
  }

  const normalized = text
    .replaceAll("\u0000", "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .trim();
  if (!normalized) {
    throw new TypeError("Attachment document contains no extractable text");
  }
  const extractedCharacterCount = normalized.length;
  const truncated = extractedCharacterCount > MAX_EXTRACTED_DOCUMENT_CHARACTERS;
  return {
    text: truncated
      ? `${normalized.slice(0, MAX_EXTRACTED_DOCUMENT_CHARACTERS)}\n\n[Document truncated by OpenDesign]`
      : normalized,
    truncated,
    extractedCharacterCount,
  };
}

function detectAttachmentMimeType(
  bytes: Buffer,
  path: string,
): AttachmentMimeType | undefined {
  const image = sniffImageMimeType(bytes);
  if (image) return image;
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") {
    return "application/pdf";
  }
  const extension = extname(path).toLowerCase();
  if (extension === ".docx" && isZipArchive(bytes)) {
    validateDocxArchive(bytes);
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  const textMimeTypes: Readonly<Record<string, DocumentMimeType>> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".json": "application/json",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
  };
  const textMimeType = textMimeTypes[extension];
  if (!textMimeType) return undefined;
  decodeUtf8Text(bytes);
  return textMimeType;
}

function decodeUtf8Text(bytes: Buffer): string {
  if (bytes.includes(0)) throw new TypeError("Text attachment is binary");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new TypeError("Text attachment must use UTF-8 encoding");
  }
}

function isZipArchive(bytes: Buffer): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08)
  );
}

function validateDocxArchive(bytes: Buffer): void {
  if (!isZipArchive(bytes)) throw new TypeError("DOCX attachment is invalid");
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new TypeError("DOCX attachment is invalid");
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralSize = bytes.readUInt32LE(endOffset + 12);
  const centralOffset = bytes.readUInt32LE(endOffset + 16);
  if (
    entryCount < 1 ||
    entryCount > MAX_DOCX_ENTRIES ||
    centralOffset + centralSize > bytes.length
  ) {
    throw new RangeError("DOCX attachment archive exceeds safety limits");
  }

  let offset = centralOffset;
  let expandedBytes = 0;
  let hasDocumentXml = false;
  for (let index = 0; index < entryCount; index += 1) {
    if (
      offset + 46 > bytes.length ||
      bytes.readUInt32LE(offset) !== 0x02014b50
    ) {
      throw new TypeError("DOCX attachment is invalid");
    }
    const flags = bytes.readUInt16LE(offset + 8);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const nextOffset = offset + 46 + nameLength + extraLength + commentLength;
    if ((flags & 0x1) !== 0 || nextOffset > bytes.length) {
      throw new TypeError(
        "Encrypted or malformed DOCX attachments are unsupported",
      );
    }
    expandedBytes += uncompressedSize;
    if (
      expandedBytes > MAX_DOCX_EXPANDED_BYTES ||
      (compressedSize === 0 && uncompressedSize > 0) ||
      (compressedSize > 0 && uncompressedSize / compressedSize > 200)
    ) {
      throw new RangeError("DOCX attachment archive exceeds safety limits");
    }
    const name = bytes.toString("utf8", offset + 46, offset + 46 + nameLength);
    if (name.includes("..") || name.startsWith("/") || name.includes("\\")) {
      throw new TypeError("DOCX attachment contains an unsafe entry path");
    }
    if (name === "word/document.xml") hasDocumentXml = true;
    offset = nextOffset;
  }
  if (!hasDocumentXml) throw new TypeError("DOCX attachment is invalid");
}

function attachmentDigest(bytes: Buffer, mimeType?: DocumentMimeType): string {
  const hash = createHash("sha256");
  if (mimeType) hash.update(mimeType).update("\0");
  return hash.update(bytes).digest("hex");
}

function assertAttachmentSize(
  byteSize: number,
  label = "Each attachment",
): void {
  if (byteSize < 1 || byteSize > MAX_AGENT_ATTACHMENT_BYTES) {
    throw new RangeError(
      `${label} must be smaller than ${MAX_AGENT_ATTACHMENT_BYTES / 1024 / 1024} MB`,
    );
  }
}

async function readMetadata(path: string): Promise<StoredAttachmentMetadata> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new TypeError("Stored Agent attachment metadata is invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored Agent attachment metadata is invalid");
  }
  const metadata = value as Record<string, unknown>;
  if (
    metadata.version !== 1 ||
    !isAttachmentMimeType(metadata.mimeType) ||
    !Number.isInteger(metadata.byteSize) ||
    Number(metadata.byteSize) < 1 ||
    Number(metadata.byteSize) > MAX_AGENT_ATTACHMENT_BYTES
  ) {
    throw new TypeError("Stored Agent attachment metadata is invalid");
  }
  return metadata as StoredAttachmentMetadata;
}

async function writeContentAddressedFile(
  path: string,
  bytes: Buffer,
): Promise<void> {
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
  }
}

function isAttachmentMimeType(value: unknown): value is AttachmentMimeType {
  return (
    typeof value === "string" &&
    (isImageMimeType(value) ||
      [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "text/plain",
        "text/markdown",
        "text/csv",
        "text/html",
        "application/json",
        "application/yaml",
      ].includes(value))
  );
}

function isImageMimeType(
  value: unknown,
): value is AgentImageAttachment["mimeType"] {
  return (
    value === "image/png" ||
    value === "image/jpeg" ||
    value === "image/webp" ||
    value === "image/gif"
  );
}

function sniffImageMimeType(
  bytes: Buffer,
): AgentImageAttachment["mimeType"] | undefined {
  if (
    bytes.length >= 8 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    (bytes.toString("ascii", 0, 6) === "GIF87a" ||
      bytes.toString("ascii", 0, 6) === "GIF89a")
  ) {
    return "image/gif";
  }
  return undefined;
}
