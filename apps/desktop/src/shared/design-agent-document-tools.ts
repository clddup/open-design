import { executableJsonSchema } from "@opendesign/design-contracts";
import { defineContract } from "./contract-validation";

export type DesignPageToolInput =
  | {
      action: "create";
      label: string;
      name: string;
      index?: number;
    }
  | {
      action: "rename";
      label: string;
      pageId: string;
      name: string;
    }
  | {
      action: "duplicate";
      label: string;
      pageId: string;
      name?: string;
      index?: number;
    }
  | {
      action: "reorder";
      label: string;
      pageId: string;
      index: number;
    }
  | {
      action: "clear";
      label: string;
      pageId: string;
    }
  | {
      action: "delete";
      label: string;
      pageId: string;
    };

export type PageStructureAccessAction =
  | "create-page"
  | "duplicate-page"
  | "reorder-pages"
  | "delete-page"
  | "cross-page-edit";

export type PageStructureAccessToolInput = {
  actions: PageStructureAccessAction[];
  reason: string;
};

export const PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    actions: {
      type: "array",
      minItems: 1,
      maxItems: 5,
      uniqueItems: true,
      items: {
        enum: [
          "create-page",
          "duplicate-page",
          "reorder-pages",
          "delete-page",
          "cross-page-edit",
        ],
      },
    },
    reason: {
      type: "string",
      minLength: 8,
      maxLength: 500,
      pattern: "\\S",
    },
  },
  required: ["actions", "reason"],
  additionalProperties: false,
});

const PAGE_TOOL_LABEL_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "\\S",
} as const;

const PAGE_TOOL_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;

const PAGE_NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 256,
  pattern: "^(?=.*\\S)[^\\u0000-\\u001F\\u007F-\\u009F]+$",
  description:
    "Visible Page name without control characters; whitespace-only names are invalid.",
} as const;

const PAGE_TOOL_COMMON_PROPERTIES = {
  label: PAGE_TOOL_LABEL_SCHEMA,
} as const;

const PAGE_TOOL_REQUIRED = ["action", "label"] as const;

export const DESIGN_PAGE_TOOL_INPUT_SCHEMA = executableJsonSchema({
  type: "object",
  properties: {
    ...PAGE_TOOL_COMMON_PROPERTIES,
    action: {
      enum: ["create", "rename", "duplicate", "reorder", "clear", "delete"],
    },
    pageId: PAGE_TOOL_ID_SCHEMA,
    name: PAGE_NAME_SCHEMA,
    index: { type: "integer", minimum: 0 },
  },
  required: PAGE_TOOL_REQUIRED,
  anyOf: [
    {
      type: "object",
      properties: {
        ...PAGE_TOOL_COMMON_PROPERTIES,
        action: { const: "create" },
        name: PAGE_NAME_SCHEMA,
        index: { type: "integer", minimum: 0 },
      },
      required: [...PAGE_TOOL_REQUIRED, "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...PAGE_TOOL_COMMON_PROPERTIES,
        action: { const: "rename" },
        pageId: PAGE_TOOL_ID_SCHEMA,
        name: PAGE_NAME_SCHEMA,
      },
      required: [...PAGE_TOOL_REQUIRED, "pageId", "name"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...PAGE_TOOL_COMMON_PROPERTIES,
        action: { const: "duplicate" },
        pageId: PAGE_TOOL_ID_SCHEMA,
        name: PAGE_NAME_SCHEMA,
        index: { type: "integer", minimum: 0 },
      },
      required: [...PAGE_TOOL_REQUIRED, "pageId"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        ...PAGE_TOOL_COMMON_PROPERTIES,
        action: { const: "reorder" },
        pageId: PAGE_TOOL_ID_SCHEMA,
        index: { type: "integer", minimum: 0 },
      },
      required: [...PAGE_TOOL_REQUIRED, "pageId", "index"],
      additionalProperties: false,
    },
    ...(["clear", "delete"] as const).map((action) => ({
      type: "object" as const,
      properties: {
        ...PAGE_TOOL_COMMON_PROPERTIES,
        action: { const: action },
        pageId: PAGE_TOOL_ID_SCHEMA,
      },
      required: [...PAGE_TOOL_REQUIRED, "pageId"],
      additionalProperties: false,
    })),
  ],
  additionalProperties: false,
});

export const PageStructureAccessContract =
  defineContract<PageStructureAccessToolInput>({
    schema: PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
    code: "page_structure_access.schema_invalid",
    subject: "Page Structure Access",
    maximum: 16,
  });

export const DesignPageContract = defineContract<DesignPageToolInput>({
  schema: DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  code: "design_page.schema_invalid",
  subject: "Page",
  maximum: 16,
});
