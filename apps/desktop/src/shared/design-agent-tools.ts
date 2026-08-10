import {
  NodeDesignOperationSchema,
  isDesignOperation,
  type DesignOperation,
} from "@opendesign/design-contracts";

export const DESIGN_INSPECT_TOOL_NAME = "opendesign_inspect_document";
export const DESIGN_CAPTURE_TOOL_NAME = "opendesign_capture_canvas";
export const DESIGN_APPLY_TOOL_NAME = "opendesign_apply_transaction";
export const READ_IMAGE_TOOL_NAME = "opendesign_read_image";
export const GENERATE_IMAGE_TOOL_NAME = "opendesign_generate_image";
export const PLACE_IMAGE_TOOL_NAME = "opendesign_place_image";
export const INTERNAL_DESIGN_APPLY_TOOL_NAME =
  "opendesign_internal_apply_transaction";

export type ReadImageToolInput = { source: string };
export type ImageGenerationSize = "auto" | `${number}x${number}`;
export type ImageGenerationQuality = "auto" | "low" | "medium" | "high";
export type ImageGenerationOutputFormat = "png" | "jpeg" | "webp";
export type GenerateImageToolInput = {
  prompt: string;
  size?: ImageGenerationSize;
  quality?: ImageGenerationQuality;
  outputFormat?: ImageGenerationOutputFormat;
};
export type PlaceImageToolInput = {
  attachmentId: string;
  pageId: string;
  parentId: string | null;
  index: number;
  nodeId: string;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  fit?: "fill" | "contain" | "cover";
};

export type DesignApplyToolInput = {
  label: string;
  summary?: string;
  commands: DesignOperation[];
};

export const DESIGN_AGENT_TOOL_SPECS = [
  {
    name: DESIGN_INSPECT_TOOL_NAME,
    description:
      "Read the currently bound OpenDesign Design File, active Page, node tree, selection, and revision before planning a design change. This does not inspect project files, source code, directories, or other Design Files. Call this instead of guessing canvas structure.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_CAPTURE_TOOL_NAME,
    description:
      "Capture the currently bound OpenDesign canvas viewport as a bounded image and return it as multimodal content. Use this after a material design write to evaluate the rendered composition, hierarchy, spacing, proportions, and effects before claiming visual quality. This captures only the active design canvas; it does not capture other applications, windows, files, or screens.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: READ_IMAGE_TOOL_NAME,
    description:
      "Read an image that the user explicitly referenced in the current prompt or attached to the current run. source must be the exact attachment ID, absolute local path, file URL, or HTTP(S) image URL written by the user. The host resolves it as a bounded, content-addressed image attachment and returns multimodal content. This tool cannot enumerate directories, discover neighboring files, use browser cookies, or read an unmentioned source.",
    inputSchema: {
      type: "object",
      properties: {
        source: { type: "string", minLength: 1, maxLength: 4_096 },
      },
      required: ["source"],
      additionalProperties: false,
    },
    risk: "read" as const,
    approval: "never" as const,
  },
  {
    name: GENERATE_IMAGE_TOOL_NAME,
    description:
      "Generate one original raster image with OpenDesign's globally configured image-generation model. This selection is application-wide and independent of the current conversation model. Use it when a poster, campaign visual, textured background, illustration, product scene, or other design requires generated imagery. The result is a content-addressed image attachment; call opendesign_place_image to add it to the current Design File. If visual inspection is needed, the generated attachment is also returned as multimodal content. The tool never accepts a provider or model ID and fails explicitly when no global image-generation model is configured.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 32_000 },
        size: {
          type: "string",
          pattern: "^(auto|[1-9][0-9]{2,3}x[1-9][0-9]{2,3})$",
          description:
            "Output resolution. Popular values include 1024x1024, 1536x1024, 1024x1536, 2048x2048, 2048x1152, 3840x2160, 2160x3840, and auto.",
        },
        quality: { enum: ["auto", "low", "medium", "high"] },
        outputFormat: { enum: ["png", "jpeg", "webp"] },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
    risk: "external" as const,
    approval: "never" as const,
  },
  {
    name: PLACE_IMAGE_TOOL_NAME,
    description:
      "Place an image attachment returned by opendesign_read_image, opendesign_generate_image, or explicitly attached by the user into the currently bound Design File. The host imports the approved attachment as a durable project image asset and inserts one image node through the same atomic OpenDesign transaction and revision history as every other design edit.",
    inputSchema: {
      type: "object",
      properties: {
        attachmentId: {
          type: "string",
          pattern: "^image_[a-f0-9]{64}$",
        },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        parentId: {
          anyOf: [
            { type: "string", minLength: 1, maxLength: 256 },
            { type: "null" },
          ],
        },
        index: { type: "integer", minimum: 0 },
        nodeId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number", exclusiveMinimum: 0 },
        height: { type: "number", exclusiveMinimum: 0 },
        fit: { enum: ["fill", "contain", "cover"] },
      },
      required: [
        "attachmentId",
        "pageId",
        "parentId",
        "index",
        "nodeId",
        "name",
        "x",
        "y",
      ],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
  {
    name: DESIGN_APPLY_TOOL_NAME,
    description:
      "Apply one validated, atomic OpenDesign node transaction to the currently bound Design File and an existing Page. Supports insert_element, update_properties, move_element, delete_element, and replace_subtree. For organic silhouettes, mascots, logos, custom icons, wings, limbs, fabric, and other non-geometric contours, use path or vector nodes with portable SVG path data in properties.path; they support the same fills, strokes, gradients, effects, and advanced stroke fields as other shapes. Path coordinates are local to the node and should fit its declared size. Composite designs should create a named Frame or Group before inserting its children later in the same ordered transaction; do not flatten their parts into Page-root layers. It does not create, rename, duplicate, or delete Projects, Design Files, or Pages. Use stable unique IDs for new nodes and command IDs. The host supplies document identity, base revision, and Agent actor; never place them in the input.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", minLength: 1, maxLength: 256 },
        summary: { type: "string", maxLength: 2_000 },
        commands: {
          type: "array",
          minItems: 1,
          maxItems: 1_000,
          items: NodeDesignOperationSchema,
        },
      },
      required: ["label", "commands"],
      additionalProperties: false,
    },
    risk: "design_write" as const,
    approval: "never" as const,
  },
] as const;

