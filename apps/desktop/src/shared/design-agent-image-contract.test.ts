import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  GenerateImageContract,
  READ_IMAGE_TOOL_INPUT_SCHEMA,
  ReadImageContract,
} from "./design-agent-image-tools";
import {
  DESIGN_AGENT_TOOL_SPECS,
  GENERATE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
} from "./design-agent-tools";

describe("image acquisition contracts", () => {
  it("uses the disclosed schemas as the Runtime structure source", () => {
    expect(ReadImageContract.schema).toBe(READ_IMAGE_TOOL_INPUT_SCHEMA);
    expect(GenerateImageContract.schema).toBe(GENERATE_IMAGE_TOOL_INPUT_SCHEMA);
    expect(
      schemaValidationIssues(READ_IMAGE_TOOL_INPUT_SCHEMA, {
        source: "image_abc",
      }),
    ).toHaveLength(0);
    expect(
      schemaValidationIssues(GENERATE_IMAGE_TOOL_INPUT_SCHEMA, {
        prompt: "A documentary summer-camp hero photograph",
        role: "hero",
        size: "1536x1024",
      }),
    ).toHaveLength(0);
  });

  it("returns canonical read-image input or an exact schema path", () => {
    expect(
      ReadImageContract.parse({ source: "https://example.test/reference.png" }),
    ).toEqual({
      ok: true,
      value: { source: "https://example.test/reference.png" },
    });
    expect(
      ReadImageContract.issues({
        source: "https://example.test/reference.png",
        neighboringFile: true,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "read_image.schema_invalid",
          path: "/neighboringFile",
        }),
      ]),
    );
  });

  it("rejects whitespace-only prompts in the disclosed structure schema", () => {
    const issues = GenerateImageContract.issues({
      prompt: "   ",
      role: "hero",
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "generate_image.schema_invalid",
          path: "/prompt",
        }),
      ]),
    );
  });

  it.each([
    ["128x1024", "edge below 256"],
    ["4096x1000", "aspect ratio above 4:1"],
    ["8192x8192", "edge and area above limits"],
  ])("returns one stable size issue for %s (%s)", (size) => {
    expect(
      GenerateImageContract.issues({
        prompt: "A subject-grounded editorial image",
        role: "supporting-content",
        size,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "generate_image.size_out_of_bounds",
        path: "/size",
        actual: size,
      }),
    ]);
  });

  it("accepts documented boundary dimensions and preserves optional settings", () => {
    expect(
      GenerateImageContract.parse({
        prompt: "A subject-grounded editorial image",
        role: "background",
        size: "4096x4096",
        quality: "high",
        outputFormat: "webp",
      }),
    ).toEqual({
      ok: true,
      value: {
        prompt: "A subject-grounded editorial image",
        role: "background",
        size: "4096x4096",
        quality: "high",
        outputFormat: "webp",
      },
    });
  });

  it("wires Pi validation to the same contract issue functions", () => {
    const read = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === READ_IMAGE_TOOL_NAME,
    );
    const generate = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === GENERATE_IMAGE_TOOL_NAME,
    );

    expect(read).toHaveProperty(
      "validateInputIssues",
      ReadImageContract.issues,
    );
    expect(generate).toHaveProperty(
      "validateInputIssues",
      GenerateImageContract.issues,
    );
  });
});
