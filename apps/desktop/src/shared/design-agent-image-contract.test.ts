import { schemaValidationIssues } from "@opendesign/design-contracts";
import { describe, expect, it } from "vitest";
import {
  EDIT_IMAGE_TOOL_INPUT_SCHEMA,
  EditImageContract,
  GENERATE_IMAGE_TOOL_INPUT_SCHEMA,
  GenerateImageContract,
  PLACE_IMAGE_TOOL_INPUT_SCHEMA,
  PlaceImageContract,
  READ_IMAGE_TOOL_INPUT_SCHEMA,
  ReadImageContract,
  UPDATE_IMAGE_TOOL_INPUT_SCHEMA,
  UpdateImageContract,
} from "./design-agent-image-tools";
import {
  DESIGN_AGENT_TOOL_SPECS,
  EDIT_IMAGE_TOOL_NAME,
  GENERATE_IMAGE_TOOL_NAME,
  PLACE_IMAGE_TOOL_NAME,
  READ_IMAGE_TOOL_NAME,
  UPDATE_IMAGE_TOOL_NAME,
} from "./design-agent-tools";

const attachmentId = `image_${"a".repeat(64)}`;
const assetId = `asset_${"b".repeat(64)}`;
const replacementAssetId = `asset_${"c".repeat(64)}`;

const placementInput = {
  attachmentId,
  pageId: "page_1",
  parentId: "artboard_1",
  index: 0,
  nodeId: "hero_image",
  name: "Hero image",
  role: "hero",
  x: 40,
  y: 60,
  width: 960,
  height: 640,
  placement: {
    mode: "crop",
    focalPoint: { x: 0.5, y: 0.4 },
    zoom: 1.2,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
  },
} as const;

const persistentPlacementInput = {
  assetId,
  pageId: placementInput.pageId,
  parentId: placementInput.parentId,
  index: placementInput.index,
  nodeId: placementInput.nodeId,
  name: placementInput.name,
  role: placementInput.role,
  x: placementInput.x,
  y: placementInput.y,
  width: placementInput.width,
  height: placementInput.height,
  placement: placementInput.placement,
} as const;

const editBase = {
  label: "Edit hero image",
  pageId: "page_1",
  nodeId: "hero_image",
  expectedAssetId: assetId,
} as const;

describe("image Agent contracts", () => {
  it("uses the disclosed schemas as the Runtime structure source", () => {
    expect(ReadImageContract.schema).toBe(READ_IMAGE_TOOL_INPUT_SCHEMA);
    expect(GenerateImageContract.schema).toBe(GENERATE_IMAGE_TOOL_INPUT_SCHEMA);
    expect(PlaceImageContract.schema).toBe(PLACE_IMAGE_TOOL_INPUT_SCHEMA);
    expect(UpdateImageContract.schema).toBe(UPDATE_IMAGE_TOOL_INPUT_SCHEMA);
    expect(EditImageContract.schema).toBe(EDIT_IMAGE_TOOL_INPUT_SCHEMA);
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
    expect(
      schemaValidationIssues(PLACE_IMAGE_TOOL_INPUT_SCHEMA, placementInput),
    ).toHaveLength(0);
  });

  it("accepts exactly one placement source and returns source-specific paths", () => {
    expect(PlaceImageContract.parse(placementInput)).toEqual({
      ok: true,
      value: placementInput,
    });
    expect(PlaceImageContract.parse(persistentPlacementInput).ok).toBe(true);
    expect(
      PlaceImageContract.issues({
        ...placementInput,
        assetId,
      }),
    ).toEqual([
      expect.objectContaining({
        code: "place_image.schema_invalid",
        path: "/attachmentId",
      }),
    ]);
    expect(
      PlaceImageContract.issues({
        ...persistentPlacementInput,
        width: undefined,
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "place_image.schema_invalid",
          path: "/width",
        }),
      ]),
    );
    expect(PlaceImageContract.issues(null)).toEqual([
      expect.objectContaining({
        code: "place_image.schema_invalid",
        path: "/",
      }),
    ]);
  });

  it("selects the exact update action branch", () => {
    expect(
      UpdateImageContract.parse({
        action: "set-filters",
        label: "Balance hero",
        pageId: "page_1",
        nodeId: "hero_image",
        filters: { exposure: 0.2, temperature: -0.1 },
      }).ok,
    ).toBe(true);
    expect(
      UpdateImageContract.issues({
        action: "set-placement",
        label: "Reframe hero",
        pageId: "page_1",
        nodeId: "hero_image",
      }),
    ).toEqual([
      expect.objectContaining({
        code: "update_image.schema_invalid",
        path: "/placement",
      }),
    ]);
    expect(
      UpdateImageContract.issues({
        action: "switch-source",
        label: "Restore source",
        pageId: "page_1",
        nodeId: "hero_image",
        expectedAssetId: assetId,
        assetId: replacementAssetId,
        filters: {},
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "update_image.schema_invalid",
          path: "/filters",
        }),
      ]),
    );
  });

  it("selects the exact edit action branch and refines expansion geometry", () => {
    expect(
      EditImageContract.parse({
        ...editBase,
        action: "prompt-edit",
        prompt: "Reduce background distraction",
        referenceAttachmentId: attachmentId,
      }).ok,
    ).toBe(true);
    expect(
      EditImageContract.issues({
        ...editBase,
        action: "replace-background",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "edit_image.schema_invalid",
          path: "/prompt",
        }),
      ]),
    );
    expect(
      EditImageContract.issues({
        ...editBase,
        action: "relight",
        lightingPreset: "neon",
        prompt: "Add more neon",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "edit_image.schema_invalid",
          path: "/prompt",
        }),
      ]),
    );
    expect(
      EditImageContract.issues({
        ...editBase,
        action: "expand",
        expansion: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
    ).toEqual([
      expect.objectContaining({
        code: "edit_image.expansion_empty",
        path: "/expansion",
      }),
    ]);
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
    const place = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === PLACE_IMAGE_TOOL_NAME,
    );
    const update = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === UPDATE_IMAGE_TOOL_NAME,
    );
    const edit = DESIGN_AGENT_TOOL_SPECS.find(
      (tool) => tool.name === EDIT_IMAGE_TOOL_NAME,
    );

    expect(read).toHaveProperty(
      "validateInputIssues",
      ReadImageContract.issues,
    );
    expect(generate).toHaveProperty(
      "validateInputIssues",
      GenerateImageContract.issues,
    );
    expect(place).toHaveProperty(
      "validateInputIssues",
      PlaceImageContract.issues,
    );
    expect(update).toHaveProperty(
      "validateInputIssues",
      UpdateImageContract.issues,
    );
    expect(edit).toHaveProperty(
      "validateInputIssues",
      EditImageContract.issues,
    );
  });
});