export function validateDesignAgentToolInput(
  toolName: string,
  input: unknown,
): boolean {
  if (toolName === DESIGN_INSPECT_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === DESIGN_CAPTURE_TOOL_NAME) {
    return isRecord(input) && Object.keys(input).length === 0;
  }
  if (toolName === READ_IMAGE_TOOL_NAME) {
    return (
      isRecord(input) &&
      typeof input.source === "string" &&
      input.source.length > 0 &&
      input.source.length <= 4_096 &&
      Object.keys(input).every((key) => key === "source")
    );
  }
  if (toolName === GENERATE_IMAGE_TOOL_NAME) {
    return isGenerateImageToolInput(input);
  }
  if (toolName === PLACE_IMAGE_TOOL_NAME) return isPlaceImageToolInput(input);
  if (
    (toolName !== DESIGN_APPLY_TOOL_NAME &&
      toolName !== INTERNAL_DESIGN_APPLY_TOOL_NAME) ||
    !isRecord(input)
  ) {
    return false;
  }
  const internal = toolName === INTERNAL_DESIGN_APPLY_TOOL_NAME;
  return (
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    (input.summary === undefined ||
      (typeof input.summary === "string" && input.summary.length <= 2_000)) &&
    Array.isArray(input.commands) &&
    input.commands.length > 0 &&
    input.commands.length <= 1_000 &&
    input.commands.every((command) => {
      if (!isDesignOperation(command)) return false;
      return (
        internal ||
        (command.type !== "put_asset" && command.type !== "delete_asset")
      );
    }) &&
    Object.keys(input).every((key) =>
      ["label", "summary", "commands"].includes(key),
    )
  );
}

export function isReadImageToolInput(
  input: unknown,
): input is ReadImageToolInput {
  return validateDesignAgentToolInput(READ_IMAGE_TOOL_NAME, input);
}

export function isGenerateImageToolInput(
  input: unknown,
): input is GenerateImageToolInput {
  if (!isRecord(input)) return false;
  const allowed = ["prompt", "size", "quality", "outputFormat"];
  return (
    typeof input.prompt === "string" &&
    input.prompt.trim().length > 0 &&
    input.prompt.length <= 32_000 &&
    (input.size === undefined || isImageGenerationSize(input.size)) &&
    (input.quality === undefined ||
      input.quality === "auto" ||
      input.quality === "low" ||
      input.quality === "medium" ||
      input.quality === "high") &&
    (input.outputFormat === undefined ||
      input.outputFormat === "png" ||
      input.outputFormat === "jpeg" ||
      input.outputFormat === "webp") &&
    Object.keys(input).every((key) => allowed.includes(key))
  );
}

export function isPlaceImageToolInput(
  input: unknown,
): input is PlaceImageToolInput {
  if (!isRecord(input)) return false;
  const allowed = [
    "attachmentId",
    "pageId",
    "parentId",
    "index",
    "nodeId",
    "name",
    "x",
    "y",
    "width",
    "height",
    "fit",
  ];
  return (
    typeof input.attachmentId === "string" &&
    /^image_[a-f0-9]{64}$/.test(input.attachmentId) &&
    safeId(input.pageId) &&
    (input.parentId === null || safeId(input.parentId)) &&
    Number.isInteger(input.index) &&
    Number(input.index) >= 0 &&
    safeId(input.nodeId) &&
    typeof input.name === "string" &&
    input.name.length > 0 &&
    input.name.length <= 256 &&
    finite(input.x) &&
    finite(input.y) &&
    (input.width === undefined || positive(input.width)) &&
    (input.height === undefined || positive(input.height)) &&
    (input.fit === undefined ||
      input.fit === "fill" ||
      input.fit === "contain" ||
      input.fit === "cover") &&
    Object.keys(input).every((key) => allowed.includes(key))
  );
}

export function isDesignApplyToolInput(
  input: unknown,
): input is DesignApplyToolInput {
  return validateDesignAgentToolInput(DESIGN_APPLY_TOOL_NAME, input);
}

export function isInternalDesignApplyToolInput(
  input: unknown,
): input is DesignApplyToolInput {
  return validateDesignAgentToolInput(INTERNAL_DESIGN_APPLY_TOOL_NAME, input);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function positive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function isImageGenerationSize(value: unknown): value is ImageGenerationSize {
  if (value === "auto") return true;
  if (typeof value !== "string") return false;
  const match = /^(\d{3,4})x(\d{3,4})$/.exec(value);
  const width = Number(match?.[1]);
  const height = Number(match?.[2]);
  if (!match || !Number.isInteger(width) || !Number.isInteger(height)) {
    return false;
  }
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  const pixels = width * height;
  return (
    shortEdge >= 256 &&
    longEdge <= 4_096 &&
    longEdge / shortEdge <= 4 &&
    pixels <= 16_777_216
  );
}
