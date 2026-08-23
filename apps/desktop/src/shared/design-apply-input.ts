import {
  DesignNodeSchema,
  DesignOperationSchema,
  NodeDesignOperationSchema,
  Type,
  schemaValidationIssues,
  type DesignOperation,
  type TSchema,
} from "@opendesign/design-contracts";
import {
  type ValidationIssue,
  type ValidationIssueValue,
  type ValidationResult,
} from "./contract-validation";
import {
  DESIGN_APPLY_STEP_SCHEMA,
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
} from "./design-agent-operation-schemas";

export type DesignApplyToolInput = {
  label: string;
  summary?: string;
  steps?: DesignApplyStep[];
  commands: DesignOperation[];
};

export type DesignApplyStep = {
  stepId: string;
  label: string;
  commandIds: string[];
};

export type PlannedDesignRebaseTarget = {
  frameId: string;
  pageId: string;
  width: number;
  height: number;
};

export type PlannedDesignRebaseGuard = {
  fromRevision: number;
  targets: PlannedDesignRebaseTarget[];
};

export type InternalDesignApplyToolInput = DesignApplyToolInput & {
  executionMode?: "atomic";
  rebaseGuard?: PlannedDesignRebaseGuard;
};

export type DesignApplyContractContext = {
  canonical?: boolean;
  internal?: boolean;
  /** Trusted composition only: the same model schema already validated this nested value. */
  modelSchemaValidated?: boolean;
};

const PLANNED_DESIGN_REBASE_TARGET_SCHEMA = Type.Object(
  {
    frameId: Type.String({ minLength: 1, maxLength: 256 }),
    pageId: Type.String({ minLength: 1, maxLength: 256 }),
    width: Type.Number({ exclusiveMinimum: 0, maximum: 100_000 }),
    height: Type.Number({ exclusiveMinimum: 0, maximum: 100_000 }),
  },
  { additionalProperties: false },
);

const PLANNED_DESIGN_REBASE_GUARD_SCHEMA = Type.Object(
  {
    fromRevision: Type.Integer({ minimum: 0 }),
    targets: Type.Array(PLANNED_DESIGN_REBASE_TARGET_SCHEMA, {
      minItems: 1,
      maxItems: 32,
    }),
  },
  { additionalProperties: false },
);

export const INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA = Type.Object(
  {
    label: Type.String({ minLength: 1, maxLength: 256 }),
    summary: Type.Optional(Type.String({ maxLength: 2_000 })),
    steps: Type.Optional(
      Type.Array(DESIGN_APPLY_STEP_SCHEMA, { minItems: 1, maxItems: 32 }),
    ),
    commands: Type.Array(DesignOperationSchema, {
      minItems: 1,
      maxItems: 1_000,
    }),
    executionMode: Type.Optional(Type.Literal("atomic")),
    rebaseGuard: Type.Optional(PLANNED_DESIGN_REBASE_GUARD_SCHEMA),
  },
  { additionalProperties: false },
);

export function designApplyRequiresPlan(input: DesignApplyToolInput): boolean {
  return input.commands.some(
    (command) =>
      command.type === "insert_element" || command.type === "replace_subtree",
  );
}

function parseDesignApply(
  input: unknown,
  context: DesignApplyContractContext = {},
): ValidationResult<InternalDesignApplyToolInput> {
  const internal = context.internal === true;
  const canonicalInput = context.canonical === true || internal;
  const structureIssues = context.modelSchemaValidated
    ? []
    : schemaIssues(
        canonicalInput
          ? INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA
          : DESIGN_APPLY_TOOL_INPUT_SCHEMA,
        input,
        "design_apply.schema_invalid",
      );
  if (structureIssues.length > 0) {
    return { ok: false, issues: structureIssues };
  }

  const canonical = canonicalInput
    ? (structuredClone(input) as InternalDesignApplyToolInput)
    : canonicalizeModelApply(input as DesignApplyToolInput);
  const canonicalIssues = canonicalInput
    ? []
    : canonicalCommandIssues(canonical);
  if (canonicalIssues.length > 0) {
    return { ok: false, issues: canonicalIssues };
  }

  const value = canonical;
  const domainIssues = refineDesignApply(value, internal);
  return domainIssues.length > 0
    ? { ok: false, issues: domainIssues }
    : { ok: true, value: structuredClone(value) };
}

export const DesignApplyContract = {
  schema: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  internalSchema: INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  parse: parseDesignApply,
  issues: (
    input: unknown,
    context: DesignApplyContractContext = {},
  ): ValidationIssue[] => {
    const result = parseDesignApply(input, context);
    return result.ok ? [] : result.issues;
  },
} as const;

