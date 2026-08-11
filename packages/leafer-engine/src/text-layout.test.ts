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

const leafer = {
  Text: FakeText,
} as unknown as Pick<typeof LeaferEditorModule, "Text">;

describe("Leafer text layout provider", () => {
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
        mode: "auto-width",
        textWrap: "word",
      }),
    ).toMatchObject({ ok: false, code: "invalid-input" });
  });
});
