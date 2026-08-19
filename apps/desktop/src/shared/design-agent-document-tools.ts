import {
  isDesignOperation,
  type DesignOperation,
  type TextFontDescriptor,
} from "@opendesign/design-contracts";
import {
  boundedText,
  exactKeys,
  isRecord,
  onlyKeys,
  optionalIndex,
  safeId,
  safeLabel,
  safePageName,
} from "./design-agent-validation";
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

export function isDesignPageToolInput(
  input: unknown,
): input is DesignPageToolInput {
  if (!isRecord(input) || !safeLabel(input.label)) return false;
  if (input.action === "create") {
    return (
      safePageName(input.name) &&
      optionalIndex(input.index) &&
      onlyKeys(input, ["action", "label", "name", "index"])
    );
  }
  if (input.action === "rename") {
    return (
      safeId(input.pageId) &&
      safePageName(input.name) &&
      onlyKeys(input, ["action", "label", "pageId", "name"])
    );
  }
  if (input.action === "duplicate") {
    return (
      safeId(input.pageId) &&
      (input.name === undefined || safePageName(input.name)) &&
      optionalIndex(input.index) &&
      onlyKeys(input, ["action", "label", "pageId", "name", "index"])
    );
  }
  if (input.action === "reorder") {
    return (
      safeId(input.pageId) &&
      Number.isInteger(input.index) &&
      Number(input.index) >= 0 &&
      onlyKeys(input, ["action", "label", "pageId", "index"])
    );
  }
  return (
    (input.action === "clear" || input.action === "delete") &&
    safeId(input.pageId) &&
    onlyKeys(input, ["action", "label", "pageId"])
  );
}

export function normalizeDesignPageToolInput(
  input: unknown,
): DesignPageToolInput | undefined {
  if (!isRecord(input) || !safeLabel(input.label)) return undefined;
  if (input.action === "create") {
    if (
      !safePageName(input.name) ||
      !optionalIndex(input.index) ||
      (input.pageId !== undefined && !safeId(input.pageId)) ||
      !onlyKeys(input, ["action", "label", "name", "index", "pageId"])
    ) {
      return undefined;
    }
    return {
      action: "create",
      label: input.label,
      name: input.name,
      ...(typeof input.index === "number" ? { index: input.index } : {}),
    };
  }
  if (input.action === "rename") {
    if (
      !safeId(input.pageId) ||
      !safePageName(input.name) ||
      !optionalIndex(input.index) ||
      !onlyKeys(input, ["action", "label", "pageId", "name", "index"])
    ) {
      return undefined;
    }
    return {
      action: "rename",
      label: input.label,
      pageId: input.pageId,
      name: input.name,
    };
  }
  return isDesignPageToolInput(input) ? input : undefined;
}

export function isPageStructureAccessToolInput(
  input: unknown,
): input is PageStructureAccessToolInput {
  const actions = new Set<PageStructureAccessAction>([
    "create-page",
    "duplicate-page",
    "reorder-pages",
    "delete-page",
    "cross-page-edit",
  ]);
  return (
    isRecord(input) &&
    Array.isArray(input.actions) &&
    input.actions.length > 0 &&
    input.actions.length <= actions.size &&
    input.actions.every(
      (action): action is PageStructureAccessAction =>
        typeof action === "string" &&
        actions.has(action as PageStructureAccessAction),
    ) &&
    new Set(input.actions).size === input.actions.length &&
    boundedText(input.reason, 500) &&
    input.reason.length >= 8 &&
    exactKeys(input, ["actions", "reason"])
  );
}

export const PAGE_STRUCTURE_ACCESS_TOOL_INPUT_SCHEMA = {
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
    reason: { type: "string", minLength: 8, maxLength: 500 },
  },
  required: ["actions", "reason"],
  additionalProperties: false,
} as const;

export const DESIGN_PAGE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    action: {
      enum: ["create", "rename", "duplicate", "reorder", "clear", "delete"],
    },
    label: { type: "string", minLength: 1, maxLength: 256 },
    pageId: { type: "string", minLength: 1, maxLength: 256 },
    name: { type: "string", minLength: 1, maxLength: 256 },
    index: { type: "integer", minimum: 0 },
  },
  oneOf: [
    {
      properties: {
        action: { const: "create" },
        label: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        index: { type: "integer", minimum: 0 },
      },
      required: ["action", "label", "name"],
      additionalProperties: false,
    },
    {
      properties: {
        action: { const: "rename" },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["action", "label", "pageId", "name"],
      additionalProperties: false,
    },
    {
      properties: {
        action: { const: "duplicate" },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        name: { type: "string", minLength: 1, maxLength: 256 },
        index: { type: "integer", minimum: 0 },
      },
      required: ["action", "label", "pageId"],
      additionalProperties: false,
    },
    {
      properties: {
        action: { const: "reorder" },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
        index: { type: "integer", minimum: 0 },
      },
      required: ["action", "label", "pageId", "index"],
      additionalProperties: false,
    },
    ...(["clear", "delete"] as const).map((action) => ({
      properties: {
        action: { const: action },
        label: { type: "string", minLength: 1, maxLength: 256 },
        pageId: { type: "string", minLength: 1, maxLength: 256 },
      },
      required: ["action", "label", "pageId"],
      additionalProperties: false,
    })),
  ],
  additionalProperties: false,
} as const;
