import type {
  DesignDocument,
  DesignOperation,
  LibraryReleaseSnapshot,
  VariableBindingTarget,
  VariableCollectionDefinition,
  VariableDefinition,
  VariableValue,
} from "@opendesign/design-contracts";
import {
  validateVariableDocument,
  variableCollectionDefinition,
  variableCollectionDefinitions,
  variableDefinition,
  variableDefinitions,
} from "@opendesign/variable-service";

export type VariableOperationFailureCode =
  "duplicate" | "invalid" | "not-found" | "referenced";

export type VariableOperationPlan =
  | { ok: true; commands: DesignOperation[] }
  | { ok: false; code: VariableOperationFailureCode; message: string };

export function planCreateVariableCollection(
  document: DesignDocument,
  input: {
    collectionId: string;
    key: string;
    name: string;
    defaultModeId: string;
    defaultModeName: string;
    commandPrefix: string;
  },
): VariableOperationPlan {
  if (variableCollectionDefinition(document, input.collectionId)) {
    return failure(
      "duplicate",
      `Collection ${input.collectionId} already exists`,
    );
  }
  if (
    variableCollectionDefinitions(document).some(
      (collection) => collection.key === input.key,
    )
  ) {
    return failure("duplicate", `Collection key ${input.key} already exists`);
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_put_collection`,
        type: "put_variable_collection",
        collection: {
          id: input.collectionId,
          key: input.key,
          name: input.name,
          hiddenFromPublishing: false,
          modes: [{ modeId: input.defaultModeId, name: input.defaultModeName }],
          variableIds: [],
          defaultModeId: input.defaultModeId,
          extensions: {},
        },
      },
    ],
  };
}

export function planUpdateVariableCollection(
  document: DesignDocument,
  input: {
    collection: VariableCollectionDefinition;
    commandPrefix: string;
  },
): VariableOperationPlan {
  if (!document.variableCollectionsById[input.collection.id]) {
    return failure(
      "not-found",
      `Collection ${input.collection.id} does not exist`,
    );
  }
  const projected = structuredClone(document);
  projected.variableCollectionsById[input.collection.id] = structuredClone(
    input.collection,
  );
  return validatedPlan(projected, [
    {
      commandId: `${input.commandPrefix}_put_collection`,
      type: "put_variable_collection",
      collection: structuredClone(input.collection),
    },
  ]);
}

export function planMoveVariableCollection(
  document: DesignDocument,
  input: { collectionId: string; index: number; commandPrefix: string },
): VariableOperationPlan {
  const from = document.variableCollectionOrder.indexOf(input.collectionId);
  if (from < 0) {
    return failure(
      "not-found",
      `Collection ${input.collectionId} does not exist`,
    );
  }
  if (
    input.index < 0 ||
    input.index >= document.variableCollectionOrder.length
  ) {
    return failure("invalid", "Collection index is out of range");
  }
  if (from === input.index)
    return failure("invalid", "Collection order is unchanged");
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_move_collection`,
        type: "move_variable_collection",
        collectionId: input.collectionId,
        index: input.index,
      },
    ],
  };
}

