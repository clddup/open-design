import {
  DesignOperationSchema,
  MAX_TRANSACTION_COMMANDS,
  Type,
  designCommandListDomainIssues,
  type DesignOperation,
} from "@opendesign/design-contracts";
import {
  type ValidationIssue,
  type ValidationIssueValue,
  type ValidationResult,
  validateContract,
} from "./contract-validation";
import {
  DESIGN_APPLY_STEP_SCHEMA,
  DESIGN_APPLY_TOOL_INPUT_SCHEMA,
  DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND,
  DESIGN_MODEL_PAINT_PROPERTY_KEYS_BY_TYPE,
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
      maxItems: MAX_TRANSACTION_COMMANDS,
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
  if (canonicalInput) {
    return validateContract<
      InternalDesignApplyToolInput,
      InternalDesignApplyToolInput,
      DesignApplyContractContext
    >(
      {
        schema: INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA,
        code: "design_apply.schema_invalid",
        subject: "canonical Design Apply",
        maximum: 64,
        refine: (value) => refineDesignApply(value, internal),
      },
      input,
      context,
    );
  }
  return validateContract<
    DesignApplyToolInput,
    InternalDesignApplyToolInput,
    DesignApplyContractContext
  >(
    {
      schema: DESIGN_APPLY_TOOL_INPUT_SCHEMA,
      code: "design_apply.schema_invalid",
      subject: "Design Apply",
      maximum: 64,
      refineModel: refineModelApplyNodeProperties,
      bind: compileModelApply,
      canonical: {
        schema: INTERNAL_DESIGN_APPLY_TOOL_INPUT_SCHEMA,
        code: "design_apply.compiler_invariant_failed",
        subject: "compiled Design Apply",
        maximum: 64,
      },
      refine: (value) => refineDesignApply(value, false),
    },
    input,
    context,
    { structureValidated: context.modelSchemaValidated === true },
  );
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

function refineModelApplyNodeProperties(
  input: DesignApplyToolInput,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  input.commands.forEach((command, commandIndex) => {
    if (command.type === "insert_element") {
      refineModelNodeProperties(
        command.node,
        `/commands/${commandIndex}/node`,
        issues,
      );
      return;
    }
    if (command.type === "update_properties") {
      refineModelPaintCollections(
        command.properties,
        `/commands/${commandIndex}/properties`,
        issues,
      );
      return;
    }
    if (command.type !== "replace_subtree") return;
    command.nodes.forEach((node, nodeIndex) =>
      refineModelNodeProperties(
        node,
        `/commands/${commandIndex}/nodes/${nodeIndex}`,
        issues,
      ),
    );
  });
  return issues;
}

function refineModelNodeProperties(
  node: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(node) || typeof node.kind !== "string") return;
  if (!Object.hasOwn(DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND, node.kind)) {
    return;
  }
  if (!isRecord(node.properties)) return;
  const kind =
    node.kind as keyof typeof DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND;
  const allowed = new Set(DESIGN_MODEL_NODE_PROPERTY_KEYS_BY_KIND[kind]);
  for (const key of Object.keys(node.properties)) {
    if (allowed.has(key)) continue;
    issues.push({
      code: "design_apply.node_property_not_supported",
      path: `${path}/properties/${escapePointer(key)}`,
      message: `Property ${key} is not supported by ${kind} nodes`,
      expected: [...allowed],
      actual: key,
      recovery:
        "Remove the unrelated property or use the node kind that owns it; do not rely on canonical validation to reinterpret the node.",
    });
  }
  refineModelPaintCollections(node.properties, `${path}/properties`, issues);
  if (kind !== "path" && kind !== "vector") return;
  if (
    Object.hasOwn(node.properties, "path") &&
    Object.hasOwn(node.properties, "network")
  ) {
    issues.push({
      code: "design_apply.geometry_source_ambiguous",
      path: `${path}/properties`,
      message: `${kind} properties require exactly one geometry source`,
      expected: "path or network",
      actual: "path and network",
      recovery:
        "Keep path for exact imported SVG data or network for editable topology, never both.",
    });
  }
}

function refineModelPaintCollections(
  properties: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(properties)) return;
  for (const field of ["fills", "strokes"] as const) {
    const paints = properties[field];
    if (!Array.isArray(paints)) continue;
    paints.forEach((paint, index) =>
      refineModelPaint(paint, `${path}/${field}/${index}`, issues),
    );
  }
}

function refineModelPaint(
  paint: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(paint) || typeof paint.type !== "string") return;
  if (!Object.hasOwn(DESIGN_MODEL_PAINT_PROPERTY_KEYS_BY_TYPE, paint.type)) {
    return;
  }
  const type =
    paint.type as keyof typeof DESIGN_MODEL_PAINT_PROPERTY_KEYS_BY_TYPE;
  const allowed = new Set<string>(
    DESIGN_MODEL_PAINT_PROPERTY_KEYS_BY_TYPE[type],
  );
  for (const key of Object.keys(paint)) {
    if (allowed.has(key)) continue;
    issues.push({
      code: "design_apply.paint_property_not_supported",
      path: `${path}/${escapePointer(key)}`,
      message: `Property ${key} is not supported by ${type} paints`,
      expected: [...allowed],
      actual: key,
      recovery:
        "Remove the field or use the Paint type that owns it; keep each Paint branch structurally unambiguous.",
    });
  }
}

function compileModelApply(
  input: DesignApplyToolInput,
): InternalDesignApplyToolInput {
  return {
    label: input.label,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.steps === undefined
      ? {}
      : { steps: structuredClone(input.steps) }),
    commands: input.commands.map((command) =>
      compileModelDesignOperation(command),
    ) as DesignOperation[],
  };
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function compileModelDesignOperation(command: unknown): unknown {
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
              properties: compileModelNodeProperties(
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
      compileModelExportSetting,
    );
    return { ...command, exportSettings };
  }
  if (command.type !== "insert_element") {
    return structuredClone(command);
  }
  return compileModelInsertOperation(command);
}

function compileModelInsertOperation(
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
      properties: compileModelNodeProperties(
        command.node.kind,
        command.node.properties,
      ),
    },
  };
}

function compileModelNodeProperties(kind: unknown, value: unknown): unknown {
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

function compileModelExportSetting(value: unknown): unknown {
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
  issues.push(...designCommandListDomainIssues(input.commands));
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
