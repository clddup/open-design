import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  materializeLeaferTextData,
  truncateLeaferText,
  type LeaferTextModule,
} from "./text-truncation.js";

const destroyed: Array<ReturnType<typeof vi.fn>> = [];

class RowText {
  readonly destroy = vi.fn();
  readonly input: Record<string, unknown>;

  constructor(input: Record<string, unknown> = {}) {
    this.input = input;
    destroyed.push(this.destroy);
  }

  get boxBounds() {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  get __() {
    const content = String(this.input.text ?? "");
    const width = Number(this.input.width ?? 80);
    const charactersPerRow = Math.max(1, Math.floor(width / 10));
    const rows = content.split("\n").flatMap((paragraph) => {
      const characters = Array.from(paragraph);
      const chunks = Array.from(
        {
          length: Math.max(1, Math.ceil(characters.length / charactersPerRow)),
        },
        (_, index) =>
          characters
            .slice(index * charactersPerRow, (index + 1) * charactersPerRow)
            .join(""),
      );
      return chunks.map((text, index) => ({
        data: Array.from(text, (char) => ({ char })),
        paraEnd: index === chunks.length - 1,
      }));
    });
    return { __textDrawData: { rows } };
  }
}

const leafer = { Text: RowText } satisfies LeaferTextModule;

describe("Leafer max-lines materialization", () => {
  beforeEach(() => {
    destroyed.length = 0;
  });

  it("keeps canonical text data unchanged when maxLines is absent", () => {
    const data = { text: "Complete authored content", width: 60 };
    expect(materializeLeaferTextData(leafer, data, undefined)).toBe(data);
    expect(destroyed).toHaveLength(0);
  });

  it("derives an ending ellipsis from Leafer rows without changing source content", () => {
    const content = "Alpha beta gamma delta";
    const data = { text: content, width: 60, height: 100 };
    const materialized = materializeLeaferTextData(leafer, data, 2);

    expect(materialized).not.toBe(data);
    expect(data.text).toBe(content);
    expect(materialized.text).not.toBe(content);
    expect(materialized.text).toMatch(/\.\.\.$/);
    expect(materialized.width).toBe(60);
    expect(materialized.height).toBe(100);
    expect(destroyed.length).toBeGreaterThan(1);
    expect(destroyed.every((destroy) => destroy.mock.calls.length === 1)).toBe(
      true,
    );
  });

  it("returns complete content when Leafer reports no excess rows", () => {
    expect(truncateLeaferText(leafer, { width: 200 }, "Short\ncopy", 3)).toBe(
      "Short\ncopy",
    );
  });
});
