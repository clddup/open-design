import {
  DesignNodeSchema,
  NodeDesignOperationSchema,
  isDesignOperation,
  schemaValidationIssues,
  type DesignOperation,
} from "@opendesign/design-contracts";

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

export function normalizeDesignApplyToolInput(
  input: unknown,
): DesignApplyToolInput | undefined {
  if (!isApplyInputEnvelope(input, false)) return undefined;
  const commands: DesignOperation[] = [];
  for (const rawCommand of input.commands) {
    const command = normalizeModelDesignOperation(rawCommand);
    if (!command || !isPermittedApplyOperation(command, false)) {
      return undefined;
    }
    commands.push(command);
  }
  return {
    label: input.label,
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.steps === undefined
      ? {}
      : { steps: structuredClone(input.steps) as DesignApplyStep[] }),
    commands,
  };
}

export function explainInvalidDesignApplyToolInput(
  input: unknown,
): string | undefined {
  if (normalizeDesignApplyToolInput(input)) return undefined;
  if (!isRecord(input)) {
    return "The design transaction must be an object with label and commands.";
  }
  if (
    typeof input.label !== "string" ||
    input.label.length === 0 ||
    input.label.length > 256
  ) {
    return "The design transaction label must contain 1..256 characters.";
  }
  if (!Array.isArray(input.commands) || input.commands.length === 0) {
    return "The design transaction commands must be a non-empty array.";
  }
  if (input.commands.length > 1_000) {
    return "The design transaction cannot contain more than 1000 commands.";
  }
  if (
    input.summary !== undefined &&
    (typeof input.summary !== "string" || input.summary.length > 2_000)
  ) {
    return "The design transaction summary must be a string of at most 2000 characters.";
  }
  const extraKeys = Object.keys(input).filter(
    (key) => !["label", "summary", "steps", "commands"].includes(key),
  );
  if (extraKeys.length > 0) {
    return `The design transaction has unsupported field(s): ${extraKeys.join(", ")}.`;
  }
  if (!validRawDesignApplySteps(input.steps, input.commands)) {
    return "The design transaction steps must reference every commandId exactly once and in command order.";
  }

  const issues = input.commands.flatMap((command, index) =>
    explainInvalidModelOperation(command, index),
  );
  if (issues.length === 0) {
    return "The design transaction contains an operation that apply_transaction does not permit. Use the dedicated component, page, text, asset, variable, or style tool for that operation.";
  }
  return [
    "The design transaction has invalid command fields:",
    ...issues.slice(0, 12).map((issue) => `- ${issue}`),
    "Correct these exact fields and retry the transaction.",
  ].join("\n");
}

export function isDesignApplyToolInput(
  input: unknown,
): input is DesignApplyToolInput {
  return isNormalizedDesignApplyToolInput(input, false);
}

export function isInternalDesignApplyToolInput(
  input: unknown,
): input is InternalDesignApplyToolInput {
  return isNormalizedDesignApplyToolInput(input, true);
}

