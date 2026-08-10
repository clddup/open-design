import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentAttachmentHost } from "./agent-attachment-host";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function minimalPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function minimalDocx(text: string): Buffer {
  return storedZip([
    {
      name: "[Content_Types].xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    },
    {
      name: "_rels/.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    },
    {
      name: "word/document.xml",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:sectPr/></w:body></w:document>`,
    },
    {
      name: "word/_rels/document.xml.rels",
      text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`,
    },
  ]);
}

function storedZip(entries: Array<{ name: string; text: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.text, "utf8");
    const checksum = crc32(data);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralParts.push(centralHeader, name);
    localOffset += localHeader.byteLength + name.byteLength + data.byteLength;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe("AgentAttachmentHost", () => {
  it("imports a selected image into content-addressed local storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-image-host-"));
    const source = join(root, "Inspiration.png");
    await writeFile(source, png);
    const host = new AgentAttachmentHost(join(root, "attachments"));

    const selected = await host.importFiles([source]);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      name: "Inspiration.png",
      mimeType: "image/png",
      byteSize: png.byteLength,
    });
    expect(selected[0]?.attachmentId).toMatch(/^image_[a-f0-9]{64}$/);
    expect(selected[0]?.previewDataUrl).toBe(
      `data:image/png;base64,${png.toString("base64")}`,
    );
    await expect(host.resolve(selected[0].attachmentId)).resolves.toEqual({
      kind: "image",
      data: png.toString("base64"),
      mimeType: "image/png",
      byteSize: png.byteLength,
    });
  });

  it("extracts a selected product brief as read-only document context", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-attachment-host-"));
    const source = join(root, "product-brief.md");
    const content = "# Checkout\n\nDesign a calm mobile checkout flow.";
    await writeFile(source, content);
    const host = new AgentAttachmentHost(join(root, "attachments"));

    const selected = await host.importFiles([source]);

    expect(selected[0]).toMatchObject({
      name: "product-brief.md",
      mimeType: "text/markdown",
      byteSize: Buffer.byteLength(content),
    });
    expect(selected[0]?.attachmentId).toMatch(/^file_[a-f0-9]{64}$/);
    expect(selected[0]?.previewDataUrl).toBeUndefined();
    await expect(host.resolve(selected[0].attachmentId)).resolves.toEqual({
      kind: "document",
      text: content,
      mimeType: "text/markdown",
      byteSize: Buffer.byteLength(content),
      truncated: false,
      extractedCharacterCount: content.length,
    });
    await expect(host.preview(selected[0].attachmentId)).resolves.toBeNull();
  });

  it("stores SVG as a dedicated handle without projecting XML as document context", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-svg-host-"));
    const source = join(root, "brand-mark.svg");
    const svg = '<svg viewBox="0 0 64 64"><path d="M0 0H64V64Z"/></svg>';
    await writeFile(source, svg);
    const host = new AgentAttachmentHost(join(root, "attachments"));

    const selected = await host.importFiles([source]);

    expect(selected[0]).toMatchObject({
      name: "brand-mark.svg",
      mimeType: "image/svg+xml",
      byteSize: Buffer.byteLength(svg),
    });
    expect(selected[0]?.attachmentId).toMatch(/^svg_[a-f0-9]{64}$/);
    expect(selected[0]?.previewDataUrl).toBeUndefined();
    await expect(host.resolve(selected[0].attachmentId)).resolves.toEqual({
      kind: "svg",
      svg,
      mimeType: "image/svg+xml",
      byteSize: Buffer.byteLength(svg),
    });
    await expect(
      host.resolveModelAttachment(selected[0].attachmentId),
    ).rejects.toThrow("typed SVG import tool");
    await expect(host.preview(selected[0].attachmentId)).resolves.toBeNull();
  });

  it("extracts text from a selected PDF by content rather than extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-attachment-host-"));
    const source = join(root, "product-brief.bin");
    const pdf = minimalPdf("Design a focused onboarding flow");
    await writeFile(source, pdf);
    const host = new AgentAttachmentHost(join(root, "attachments"));

    const selected = await host.importFiles([source]);
    const resolved = await host.resolve(selected[0].attachmentId);

    expect(selected[0]).toMatchObject({
      name: "product-brief.bin",
      mimeType: "application/pdf",
      byteSize: pdf.byteLength,
    });
    expect(resolved).toMatchObject({
      kind: "document",
      mimeType: "application/pdf",
      truncated: false,
    });
    expect(resolved.kind === "document" ? resolved.text : "").toContain(
      "Design a focused onboarding flow",
    );
  });

  it("validates and extracts a selected DOCX product brief", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-attachment-host-"));
    const source = join(root, "product-brief.docx");
    const docx = minimalDocx("Design an accessible account settings page");
    await writeFile(source, docx);
    const host = new AgentAttachmentHost(join(root, "attachments"));

    const selected = await host.importFiles([source]);
    const resolved = await host.resolve(selected[0].attachmentId);

    expect(selected[0]).toMatchObject({
      name: "product-brief.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    expect(resolved.kind === "document" ? resolved.text : "").toContain(
      "Design an accessible account settings page",
    );
  });

  it("rejects a DOCX archive with a traversal entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-attachment-host-"));
    const source = join(root, "unsafe.docx");
    await writeFile(
      source,
      storedZip([
        {
          name: "../word/document.xml",
          text: "<w:document />",
        },
      ]),
    );
    const host = new AgentAttachmentHost(join(root, "attachments"));

    await expect(host.importFiles([source])).rejects.toThrow(
      "unsafe entry path",
    );
  });

  it("rejects a file whose contents are not a supported image", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-image-host-"));
    const source = join(root, "fake.png");
    await writeFile(source, "not an image");
    const host = new AgentAttachmentHost(join(root, "attachments"));

    await expect(host.importFiles([source])).rejects.toThrow(
      "Attachments must be PNG, JPEG, WebP, GIF, SVG, PDF, DOCX, Markdown, text, CSV, HTML, JSON, or YAML files",
    );
  });

  it("never resolves an arbitrary path as an attachment ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "opendesign-image-host-"));
    const host = new AgentAttachmentHost(join(root, "attachments"));

    await expect(host.resolve("../../private.png")).rejects.toThrow(
      "Invalid Agent attachment ID",
    );
  });
});