export function planAddVariableMode(
  document: DesignDocument,
  input: {
    collectionId: string;
    modeId: string;
    name: string;
    valuesByVariableId: Readonly<Record<string, VariableValue>>;
    commandPrefix: string;
  },
): VariableOperationPlan {
  const collection = document.variableCollectionsById[input.collectionId];
  if (!collection) {
    return failure(
      "not-found",
      `Collection ${input.collectionId} does not exist`,
    );
  }
  if (collection.modes.some((mode) => mode.modeId === input.modeId)) {
    return failure("duplicate", `Mode ${input.modeId} already exists`);
  }
  const projected = structuredClone(document);
  const nextCollection = structuredClone(collection);
  nextCollection.modes.push({ modeId: input.modeId, name: input.name });
  projected.variableCollectionsById[collection.id] = nextCollection;
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_put_collection`,
      type: "put_variable_collection",
      collection: nextCollection,
    },
  ];
  for (const variableId of collection.variableIds) {
    const value = input.valuesByVariableId[variableId];
    if (value === undefined) {
      return failure(
        "invalid",
        `Mode ${input.modeId} requires a value for ${variableId}`,
      );
    }
    const variable = projected.variablesById[variableId]!;
    variable.valuesByMode[input.modeId] = structuredClone(value);
    commands.push({
      commandId: `${input.commandPrefix}_put_${safeId(variableId)}`,
      type: "put_variable",
      variable: structuredClone(variable),
    });
  }
  return validatedPlan(projected, commands);
}

export function planRemoveVariableMode(
  document: DesignDocument,
  input: {
    collectionId: string;
    modeId: string;
    replacementModeId: string;
    commandPrefix: string;
  },
): VariableOperationPlan {
  const collection = document.variableCollectionsById[input.collectionId];
  if (!collection) {
    return failure(
      "not-found",
      `Collection ${input.collectionId} does not exist`,
    );
  }
  if (!collection.modes.some((mode) => mode.modeId === input.modeId)) {
    return failure("not-found", `Mode ${input.modeId} does not exist`);
  }
  if (
    input.modeId === input.replacementModeId ||
    !collection.modes.some((mode) => mode.modeId === input.replacementModeId)
  ) {
    return failure(
      "invalid",
      "Replacement mode must be another mode in the collection",
    );
  }
  const projected = structuredClone(document);
  const nextCollection = projected.variableCollectionsById[input.collectionId]!;
  nextCollection.modes = nextCollection.modes.filter(
    (mode) => mode.modeId !== input.modeId,
  );
  if (nextCollection.defaultModeId === input.modeId) {
    nextCollection.defaultModeId = input.replacementModeId;
  }
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_put_collection`,
      type: "put_variable_collection",
      collection: structuredClone(nextCollection),
    },
  ];
  for (const variableId of nextCollection.variableIds) {
    const variable = projected.variablesById[variableId]!;
    delete variable.valuesByMode[input.modeId];
    commands.push({
      commandId: `${input.commandPrefix}_put_${safeId(variableId)}`,
      type: "put_variable",
      variable: structuredClone(variable),
    });
  }
  appendModeReplacementCommands(
    projected,
    input.collectionId,
    input.modeId,
    input.replacementModeId,
    input.commandPrefix,
    commands,
  );
  return validatedPlan(projected, commands);
}

export function planCreateVariable(
  document: DesignDocument,
  input: {
    variable: VariableDefinition;
    index?: number;
    commandPrefix: string;
  },
): VariableOperationPlan {
  if (variableDefinition(document, input.variable.id)) {
    return failure("duplicate", `Variable ${input.variable.id} already exists`);
  }
  if (
    variableDefinitions(document).some(
      (entry) => entry.key === input.variable.key,
    )
  ) {
    return failure(
      "duplicate",
      `Variable key ${input.variable.key} already exists`,
    );
  }
  const collection =
    document.variableCollectionsById[input.variable.variableCollectionId];
  if (!collection) {
    return failure(
      "not-found",
      `Collection ${input.variable.variableCollectionId} does not exist`,
    );
  }
  const index = input.index ?? collection.variableIds.length;
  if (index < 0 || index > collection.variableIds.length) {
    return failure("invalid", "Variable index is out of range");
  }
  const projected = structuredClone(document);
  projected.variablesById[input.variable.id] = structuredClone(input.variable);
  const nextCollection = projected.variableCollectionsById[collection.id]!;
  nextCollection.variableIds.splice(index, 0, input.variable.id);
  return validatedPlan(projected, [
    {
      commandId: `${input.commandPrefix}_put_collection`,
      type: "put_variable_collection",
      collection: structuredClone(nextCollection),
    },
    {
      commandId: `${input.commandPrefix}_put_variable`,
      type: "put_variable",
      variable: structuredClone(input.variable),
    },
  ]);
}

export function planUpdateVariable(
  document: DesignDocument,
  input: { variable: VariableDefinition; commandPrefix: string },
): VariableOperationPlan {
  const current = document.variablesById[input.variable.id];
  if (!current)
    return failure("not-found", `Variable ${input.variable.id} does not exist`);
  if (current.variableCollectionId !== input.variable.variableCollectionId) {
    return failure(
      "invalid",
      "Moving a Variable between collections is not supported in v1",
    );
  }
  const projected = structuredClone(document);
  projected.variablesById[input.variable.id] = structuredClone(input.variable);
  return validatedPlan(projected, [
    {
      commandId: `${input.commandPrefix}_put_variable`,
      type: "put_variable",
      variable: structuredClone(input.variable),
    },
  ]);
}