function normalizeModelDesignOperation(
  command: unknown,
): DesignOperation | undefined {
  if (!isRecord(command)) {
    return undefined;
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
    return isDesignOperation(normalized) ? normalized : undefined;
  }
  if (
    command.type === "update_properties" &&
    Array.isArray(command.exportSettings)
  ) {
    const exportSettings = command.exportSettings.map(
      normalizeModelExportSetting,
    );
    if (exportSettings.some((setting) => setting === undefined)) {
      return undefined;
    }
    const normalized = { ...command, exportSettings };
    return isDesignOperation(normalized) ? normalized : undefined;
  }
  if (command.type !== "insert_element") {
    return isDesignOperation(command) ? command : undefined;
  }
  const normalized = normalizeModelInsertOperation(command);
  return normalized && isDesignOperation(normalized) ? normalized : undefined;
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

function explainInvalidModelOperation(value: unknown, index: number): string[] {
  if (!isRecord(value)) return [`command[${index}] must be an object`];
  const commandId =
    typeof value.commandId === "string" ? value.commandId : `command[${index}]`;
  if (value.type === "insert_element") {
    const normalized = normalizeModelInsertOperation(value);
    if (!normalized || !isRecord(normalized.node)) {
      return [`${commandId} /node: Expected an insert node object`];
    }
    const nodeId =
      typeof normalized.node.id === "string"
        ? normalized.node.id
        : "<unknown-node>";
    return schemaValidationIssues(DesignNodeSchema, normalized.node).map(
      (issue) => `${commandId} node ${nodeId} ${issue.path}: ${issue.message}`,
    );
  }
  if (value.type === "replace_subtree" && Array.isArray(value.nodes)) {
    return value.nodes.flatMap((node, nodeIndex) => {
      if (!isRecord(node)) {
        return [`${commandId} /nodes/${nodeIndex}: Expected a node object`];
      }
      const normalized: Record<string, unknown> = {
        exportSettings: [],
        ...node,
        properties: normalizeModelNodeProperties(node.kind, node.properties),
      };
      const nodeId =
        typeof normalized.id === "string" ? normalized.id : "<unknown-node>";
      return schemaValidationIssues(DesignNodeSchema, normalized).map(
        (issue) =>
          `${commandId} node ${nodeId} /nodes/${nodeIndex}${issue.path}: ${issue.message}`,
      );
    });
  }
  return schemaValidationIssues(NodeDesignOperationSchema, value).map(
    (issue) => `${commandId} ${issue.path}: ${issue.message}`,
  );
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

function isNormalizedDesignApplyToolInput(
  input: unknown,
  internal: boolean,
): input is InternalDesignApplyToolInput {
  if (!isApplyInputEnvelope(input, internal)) return false;
  return (
    input.commands.every(
      (command) =>
        isDesignOperation(command) &&
        isPermittedApplyOperation(command, internal),
    ) &&
    validRawDesignApplySteps(input.steps, input.commands) &&
    (!internal ||
      input.executionMode === undefined ||
      input.executionMode === "atomic") &&
    (!internal ||
      input.rebaseGuard === undefined ||
      isPlannedDesignRebaseGuard(input.rebaseGuard))
  );
}

function isApplyInputEnvelope(
  input: unknown,
  internal: boolean,
): input is Record<string, unknown> & {
  label: string;
  summary?: string;
  steps?: unknown;
  commands: unknown[];
} {
  return (
    isRecord(input) &&
    typeof input.label === "string" &&
    input.label.length > 0 &&
    input.label.length <= 256 &&
    (input.summary === undefined ||
      (typeof input.summary === "string" && input.summary.length <= 2_000)) &&
    Array.isArray(input.commands) &&
    input.commands.length > 0 &&
    input.commands.length <= 1_000 &&
    validRawDesignApplySteps(input.steps, input.commands) &&
    Object.keys(input).every((key) =>
      [
        "label",
        "summary",
        "steps",
        "commands",
        ...(internal ? ["executionMode", "rebaseGuard"] : []),
      ].includes(key),
    )
  );
}

function validRawDesignApplySteps(
  value: unknown,
  commands: readonly unknown[],
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > 32) {
    return false;
  }
  const commandIds = commands.map((command) =>
    isRecord(command) ? command.commandId : undefined,
  );
  const flattened: unknown[] = [];
  const stepIds = new Set<string>();
  for (const stepValue of value) {
    if (!isRecord(stepValue)) return false;
    const stepId = stepValue.stepId;
    if (
      !safeId(stepId) ||
      stepIds.has(stepId) ||
      typeof stepValue.label !== "string" ||
      stepValue.label.length === 0 ||
      stepValue.label.length > 256 ||
      !Array.isArray(stepValue.commandIds) ||
      stepValue.commandIds.length === 0 ||
      !stepValue.commandIds.every(safeId) ||
      !hasExactKeys(stepValue, ["stepId", "label", "commandIds"])
    ) {
      return false;
    }
    stepIds.add(stepId);
    flattened.push(...stepValue.commandIds);
  }
  return (
    flattened.length === commandIds.length &&
    flattened.every((commandId, index) => commandId === commandIds[index])
  );
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

function isPlannedDesignRebaseGuard(
  value: unknown,
): value is PlannedDesignRebaseGuard {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.fromRevision) ||
    Number(value.fromRevision) < 0 ||
    !Array.isArray(value.targets) ||
    value.targets.length === 0 ||
    value.targets.length > 32 ||
    !value.targets.every(isPlannedDesignRebaseTarget) ||
    !hasExactKeys(value, ["fromRevision", "targets"])
  ) {
    return false;
  }
  return (
    new Set(value.targets.map((target) => target.frameId)).size ===
    value.targets.length
  );
}

function isPlannedDesignRebaseTarget(
  target: unknown,
): target is PlannedDesignRebaseTarget {
  return (
    isRecord(target) &&
    safeId(target.frameId) &&
    safeId(target.pageId) &&
    typeof target.width === "number" &&
    Number.isFinite(target.width) &&
    target.width > 0 &&
    target.width <= 100_000 &&
    typeof target.height === "number" &&
    Number.isFinite(target.height) &&
    target.height > 0 &&
    target.height <= 100_000 &&
    hasExactKeys(target, ["frameId", "pageId", "width", "height"])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}
