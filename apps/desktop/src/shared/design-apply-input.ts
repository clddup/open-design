import {
  isDesignOperation,
  type DesignOperation,
} from "@opendesign/design-contracts";

export type DesignApplyToolInput = {
  label: string;
  summary?: string;
  commands: DesignOperation[];
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
    commands,
  };
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
  if (!isRecord(command) || command.type !== "insert_element") {
    return isDesignOperation(command) ? command : undefined;
  }
  if (!isRecord(command.node)) return undefined;
  const normalized = {
    ...command,
    node: {
      visible: true,
      locked: false,
      opacity: 1,
      extensions: {},
      ...command.node,
      parentId: command.parentId,
      childIds: command.node.childIds ?? [],
    },
  };
  return isDesignOperation(normalized) ? normalized : undefined;
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
    Object.keys(input).every((key) =>
      [
        "label",
        "summary",
        "commands",
        ...(internal ? ["rebaseGuard"] : []),
      ].includes(key),
    )
  );
}

function isPermittedApplyOperation(
  command: DesignOperation,
  internal: boolean,
): boolean {
  return (
    command.type !== "insert_page" &&
    command.type !== "update_page" &&
    command.type !== "move_page" &&
    command.type !== "delete_page" &&
    command.type !== "put_component" &&
    command.type !== "delete_component" &&
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