export function planDeleteVariable(
  document: DesignDocument,
  input: { variableId: string; commandPrefix: string },
): VariableOperationPlan {
  const variable = document.variablesById[input.variableId];
  if (!variable)
    return failure("not-found", `Variable ${input.variableId} does not exist`);
  const aliasOwner = aliasReferenceOwner(document, new Set([input.variableId]));
  if (aliasOwner) {
    return failure(
      "referenced",
      `Variable ${input.variableId} is aliased by ${aliasOwner}`,
    );
  }
  const projected = structuredClone(document);
  delete projected.variablesById[input.variableId];
  const collection =
    projected.variableCollectionsById[variable.variableCollectionId]!;
  collection.variableIds = collection.variableIds.filter(
    (id) => id !== input.variableId,
  );
  const commands: DesignOperation[] = [
    {
      commandId: `${input.commandPrefix}_put_collection`,
      type: "put_variable_collection",
      collection: structuredClone(collection),
    },
  ];
  appendClearBindingCommands(
    projected,
    new Set([input.variableId]),
    input.commandPrefix,
    commands,
  );
  commands.push({
    commandId: `${input.commandPrefix}_delete_variable`,
    type: "delete_variable",
    variableId: input.variableId,
  });
  return validatedPlan(projected, commands);
}

export function planDeleteVariableCollection(
  document: DesignDocument,
  input: { collectionId: string; commandPrefix: string },
): VariableOperationPlan {
  const collection = document.variableCollectionsById[input.collectionId];
  if (!collection) {
    return failure(
      "not-found",
      `Collection ${input.collectionId} does not exist`,
    );
  }
  const owned = new Set(collection.variableIds);
  const aliasOwner = aliasReferenceOwner(document, owned, owned);
  if (aliasOwner) {
    return failure(
      "referenced",
      `Collection ${input.collectionId} is aliased by variable ${aliasOwner} outside the collection`,
    );
  }
  const projected = structuredClone(document);
  const commands: DesignOperation[] = [];
  appendClearBindingCommands(projected, owned, input.commandPrefix, commands);
  appendCollectionModeClearCommands(
    projected,
    input.collectionId,
    input.commandPrefix,
    commands,
  );
  for (const variableId of collection.variableIds) {
    delete projected.variablesById[variableId];
    commands.push({
      commandId: `${input.commandPrefix}_delete_${safeId(variableId)}`,
      type: "delete_variable",
      variableId,
    });
  }
  delete projected.variableCollectionsById[input.collectionId];
  projected.variableCollectionOrder = projected.variableCollectionOrder.filter(
    (id) => id !== input.collectionId,
  );
  commands.push({
    commandId: `${input.commandPrefix}_delete_collection`,
    type: "delete_variable_collection",
    collectionId: input.collectionId,
  });
  return validatedPlan(projected, commands);
}

