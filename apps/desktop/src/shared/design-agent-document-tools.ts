import {
  executableJsonSchema,
  isDesignOperation,
  type DesignOperation,
  type TextFontDescriptor,
} from "@opendesign/design-contracts";
import {
  exactKeys,
  isRecord,
  safeId,
  safeLabel,
} from "./design-agent-validation";
import {
  contractSchemaIssues,
  type ValidationIssue,
  type ValidationResult,
} from "./contract-validation";
export {
  DESIGN_FONT_TOOL_INPUT_SCHEMA,
  DESIGN_TEXT_RANGE_TOOL_INPUT_SCHEMA,
} from "./design-agent-operation-schemas";

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

export type DesignFontToolInput =
  | {
      action: "reflow";
      label: string;
      pageId: string;
      nodeIds: string[];
      expectedFont: TextFontDescriptor;
    }
  | {
      action: "replace";
      label: string;
      pageId: string;
      nodeIds: string[];
      expectedFont: TextFontDescriptor;
      replacementFont: TextFontDescriptor;
    };

export type DesignTextRangeToolInput = {
  label: string;
  pageId: string;
  nodeId: string;
  start: number;
  end: number;
  style: Extract<DesignOperation, { type: "update_text_range_style" }>["style"];
};

export function isDesignFontToolInput(
  input: unknown,
): input is DesignFontToolInput {
  if (
    !isRecord(input) ||
    (input.action !== "reflow" && input.action !== "replace") ||
    !safeLabel(input.label) ||
    !safeId(input.pageId) ||
    !Array.isArray(input.nodeIds) ||
    input.nodeIds.length < 1 ||
    input.nodeIds.length > 1_000 ||
    !input.nodeIds.every(safeId) ||
    new Set(input.nodeIds).size !== input.nodeIds.length ||
    !isTextFontDescriptor(input.expectedFont)
  ) {
    return false;
  }
  if (input.action === "reflow") {
    return exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeIds",
      "expectedFont",
    ]);
  }
  return (
    isTextFontDescriptor(input.replacementFont) &&
    exactKeys(input, [
      "action",
      "label",
      "pageId",
      "nodeIds",
      "expectedFont",
      "replacementFont",
    ])
  );
}

export function isDesignTextRangeToolInput(
  input: unknown,
): input is DesignTextRangeToolInput {
  if (
    !isRecord(input) ||
    !safeLabel(input.label) ||
    !safeId(input.pageId) ||
    !safeId(input.nodeId) ||
    !Number.isSafeInteger(input.start) ||
    !Number.isSafeInteger(input.end) ||
    Number(input.start) < 0 ||
    Number(input.end) <= Number(input.start) ||
    !exactKeys(input, ["label", "pageId", "nodeId", "start", "end", "style"])
  ) {
    return false;
  }
  return isDesignOperation({
    commandId: "validate_text_range",
    type: "update_text_range_style",
    nodeId: input.nodeId,
    start: input.start,
    end: input.end,
    style: input.style,
  });
}

function isTextFontDescriptor(value: unknown): value is TextFontDescriptor {
  return (
    isRecord(value) &&
    typeof value.fontFamily === "string" &&
    value.fontFamily.trim().length > 0 &&
    value.fontFamily.length <= 4_096 &&
    (value.fontStyleName === null ||
      (typeof value.fontStyleName === "string" &&
        value.fontStyleName.trim().length > 0 &&
        value.fontStyleName.length <= 512)) &&
    Number.isInteger(value.fontWeight) &&
    Number(value.fontWeight) >= 1 &&
    Number(value.fontWeight) <= 1_000 &&
    (value.fontSlant === "normal" || value.fontSlant === "italic") &&
    exactKeys(value, ["fontFamily", "fontStyleName", "fontWeight", "fontSlant"])
  );
}

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

function parsePageStructureAccess(
  input: unknown,
): ValidationResult<PageStructureAccessToolInput> {
  const issues = contractSchemaIssues(
    PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
    input,
    {
      code: "page_structure_access.schema_invalid",
      subject: "Page Structure Access",
      maximum: 16,
    },
  );
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        value: structuredClone(input as PageStructureAccessToolInput),
      };
}

export const PageStructureAccessContract = {
  schema: PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA,
  parse: parsePageStructureAccess,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parsePageStructureAccess(input);
    return result.ok ? [] : result.issues;
  },
} as const;

function parseDesignPage(
  input: unknown,
): ValidationResult<DesignPageToolInput> {
  const issues = contractSchemaIssues(DESIGN_PAGE_TOOL_INPUT_SCHEMA, input, {
    code: "design_page.schema_invalid",
    subject: "Page",
    maximum: 16,
  });
  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, value: structuredClone(input as DesignPageToolInput) };
}

export const DesignPageContract = {
  schema: DESIGN_PAGE_TOOL_INPUT_SCHEMA,
  parse: parseDesignPage,
  issues: (input: unknown): ValidationIssue[] => {
    const result = parseDesignPage(input);
    return result.ok ? [] : result.issues;
  },
} as const;
