import type * as LeaferEditorModule from "leafer-editor";
import { describe, expect, it, vi } from "vitest";
import {
  createLeaferTextLayoutProvider,
  LEAFER_TEXT_LAYOUT_PROVIDER_ID,
  LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
} from "./text-layout.js";

class FakeText {
  readonly input: Record<string, unknown>;
  readonly destroy = vi.fn();

  constructor(input: Record<string, unknown>) {
    this.input = input;
  }

  get boxBounds() {
    return {
      x: 0,
      y: 0,
      width:
        typeof this.input.width === "number"
          ? this.input.width
          : String(this.input.text).length * 12.25,
      height: typeof this.input.width === "number" ? 64.5 : 32.25,
    };
  }
}

class WrappingText {
  static readonly inputs: Record<string, unknown>[] = [];
  readonly destroy = vi.fn();
  readonly input: Record<string, unknown>;

  constructor(input: Record<string, unknown>) {
    this.input = input;
    WrappingText.inputs.push(input);
  }

  get rows() {
    const content = Array.from(
      typeof this.input.text === "string" ? this.input.text : "",
    );
    const width = Number(this.input.width ?? 1_000);
    const charactersPerRow = Math.max(1, Math.floor(width / 10));
    return Array.from(
      { length: Math.max(1, Math.ceil(content.length / charactersPerRow)) },
      (_, index) => ({
        text: content
          .slice(index * charactersPerRow, (index + 1) * charactersPerRow)
          .join(""),
      }),
    );
  }

  get __() {
    return { __textDrawData: { rows: this.rows } };
  }

  get boxBounds() {
    return {
      x: 0,
      y: 0,
      width: Number(this.input.width ?? String(this.input.text).length * 10),
      height: this.rows.length * 20,
    };
  }
}

const leafer = {
  Text: FakeText,
} as unknown as Pick<typeof LeaferEditorModule, "Text">;

describe("Leafer text layout provider", () => {
  it("reports available, missing, and unknown font state through the same provider", () => {
    const available = createLeaferTextLayoutProvider(leafer, {
      fontAvailable: (descriptor) => descriptor.includes('"Inter"'),
    });
    const unknown = createLeaferTextLayoutProvider(leafer, {
      fontAvailable: () => undefined,
    });

    expect(
      available.inspectFont?.({
        fontFamily: "Inter, sans-serif",
        fontWeight: 600,
      }),
    ).toMatchObject({ status: "available" });
    expect(
      available.inspectFont?.({ fontFamily: "Missing Sans", fontWeight: 400 }),
    ).toMatchObject({ status: "missing" });
    expect(
      unknown.inspectFont?.({ fontFamily: "Unknown Sans", fontWeight: 400 }),
    ).toMatchObject({ status: "unknown" });
  });

  it("keeps the default browser probe conservative without font APIs", () => {
    const provider = createLeaferTextLayoutProvider(leafer);

    expect(
      provider.inspectFont?.({ fontFamily: "sans-serif", fontWeight: 400 }),
    ).toMatchObject({ status: "available" });
    expect(
      provider.inspectFont?.({
        fontFamily: "Unverified Sans",
        fontWeight: 400,
      }),
    ).toMatchObject({ status: "unknown" });
  });

  it("measures Auto Width without fixed bounds and caches the result", () => {
    const provider = createLeaferTextLayoutProvider(leafer, {
      fontAvailable: () => true,
    });
    const request = {
      content: "OpenDesign",
      fontFamily: "Inter, sans-serif",
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 32,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      textCase: "original" as const,
      textDecoration: "none" as const,
      textTruncation: "disabled" as const,
      maxLines: null,
      mode: "auto-width" as const,
      textWrap: "none" as const,
    };

    expect(provider.measure(request)).toEqual({
      ok: true,
      provider: LEAFER_TEXT_LAYOUT_PROVIDER_ID,
      providerVersion: LEAFER_TEXT_LAYOUT_PROVIDER_VERSION,
      size: { width: 122.5, height: 32.25 },
      warnings: [],
    });
    expect(provider.measure(request)).toEqual(provider.measure(request));
  });

  it("keeps Auto Height width authoritative and reports font fallback", () => {
    const provider = createLeaferTextLayoutProvider(leafer, {
      fontAvailable: () => false,
    });
    const result = provider.measure({
      content: "A wrapped paragraph",
      fontFamily: "Missing Sans",
      fontSize: 18,
      fontWeight: 400,
      letterSpacing: 0,
      lineHeight: 26,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      textCase: "original",
      textDecoration: "none",
      textTruncation: "disabled",
      maxLines: null,
      mode: "auto-height",
      textWrap: "word",
      width: 240,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.size).toEqual({ width: 240, height: 64.5 });
    expect(result.warnings[0]?.code).toBe("font-fallback");
    expect(result.warnings[0]?.message).toContain("Missing Sans");
  });

  it("measures Auto Height from the same derived max-lines text used by the canvas", () => {
    WrappingText.inputs.length = 0;
    const provider = createLeaferTextLayoutProvider({
      Text: WrappingText,
    } as unknown as Pick<typeof LeaferEditorModule, "Text">);
    const result = provider.measure({
      content: "012345678901234567890123456789",
      fontFamily: "Inter",
      fontSize: 18,
      fontWeight: 400,
      letterSpacing: 0,
      lineHeight: 20,
      paragraphIndent: 0,
      paragraphSpacing: 0,
      textCase: "original",
      textDecoration: "none",
      textTruncation: "ending",
      maxLines: 2,
      mode: "auto-height",
      textWrap: "word",
      width: 50,
    });

    expect(result).toMatchObject({
      ok: true,
      size: { width: 50, height: 40 },
    });
    expect(WrappingText.inputs.at(-1)?.text).toMatch(/\.\.\.$/);
    expect(WrappingText.inputs.at(-1)?.text).not.toBe(
      "012345678901234567890123456789",
    );
  });

  it("rejects non-canonical requests before constructing Leafer Text", () => {
    const provider = createLeaferTextLayoutProvider(leafer);
    expect(
      provider.measure({
        content: "Invalid",
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 600,
        letterSpacing: 0,
        lineHeight: 32,
        paragraphIndent: 0,
        paragraphSpacing: 0,
        textCase: "original",
        textDecoration: "none",
        textTruncation: "disabled",
        maxLines: null,
        mode: "auto-width",
        textWrap: "word",
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});