export function planSetExplicitVariableMode(
  document: DesignDocument,
  input: {
    target: { kind: "page" | "node"; id: string };
    collectionId: string;
    modeId: string | null;
    commandPrefix: string;
  },
): VariableOperationPlan {
  const target =
    input.target.kind === "page"
      ? document.pagesById[input.target.id]
      : document.nodesById[input.target.id];
  if (!target)
    return failure(
      "not-found",
      `${input.target.kind} ${input.target.id} does not exist`,
    );
  const collection = variableCollectionDefinition(document, input.collectionId);
  if (!collection)
    return failure(
      "not-found",
      `Collection ${input.collectionId} does not exist`,
    );
  if (
    input.modeId !== null &&
    !collection.modes.some((mode) => mode.modeId === input.modeId)
  ) {
    return failure("not-found", `Mode ${input.modeId} does not exist`);
  }
  const modes = { ...(target.explicitVariableModes ?? {}) };
  if (input.modeId === null) delete modes[input.collectionId];
  else modes[input.collectionId] = input.modeId;
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_set_mode`,
        type: "set_explicit_variable_modes",
        target: input.target,
        explicitVariableModes: modes,
      },
    ],
  };
}

export function planSetVariableBinding(
  document: DesignDocument,
  input: {
    target: VariableBindingTarget;
    variableId: string | null;
    commandPrefix: string;
  },
): VariableOperationPlan {
  const node = document.nodesById[input.target.nodeId];
  if (!node)
    return failure("not-found", `Node ${input.target.nodeId} does not exist`);
  if (
    input.target.kind === "node" &&
    input.target.field === "characters" &&
    node.kind !== "text"
  ) {
    return failure("invalid", "characters binding requires a Text node");
  }
  const expected =
    input.target.kind === "paint"
      ? "COLOR"
      : input.target.field === "visible"
        ? "BOOLEAN"
        : input.target.field === "opacity"
          ? "FLOAT"
          : "STRING";
  const variable = input.variableId
    ? variableDefinition(document, input.variableId)
    : undefined;
  if (input.variableId && !variable) {
    return failure("not-found", `Variable ${input.variableId} does not exist`);
  }
  if (variable && variable.resolvedType !== expected) {
    return failure("invalid", `${input.target.field} requires ${expected}`);
  }
  return {
    ok: true,
    commands: [
      {
        commandId: `${input.commandPrefix}_set_binding`,
        type: "set_variable_binding",
        target: input.target,
        variable: input.variableId
          ? { type: "VARIABLE_ALIAS", id: input.variableId }
          : null,
      },
    ],
  };
}

export function planApplyLibraryVariable(
  document: DesignDocument,
  release: LibraryReleaseSnapshot,
  input: {
    variableId: string;
    target: VariableBindingTarget;
    commandPrefix: string;
  },
): VariableOperationPlan {
  const requiredVariableIds: string[] = [];
  const requiredCollectionIds = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (variableId: string): VariableOperationPlan | null => {
    if (visited.has(variableId)) return null;
    if (visiting.has(variableId)) {
      return failure(
        "invalid",
        `Library Variable alias cycle at ${variableId}`,
      );
    }
    const source = release.variablesById[variableId];
    if (!source) {
      return failure(
        "not-found",
        `Variable ${variableId} is not part of Library ${release.libraryId}`,
      );
    }
    const collectionId = source.variable.variableCollectionId;
    if (!release.variableCollectionsById[collectionId]) {
      return failure(
        "invalid",
        `Library Variable ${variableId} is missing Collection ${collectionId}`,
      );
    }
    visiting.add(variableId);
    for (const value of Object.values(source.variable.valuesByMode)) {
      if (!isAlias(value)) continue;
      const nested = visit(value.id);
      if (nested) return nested;
    }
    visiting.delete(variableId);
    visited.add(variableId);
    requiredCollectionIds.add(collectionId);
    requiredVariableIds.push(variableId);
    return null;
  };
  const dependencyFailure = visit(input.variableId);
  if (dependencyFailure) return dependencyFailure;

  const staged = structuredClone(document);
  const commands: DesignOperation[] = [];
  for (const collectionId of [...requiredCollectionIds].sort()) {
    const source = release.variableCollectionsById[collectionId]!;
    const local = document.variableCollectionsById[collectionId];
    if (local) {
      return failure(
        "duplicate",
        `Library Collection ${collectionId} conflicts with a local Collection`,
      );
    }
    const collectionKeyOwner = variableCollectionDefinitions(document).find(
      (collection) =>
        collection.id !== collectionId &&
        collection.key === source.collection.key,
    );
    if (collectionKeyOwner) {
      return failure(
        "duplicate",
        `Library Collection key ${source.collection.key} conflicts with Collection ${collectionKeyOwner.id}`,
      );
    }
    const imported = document.libraryVariableCollectionsById[collectionId];
    if (imported && !sameLibraryCollectionIdentity(imported, source)) {
      return failure(
        "duplicate",
        `Collection ${collectionId} conflicts with another Library source`,
      );
    }
    staged.libraryVariableCollectionsById[collectionId] =
      structuredClone(source);
    if (!imported || JSON.stringify(imported) !== JSON.stringify(source)) {
      commands.push({
        commandId: `${input.commandPrefix}_put_collection_${safeId(collectionId)}`,
        type: "put_library_variable_collection_source",
        source: structuredClone(source),
      });
    }
  }
  for (const variableId of requiredVariableIds) {
    const source = release.variablesById[variableId]!;
    const local = document.variablesById[variableId];
    if (local) {
      return failure(
        "duplicate",
        `Library Variable ${variableId} conflicts with a local Variable`,
      );
    }
    const variableKeyOwner = variableDefinitions(document).find(
      (variable) =>
        variable.id !== variableId && variable.key === source.variable.key,
    );
    if (variableKeyOwner) {
      return failure(
        "duplicate",
        `Library Variable key ${source.variable.key} conflicts with Variable ${variableKeyOwner.id}`,
      );
    }
    const imported = document.libraryVariablesById[variableId];
    if (imported && !sameLibraryVariableIdentity(imported, source)) {
      return failure(
        "duplicate",
        `Variable ${variableId} conflicts with another Library source`,
      );
    }
    staged.libraryVariablesById[variableId] = structuredClone(source);
    if (!imported || JSON.stringify(imported) !== JSON.stringify(source)) {
      commands.push({
        commandId: `${input.commandPrefix}_put_variable_${safeId(variableId)}`,
        type: "put_library_variable_source",
        source: structuredClone(source),
      });
    }
  }
  const binding = planSetVariableBinding(staged, {
    target: input.target,
    variableId: input.variableId,
    commandPrefix: input.commandPrefix,
  });
  if (!binding.ok) return binding;
  commands.push(...binding.commands);
  return { ok: true, commands };
}

function sameLibraryCollectionIdentity(
  current: DesignDocument["libraryVariableCollectionsById"][string],
  next: DesignDocument["libraryVariableCollectionsById"][string],
): boolean {
  return sameLibraryIdentity(current.source, next.source, "collection");
}

function sameLibraryVariableIdentity(
  current: DesignDocument["libraryVariablesById"][string],
  next: DesignDocument["libraryVariablesById"][string],
): boolean {
  return sameLibraryIdentity(current.source, next.source, "variable");
}

function sameLibraryIdentity(
  current:
    | DesignDocument["libraryVariablesById"][string]["source"]
    | DesignDocument["libraryVariableCollectionsById"][string]["source"],
  next:
    | DesignDocument["libraryVariablesById"][string]["source"]
    | DesignDocument["libraryVariableCollectionsById"][string]["source"],
  kind: "collection" | "variable",
): boolean {
  return (
    current.libraryId === next.libraryId &&
    current.sourceProjectId === next.sourceProjectId &&
    current.sourceDesignFileId === next.sourceDesignFileId &&
    current.sourceDocumentId === next.sourceDocumentId &&
    (kind === "collection"
      ? "sourceVariableCollectionId" in current &&
        "sourceVariableCollectionId" in next &&
        current.sourceVariableCollectionId === next.sourceVariableCollectionId
      : "sourceVariableId" in current &&
        "sourceVariableId" in next &&
        current.sourceVariableId === next.sourceVariableId)
  );
}

function appendModeReplacementCommands(
  projected: DesignDocument,
  collectionId: string,
  removedModeId: string,
  replacementModeId: string,
  commandPrefix: string,
  commands: DesignOperation[],
): void {
  for (const [pageId, page] of Object.entries(projected.pagesById)) {
    if (page.explicitVariableModes?.[collectionId] !== removedModeId) continue;
    page.explicitVariableModes[collectionId] = replacementModeId;
    commands.push({
      commandId: `${commandPrefix}_mode_page_${safeId(pageId)}`,
      type: "set_explicit_variable_modes",
      target: { kind: "page", id: pageId },
      explicitVariableModes: structuredClone(page.explicitVariableModes),
    });
  }
  for (const [nodeId, node] of Object.entries(projected.nodesById)) {
    if (node.explicitVariableModes?.[collectionId] !== removedModeId) continue;
    node.explicitVariableModes[collectionId] = replacementModeId;
    commands.push({
      commandId: `${commandPrefix}_mode_node_${safeId(nodeId)}`,
      type: "set_explicit_variable_modes",
      target: { kind: "node", id: nodeId },
      explicitVariableModes: structuredClone(node.explicitVariableModes),
    });
  }
}

function appendCollectionModeClearCommands(
  projected: DesignDocument,
  collectionId: string,
  commandPrefix: string,
  commands: DesignOperation[],
): void {
  for (const [pageId, page] of Object.entries(projected.pagesById)) {
    if (!page.explicitVariableModes?.[collectionId]) continue;
    delete page.explicitVariableModes[collectionId];
    commands.push({
      commandId: `${commandPrefix}_clear_page_${safeId(pageId)}`,
      type: "set_explicit_variable_modes",
      target: { kind: "page", id: pageId },
      explicitVariableModes: structuredClone(page.explicitVariableModes),
    });
  }
  for (const [nodeId, node] of Object.entries(projected.nodesById)) {
    if (!node.explicitVariableModes?.[collectionId]) continue;
    delete node.explicitVariableModes[collectionId];
    commands.push({
      commandId: `${commandPrefix}_clear_node_${safeId(nodeId)}`,
      type: "set_explicit_variable_modes",
      target: { kind: "node", id: nodeId },
      explicitVariableModes: structuredClone(node.explicitVariableModes),
    });
  }
}

function appendClearBindingCommands(
  projected: DesignDocument,
  variableIds: ReadonlySet<string>,
  commandPrefix: string,
  commands: DesignOperation[],
): void {
  for (const [nodeId, node] of Object.entries(projected.nodesById)) {
    for (const [field, alias] of Object.entries(node.boundVariables ?? {})) {
      if (!variableIds.has(alias.id)) continue;
      const target = { kind: "node", nodeId, field } as VariableBindingTarget;
      delete node.boundVariables?.[
        field as keyof NonNullable<typeof node.boundVariables>
      ];
      commands.push({
        commandId: `${commandPrefix}_clear_${safeId(nodeId)}_${field}`,
        type: "set_variable_binding",
        target,
        variable: null,
      });
    }
    for (const paintField of ["fills", "strokes"] as const) {
      const paints = nodePaints(node, paintField);
      paints?.forEach((paint, paintIndex) => {
        if (paint.type !== "solid") return;
        const alias = paint.boundVariables?.color;
        if (!alias || !variableIds.has(alias.id)) return;
        delete paint.boundVariables;
        commands.push({
          commandId: `${commandPrefix}_clear_${safeId(nodeId)}_${paintField}_${paintIndex}`,
          type: "set_variable_binding",
          target: {
            kind: "paint",
            nodeId,
            paintField,
            paintIndex,
            field: "color",
          },
          variable: null,
        });
      });
    }
  }
}

function nodePaints(
  node: DesignDocument["nodesById"][string],
  field: "fills" | "strokes",
) {
  if (
    node.kind === "frame" ||
    node.kind === "slot" ||
    node.kind === "rectangle" ||
    node.kind === "ellipse" ||
    node.kind === "line" ||
    node.kind === "polygon" ||
    node.kind === "star" ||
    node.kind === "text" ||
    node.kind === "path" ||
    node.kind === "vector" ||
    node.kind === "boolean"
  )
    return node.properties[field];
  return undefined;
}

function aliasReferenceOwner(
  document: DesignDocument,
  targets: ReadonlySet<string>,
  ignoredOwners: ReadonlySet<string> = new Set(),
): string | null {
  for (const variable of variableDefinitions(document)) {
    if (ignoredOwners.has(variable.id)) continue;
    if (
      Object.values(variable.valuesByMode).some(
        (value) => isAlias(value) && targets.has(value.id),
      )
    )
      return variable.id;
  }
  return null;
}

function isAlias(
  value: VariableValue,
): value is { type: "VARIABLE_ALIAS"; id: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "VARIABLE_ALIAS"
  );
}

function validatedPlan(
  projected: DesignDocument,
  commands: DesignOperation[],
): VariableOperationPlan {
  const first = validateVariableDocument(projected)[0];
  return first
    ? failure("invalid", `${first.path}: ${first.message}`)
    : { ok: true, commands };
}

function failure(
  code: VariableOperationFailureCode,
  message: string,
): VariableOperationPlan {
  return { ok: false, code, message };
}

function safeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "_");
}