function canonicalizeModelApply(
  input: DesignApplyToolInput,
): InternalDesignApplyToolInput {
  return {
    label: input.label,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.steps === undefined
      ? {}
      : { steps: structuredClone(input.steps) }),
    commands: input.commands.map((command) =>
      normalizeModelDesignOperation(command),
    ) as DesignOperation[],
  };
}

function normalizeModelDesignOperation(command: unknown): unknown {
  if (!isRecord(command)) {
    return command;
  }
  if (command.type === "replace_subtree" && Array.isArray(command.nodes)) {
    const rawNodes = command.nodes as unknown[];
    const normalized = {
      ...command,
      nodes: rawNodes.map((node) =>
        isRecord(node)
          ? {
              exportSettings: [],
              ...node,
              properties: normalizeModelNodeProperties(
                node.kind,
                node.properties,
              ),
            }
          : node,
      ),
    };
    return normalized;
  }
  if (
    command.type === "update_properties" &&
    Array.isArray(command.exportSettings)
  ) {
    const exportSettings = command.exportSettings.map(
      normalizeModelExportSetting,
    );
    return { ...command, exportSettings };
  }
  if (command.type !== "insert_element") {
    return structuredClone(command);
  }
  return normalizeModelInsertOperation(command);
}

function normalizeModelInsertOperation(
  command: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(command.node)) return undefined;
  return {
    ...command,
    node: {
      visible: true,
      locked: false,
      opacity: 1,
      exportSettings: [],
      extensions: {},
      ...command.node,
      parentId: command.parentId,
      childIds: command.node.childIds ?? [],
      properties: normalizeModelNodeProperties(
        command.node.kind,
        command.node.properties,
      ),
    },
  };
}

function normalizeModelNodeProperties(kind: unknown, value: unknown): unknown {
  if (!isRecord(value)) return value;
  const shapeDefaults = { fills: [], strokes: [], strokeWidth: 0 };
  if (kind === "frame") {
    return {
      ...shapeDefaults,
      cornerRadius: 0,
      clipsContent: false,
      ...value,
    };
  }
  if (kind === "rectangle" || kind === "polygon" || kind === "star") {
    return { ...shapeDefaults, cornerRadius: 0, ...value };
  }
  if (
    kind === "ellipse" ||
    kind === "line" ||
    kind === "text" ||
    kind === "vector" ||
    kind === "path"
  ) {
    return { ...shapeDefaults, ...value };
  }
  if (kind === "image") {
    return { cornerRadius: 0, ...value };
  }
  return value;
}

function normalizeModelExportSetting(value: unknown): unknown {
  if (!isRecord(value) || typeof value.suffix !== "string") return undefined;
  const common = {
    suffix: value.suffix,
    contentsOnly: true,
    useAbsoluteBounds: false,
    colorProfile: "DOCUMENT",
  } as const;
  if (value.format === "SVG" && typeof value.svgIdAttribute === "boolean") {
    return {
      ...common,
      format: "SVG",
      svgOutlineText: false,
      svgIdAttribute: value.svgIdAttribute,
      svgSimplifyStroke: true,
    };
  }
  if (
    (value.format === "PNG" ||
      value.format === "JPG" ||
      value.format === "WEBP") &&
    isRecord(value.constraint)
  ) {
    return {
      ...common,
      format: value.format,
      constraint: value.constraint,
    };
  }
  return undefined;
}

