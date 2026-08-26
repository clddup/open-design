import { describe, expect, it } from "vitest";
import {
  parseSvgImportSource,
  parseSvgLength,
  SVG_IMPORT_MAX_DEPTH,
} from "./svg-parse.js";

describe("SVG import parse family", () => {
  it("parses one bounded SVG source and normalizes px viewport dimensions", () => {
    const result = parseSvgImportSource({
      idPrefix: "brand_source",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="120px" height="80"><rect width="120" height="80"/></svg>',
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        sourceViewport: { x: 0, y: 0, width: 120, height: 80 },
      },
    });
    if (result.ok) {
      expect(result.value.root.localName).toBe("svg");
      expect(result.value.document.documentElement).toBe(result.value.root);
    }
    expect(parseSvgLength("1.25e2px")).toBe(125);
    expect(parseSvgLength("10%")).toBeNull();
  });

  it.each([
    ["empty", { idPrefix: "source", svg: "" }, "size-limit"],
    [
      "invalid prefix",
      {
        idPrefix: "9-source",
        svg: '<svg viewBox="0 0 10 10"></svg>',
      },
      "invalid-root",
    ],
    [
      "entity declaration",
      {
        idPrefix: "source",
        svg: '<!DOCTYPE svg [<!ENTITY x "x">]><svg viewBox="0 0 10 10"></svg>',
      },
      "unsafe-xml",
    ],
    [
      "wrong root",
      { idPrefix: "source", svg: "<html></html>" },
      "invalid-root",
    ],
    [
      "invalid viewport",
      { idPrefix: "source", svg: '<svg viewBox="0 0 0 10"></svg>' },
      "invalid-dimension",
    ],
  ])("rejects %s at the parse boundary", (_label, input, code) => {
    expect(parseSvgImportSource(input)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code, severity: "error" })],
    });
  });

  it.each([
    ["script", "<script></script>", "unsupported-element"],
    ["stylesheet", "<style>rect{fill:red}</style>", "unsupported-css"],
    ["use reference", '<use href="#shape"/>', "external-reference"],
    [
      "event handler",
      '<rect width="10" height="10" onload="x"/>',
      "unsafe-xml",
    ],
  ])("rejects unsafe %s structure", (_label, body, code) => {
    const result = parseSvgImportSource({
      idPrefix: "safe_source",
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">${body}</svg>`,
    });
    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code, severity: "error" })],
    });
  });

  it("enforces the shared nesting budget before semantic import", () => {
    const result = parseSvgImportSource({
      idPrefix: "deep_source",
      svg: `<svg viewBox="0 0 10 10">${"<g>".repeat(SVG_IMPORT_MAX_DEPTH + 1)}<path d="M0 0H10V10Z"/>${"</g>".repeat(SVG_IMPORT_MAX_DEPTH + 1)}</svg>`,
    });
    expect(result).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code: "depth-limit" })],
    });
  });
});
