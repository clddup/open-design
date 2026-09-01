import { describe, expect, it } from "vitest";
import { SvgTextMetadataEnvelopeContract } from "./svg-text.js";

describe("SVG text metadata contract", () => {
  it("accepts the bounded metadata envelope", () => {
    expect(
      SvgTextMetadataEnvelopeContract.parse({
        width: 320,
        height: 180,
        properties: { content: "OpenDesign" },
      }).ok,
    ).toBe(true);
  });

  it("reports exact paths for invalid bounds, properties, and extra fields", () => {
    expect(
      SvgTextMetadataEnvelopeContract.issues({
        width: 0,
        height: 180,
        properties: [],
        filePath: "/tmp/text.json",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/width" }),
        expect.objectContaining({ path: "/properties" }),
        expect.objectContaining({ path: "/filePath" }),
      ]),
    );
  });
});