function refineDesignApply(
  input: InternalDesignApplyToolInput,
  internal: boolean,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!internal && input.executionMode !== undefined) {
    issues.push(
      issue(
        "design_apply.internal_field_not_permitted",
        "/executionMode",
        "executionMode is reserved for trusted host calls",
      ),
    );
  }
  if (!internal && input.rebaseGuard !== undefined) {
    issues.push(
      issue(
        "design_apply.internal_field_not_permitted",
        "/rebaseGuard",
        "rebaseGuard is reserved for trusted host calls",
      ),
    );
  }
  for (const [index, command] of input.commands.entries()) {
    if (!isPermittedApplyOperation(command, internal)) {
      issues.push(
        issue(
          operationWritesInstanceDirectly(command)
            ? "design_apply.instance_requires_component_tool"
            : "design_apply.operation_not_permitted",
          `/commands/${index}/type`,
          operationWritesInstanceDirectly(command)
            ? "Component instances must be authored through the dedicated component tool"
            : "This operation belongs to a dedicated design tool",
          undefined,
          command.type,
        ),
      );
    }
  }

  if (input.steps) {
    const seenStepIds = new Map<string, number>();
    for (const [index, step] of input.steps.entries()) {
      const previous = seenStepIds.get(step.stepId);
      if (previous !== undefined) {
        issues.push(
          issue(
            "design_apply.step_id_duplicate",
            `/steps/${index}/stepId`,
            `Step ID duplicates /steps/${previous}/stepId`,
            undefined,
            step.stepId,
          ),
        );
      } else {
        seenStepIds.set(step.stepId, index);
      }
    }
    const expected = input.commands.map((command) => command.commandId);
    const actual = input.steps.flatMap((step) => step.commandIds);
    if (
      expected.length !== actual.length ||
      expected.some((commandId, index) => actual[index] !== commandId)
    ) {
      issues.push(
        issue(
          "design_apply.step_command_order_invalid",
          "/steps",
          "Semantic steps must cover every command ID exactly once and in command order",
          expected,
          actual,
        ),
      );
    }
  }

  if (input.rebaseGuard) {
    const seenFrameIds = new Map<string, number>();
    for (const [index, target] of input.rebaseGuard.targets.entries()) {
      const previous = seenFrameIds.get(target.frameId);
      if (previous !== undefined) {
        issues.push(
          issue(
            "design_apply.rebase_frame_duplicate",
            `/rebaseGuard/targets/${index}/frameId`,
            `Rebase Frame duplicates /rebaseGuard/targets/${previous}/frameId`,
            undefined,
            target.frameId,
          ),
        );
      } else {
        seenFrameIds.set(target.frameId, index);
      }
    }
  }
  return issues;
}

function canonicalCommandIssues(
  input: InternalDesignApplyToolInput,
): ValidationIssue[] {
  return input.commands.flatMap((command, commandIndex) => {
    if (command.type === "insert_element") {
      return prefixedSchemaIssues(
        DesignNodeSchema,
        command.node,
        `/commands/${commandIndex}/node`,
      );
    }
    if (command.type === "replace_subtree") {
      return command.nodes.flatMap((node, nodeIndex) =>
        prefixedSchemaIssues(
          DesignNodeSchema,
          node,
          `/commands/${commandIndex}/nodes/${nodeIndex}`,
        ),
      );
    }
    return prefixedSchemaIssues(
      NodeDesignOperationSchema,
      command,
      `/commands/${commandIndex}`,
    );
  });
}

function prefixedSchemaIssues(
  schema: TSchema,
  value: unknown,
  prefix: string,
): ValidationIssue[] {
  return schemaValidationIssues(schema, value)
    .slice(0, 64)
    .map((validation) => ({
      code: "design_apply.canonical_invalid",
      path: `${prefix}${validation.path}`,
      message: validation.message,
      recovery:
        "Correct the reported field and submit one revised call; do not repeat unchanged arguments.",
    }));
}

function isPermittedApplyOperation(
  command: DesignOperation,
  internal: boolean,
): boolean {
  return (
    command.type !== "reflow_text" &&
    command.type !== "update_text_range_style" &&
    command.type !== "commit_text_edit" &&
    command.type !== "insert_page" &&
    command.type !== "update_page" &&
    command.type !== "move_page" &&
    command.type !== "delete_page" &&
    command.type !== "put_component" &&
    command.type !== "delete_component" &&
    command.type !== "put_image_asset_derivation" &&
    command.type !== "delete_image_asset_derivation" &&
    command.type !== "put_variable_collection" &&
    command.type !== "delete_variable_collection" &&
    command.type !== "move_variable_collection" &&
    command.type !== "put_variable" &&
    command.type !== "delete_variable" &&
    command.type !== "set_explicit_variable_modes" &&
    command.type !== "set_variable_binding" &&
    !operationWritesInstanceDirectly(command) &&
    (internal ||
      (command.type !== "put_asset" && command.type !== "delete_asset"))
  );
}

function operationWritesInstanceDirectly(command: DesignOperation): boolean {
  if (command.type === "insert_element") {
    return command.node.kind === "instance";
  }
  return (
    command.type === "replace_subtree" &&
    command.nodes.some((node) => node.kind === "instance")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaIssues(
  schema: TSchema,
  value: unknown,
  code: string,
): ValidationIssue[] {
  return schemaValidationIssues(schema, value)
    .slice(0, 64)
    .map((validation) => ({
      code,
      path: validation.path || "/",
      message: validation.message,
      recovery:
        "Correct the reported field and submit one revised call; do not repeat unchanged arguments.",
    }));
}

function issue(
  code: string,
  path: string,
  message: string,
  expected?: ValidationIssueValue,
  actual?: ValidationIssueValue,
): ValidationIssue {
  return {
    code,
    path,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
    recovery:
      "Correct the reported relationship and submit one revised call; do not repeat unchanged arguments.",
  };
}
