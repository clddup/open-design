const fields = [
  "fillStyleId",
  "strokeStyleId",
  "effectStyleId",
  "textStyleId",
  "gridStyleId",
] as const;

export const DESIGN_STYLE_TOOL_INPUT_SCHEMA = {
  type: "object",
  description:
    "Manage Figma-compatible local Paint, Text, Effect, and Grid styles through the trusted Style Service. Create or update payloads from a current inspected node property so the host owns exact schema conversion. Use only stable Style/Page/node IDs returned by inspection. Applying, detaching, deleting, metadata changes, and ordering are previewed and committed as one undoable revision. Detach and delete preserve the currently resolved appearance.",
  properties: {
    action: {
      enum: [
        "create-from-node",
        "update-from-node",
        "update-metadata",
        "move",
        "delete",
        "set-reference",
      ],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    nodeId: { type: "string", minLength: 1, maxLength: 256 },
    field: { enum: fields },
    styleId: {
      oneOf: [
        { type: "string", minLength: 1, maxLength: 256 },
        { type: "null" },
      ],
    },
    key: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 512 },
    description: { type: "string", maxLength: 2000 },
    hiddenFromPublishing: { type: "boolean" },
    index: { type: "integer", minimum: 0, maximum: 9999 },
  },
  required: ["action", "label", "pageId"],
  additionalProperties: false,
} as const;
