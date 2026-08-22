import type {
  DesignDocument,
  DesignNode,
  Paint,
  VariableAlias,
  VariableCollectionDefinition,
  VariableResolvedDataType,
  VariableValue,
} from "@opendesign/design-contracts";
import {
  colorToHex,
  isColor,
  isVariableAlias,
  valueMatchesType,
} from "./value-support.js";

export const VARIABLE_SERVICE_VERSION = 1 as const;

export type VariableResolutionIssueCode =
  | "alias-cycle"
  | "binding-type-mismatch"
  | "invalid-binding-value"
  | "invalid-collection"
  | "invalid-mode"
  | "invalid-value"
  | "missing-alias"
  | "missing-collection"
  | "missing-consumer"
  | "missing-mode"
  | "missing-value"
  | "missing-variable"
  | "type-mismatch";

export interface VariableResolutionIssue {
  code: VariableResolutionIssueCode;
  message: string;
  path?: string;
  variableId?: string;
}

export interface VariableConsumer {
  pageId: string;
  nodeId?: string;
}

export interface ResolvedVariableMode {
  collectionId: string;
  modeId: string;
  source: "default" | "node" | "page";
  sourceId: string;
}

export interface ResolvedVariable {
  aliasChain: readonly string[];
  modes: readonly ResolvedVariableMode[];
  resolvedType: VariableResolvedDataType;
  value: Exclude<VariableValue, VariableAlias>;
  variableId: string;
}

export type VariableResolutionResult =
  | { ok: true; resolved: ResolvedVariable }
  | { ok: false; issues: readonly VariableResolutionIssue[] };

export interface VariableDocumentIssue extends VariableResolutionIssue {
  path: string;
}

export interface VariableProjectionResult {
  document: DesignDocument;
  issues: readonly VariableDocumentIssue[];
}

export function variableCollectionDefinition(
  document: DesignDocument,
  collectionId: string,
): VariableCollectionDefinition | undefined {
  return (
    document.variableCollectionsById[collectionId] ??
    document.libraryVariableCollectionsById[collectionId]?.collection
  );
}

export function variableDefinition(
  document: DesignDocument,
  variableId: string,
) {
  return (
    document.variablesById[variableId] ??
    document.libraryVariablesById[variableId]?.variable
  );
}

export function variableCollectionDefinitions(document: DesignDocument) {
  return [
    ...Object.values(document.variableCollectionsById),
    ...Object.values(document.libraryVariableCollectionsById).map(
      (source) => source.collection,
    ),
  ];
}

export function variableDefinitions(document: DesignDocument) {
  return [
    ...Object.values(document.variablesById),
    ...Object.values(document.libraryVariablesById).map(
      (source) => source.variable,
    ),
  ];
}

export function resolveVariableForConsumer(
  document: DesignDocument,
  variableId: string,
  consumer: VariableConsumer,
): VariableResolutionResult {
  const page = document.pagesById[consumer.pageId];
  if (!page) {
    return failure(
      "missing-consumer",
      `Page ${consumer.pageId} does not exist`,
    );
  }
  if (consumer.nodeId && !document.nodesById[consumer.nodeId]) {
    return failure(
      "missing-consumer",
      `Consumer node ${consumer.nodeId} does not exist`,
    );
  }
  const aliasChain: string[] = [];
  const modes: ResolvedVariableMode[] = [];
  const visited = new Set<string>();
  let currentId = variableId;
  let expectedType: VariableResolvedDataType | undefined;

  while (true) {
    const variable = variableDefinition(document, currentId);
    if (!variable) {
      return failure(
        aliasChain.length === 0 ? "missing-variable" : "missing-alias",
        `Variable ${currentId} does not exist`,
        currentId,
      );
    }
    if (visited.has(currentId)) {
      return failure(
        "alias-cycle",
        `Variable alias cycle: ${[...aliasChain, currentId].join(" -> ")}`,
        currentId,
      );
    }
    visited.add(currentId);
    aliasChain.push(currentId);
    expectedType ??= variable.resolvedType;
    if (variable.resolvedType !== expectedType) {
      return failure(
        "type-mismatch",
        `Alias ${currentId} is ${variable.resolvedType}, expected ${expectedType}`,
        currentId,
      );
    }
    const collection = variableCollectionDefinition(
      document,
      variable.variableCollectionId,
    );
    if (!collection) {
      return failure(
        "missing-collection",
        `Collection ${variable.variableCollectionId} does not exist`,
        currentId,
      );
    }
    const mode = resolveMode(document, collection, consumer);
    if (!mode) {
      return failure(
        "missing-mode",
        `Collection ${collection.id} has no valid mode for ${currentId}`,
        currentId,
      );
    }
    modes.push(mode);
    const value = variable.valuesByMode[mode.modeId];
    if (value === undefined) {
      return failure(
        "missing-value",
        `Variable ${currentId} has no value for mode ${mode.modeId}`,
        currentId,
      );
    }
    if (isVariableAlias(value)) {
      currentId = value.id;
      continue;
    }
    if (!valueMatchesType(value, expectedType)) {
      return failure(
        "invalid-value",
        `Variable ${currentId} value does not match ${expectedType}`,
        currentId,
      );
    }
    return {
      ok: true,
      resolved: {
        aliasChain,
        modes,
        resolvedType: expectedType,
        value,
        variableId,
      },
    };
  }
}

export function resolveVariableBindingsForNode(
  document: DesignDocument,
  nodeId: string,
  pageId: string,
): { node: DesignNode; issues: readonly VariableDocumentIssue[] } {
  const source = document.nodesById[nodeId];
  if (!source) {
    return {
      node: undefined as never,
      issues: [
        issue(
          "missing-consumer",
          `/nodesById/${escapePointer(nodeId)}`,
          `Node ${nodeId} does not exist`,
        ),
      ],
    };
  }
  const node = structuredClone(source);
  const issues: VariableDocumentIssue[] = [];
  const consumer = { pageId, nodeId };
  for (const [field, alias] of Object.entries(node.boundVariables ?? {})) {
    const expected = nodeBindingType(field);
    if (!expected) continue;
    const path = `/nodesById/${escapePointer(nodeId)}/boundVariables/${field}`;
    const resolved = resolveVariableForConsumer(document, alias.id, consumer);
    if (!resolved.ok) {
      issues.push(...resolved.issues.map((entry) => ({ ...entry, path })));
      continue;
    }
    if (resolved.resolved.resolvedType !== expected) {
      issues.push(
        issue(
          "binding-type-mismatch",
          path,
          `${field} requires ${expected}, received ${resolved.resolved.resolvedType}`,
          alias.id,
        ),
      );
      continue;
    }
    const value = resolved.resolved.value;
    if (field === "visible" && typeof value === "boolean") node.visible = value;
    else if (field === "opacity" && typeof value === "number") {
      if (value < 0 || value > 1) {
        issues.push(
          issue(
            "invalid-binding-value",
            path,
            `Opacity variable ${alias.id} must resolve from 0 to 1`,
            alias.id,
          ),
        );
      } else node.opacity = value;
    } else if (
      field === "characters" &&
      node.kind === "text" &&
      typeof value === "string"
    ) {
      node.properties.content = value;
    } else {
      issues.push(
        issue(
          "binding-type-mismatch",
          path,
          `${field} is not supported by ${node.kind}`,
          alias.id,
        ),
      );
    }
  }
  const paints = nodePaintFields(node);
  for (const [paintField, values] of paints) {
    values.forEach((paint, paintIndex) => {
      if (paint.type !== "solid" || !paint.boundVariables?.color) return;
      const alias = paint.boundVariables.color;
      const path = `/nodesById/${escapePointer(nodeId)}/properties/${paintField}/${paintIndex}/boundVariables/color`;
      const resolved = resolveVariableForConsumer(document, alias.id, consumer);
      if (!resolved.ok) {
        issues.push(...resolved.issues.map((entry) => ({ ...entry, path })));
        return;
      }
      if (resolved.resolved.resolvedType !== "COLOR") {
        issues.push(
          issue(
            "binding-type-mismatch",
            path,
            `Paint color requires COLOR, received ${resolved.resolved.resolvedType}`,
            alias.id,
          ),
        );
        return;
      }
      const value = resolved.resolved.value;
      if (!isColor(value)) {
        issues.push(
          issue(
            "invalid-binding-value",
            path,
            `Color variable ${alias.id} did not resolve to RGB/RGBA`,
            alias.id,
          ),
        );
        return;
      }
      paint.color = colorToHex(value);
      paint.opacity *= "a" in value ? (value.a ?? 1) : 1;
    });
  }
  return { node, issues };
}

export function materializeVariableBindings(
  document: DesignDocument,
): VariableProjectionResult {
  if (!Object.values(document.nodesById).some(hasVariableBinding)) {
    return { document, issues: [] };
  }
  const nodesById = { ...document.nodesById };
  const issues: VariableDocumentIssue[] = [];
  for (const [nodeId, source] of Object.entries(document.nodesById)) {
    if (!hasVariableBinding(source)) continue;
    const pageId = pageIdForNode(document, nodeId);
    if (!pageId) {
      issues.push(
        issue(
          "missing-consumer",
          `/nodesById/${escapePointer(nodeId)}`,
          `Node ${nodeId} does not belong to a Page`,
        ),
      );
      continue;
    }
    const projected = resolveVariableBindingsForNode(document, nodeId, pageId);
    nodesById[nodeId] = projected.node;
    issues.push(...projected.issues);
  }
  return { document: { ...document, nodesById }, issues };
}

export function validateVariableDocument(
  document: DesignDocument,
): VariableDocumentIssue[] {
  const issues: VariableDocumentIssue[] = [];
  const collectionIds = Object.keys(document.variableCollectionsById);
  if (!sameMembers(document.variableCollectionOrder, collectionIds)) {
    issues.push(
      issue(
        "invalid-collection",
        "/variableCollectionOrder",
        "Variable collection order must contain every collection exactly once",
      ),
    );
  }
  validateLibraryVariableSources(document, issues);
  const collectionKeys = new Set<string>();
  const variableKeys = new Set<string>();
  for (const collection of variableCollectionDefinitions(document)) {
    const collectionId = collection.id;
    const path = collectionPath(document, collectionId);
    if (collection.id !== collectionId) {
      issues.push(
        issue(
          "invalid-collection",
          `${path}/id`,
          "Collection id must match its map key",
        ),
      );
    }
    if (collectionKeys.has(collection.key)) {
      issues.push(
        issue(
          "invalid-collection",
          `${path}/key`,
          `Collection key ${collection.key} is duplicated`,
        ),
      );
    }
    collectionKeys.add(collection.key);
    const modeIds = collection.modes.map((mode) => mode.modeId);
    if (new Set(modeIds).size !== modeIds.length) {
      issues.push(
        issue(
          "invalid-mode",
          `${path}/modes`,
          "Collection mode IDs must be unique",
        ),
      );
    }
    if (!modeIds.includes(collection.defaultModeId)) {
      issues.push(
        issue(
          "invalid-mode",
          `${path}/defaultModeId`,
          "Default mode must belong to the collection",
        ),
      );
    }
    const actual = variableDefinitions(document)
      .filter((variable) => variable.variableCollectionId === collectionId)
      .map((variable) => variable.id);
    if (!sameMembers(collection.variableIds, actual)) {
      issues.push(
        issue(
          "invalid-collection",
          `${path}/variableIds`,
          "Collection variable order must contain every owned variable exactly once",
        ),
      );
    }
  }
  for (const variable of variableDefinitions(document)) {
    const variableId = variable.id;
    const path = variablePath(document, variableId);
    if (variable.id !== variableId) {
      issues.push(
        issue(
          "invalid-value",
          `${path}/id`,
          "Variable id must match its map key",
          variableId,
        ),
      );
    }
    if (variableKeys.has(variable.key)) {
      issues.push(
        issue(
          "invalid-value",
          `${path}/key`,
          `Variable key ${variable.key} is duplicated`,
          variableId,
        ),
      );
    }
    variableKeys.add(variable.key);
    const collection = variableCollectionDefinition(
      document,
      variable.variableCollectionId,
    );
    if (!collection) {
      issues.push(
        issue(
          "missing-collection",
          `${path}/variableCollectionId`,
          `Collection ${variable.variableCollectionId} does not exist`,
          variableId,
        ),
      );
      continue;
    }
    const modeIds = collection.modes.map((mode) => mode.modeId);
    if (!sameMembers(Object.keys(variable.valuesByMode), modeIds)) {
      issues.push(
        issue(
          "missing-value",
          `${path}/valuesByMode`,
          "Variable must define one value for every collection mode",
          variableId,
        ),
      );
    }
    for (const [modeId, value] of Object.entries(variable.valuesByMode)) {
      if (
        !isVariableAlias(value) &&
        !valueMatchesType(value, variable.resolvedType)
      ) {
        issues.push(
          issue(
            "invalid-value",
            `${path}/valuesByMode/${escapePointer(modeId)}`,
            `Value must match ${variable.resolvedType}`,
            variableId,
          ),
        );
      }
      if (isVariableAlias(value)) {
        const target = variableDefinition(document, value.id);
        if (!target) {
          issues.push(
            issue(
              "missing-alias",
              `${path}/valuesByMode/${escapePointer(modeId)}`,
              `Alias variable ${value.id} does not exist`,
              variableId,
            ),
          );
        } else if (target.resolvedType !== variable.resolvedType) {
          issues.push(
            issue(
              "type-mismatch",
              `${path}/valuesByMode/${escapePointer(modeId)}`,
              `Alias ${value.id} must also be ${variable.resolvedType}`,
              variableId,
            ),
          );
        }
      }
    }
  }
  issues.push(...validateAliasCycles(document));
  for (const [pageId, page] of Object.entries(document.pagesById)) {
    validateExplicitModes(
      document,
      page.explicitVariableModes,
      `/pagesById/${escapePointer(pageId)}`,
      issues,
    );
  }
  for (const [nodeId, node] of Object.entries(document.nodesById)) {
    const path = `/nodesById/${escapePointer(nodeId)}`;
    validateExplicitModes(document, node.explicitVariableModes, path, issues);
    validateNodeBindings(document, node, path, issues);
  }
  return issues;
}

function validateAliasCycles(
  document: DesignDocument,
): VariableDocumentIssue[] {
  const issues: VariableDocumentIssue[] = [];
  const reported = new Set<string>();
  const visit = (
    variableId: string,
    stack: readonly string[],
    active: ReadonlySet<string>,
  ): void => {
    const variable = variableDefinition(document, variableId);
    if (!variable) return;
    const nextStack = [...stack, variableId];
    const nextActive = new Set(active).add(variableId);
    for (const value of Object.values(variable.valuesByMode)) {
      if (!isVariableAlias(value) || !variableDefinition(document, value.id))
        continue;
      if (nextActive.has(value.id)) {
        const cycleStart = nextStack.indexOf(value.id);
        const cycle = [...nextStack.slice(cycleStart), value.id];
        const key = [...new Set(cycle)].sort().join("|");
        if (reported.has(key)) continue;
        reported.add(key);
        issues.push(
          issue(
            "alias-cycle",
            `/variablesById/${escapePointer(variableId)}/valuesByMode`,
            `Variable alias cycle: ${cycle.join(" -> ")}`,
            variableId,
          ),
        );
        continue;
      }
      visit(value.id, nextStack, nextActive);
    }
  };
  for (const variableId of variableDefinitions(document).map(({ id }) => id)) {
    visit(variableId, [], new Set());
  }
  return issues;
}

function validateLibraryVariableSources(
  document: DesignDocument,
  issues: VariableDocumentIssue[],
): void {
  for (const [collectionId, source] of Object.entries(
    document.libraryVariableCollectionsById,
  )) {
    const path = `/libraryVariableCollectionsById/${escapePointer(collectionId)}`;
    if (document.variableCollectionsById[collectionId]) {
      issues.push(
        issue(
          "invalid-collection",
          path,
          `Library Collection ${collectionId} conflicts with a local Collection`,
        ),
      );
    }
    if (
      source.collection.id !== collectionId ||
      source.source.sourceVariableCollectionId !== collectionId
    ) {
      issues.push(
        issue(
          "invalid-collection",
          path,
          "Library Collection identity must match its map key",
        ),
      );
    }
  }
  for (const [variableId, source] of Object.entries(
    document.libraryVariablesById,
  )) {
    const path = `/libraryVariablesById/${escapePointer(variableId)}`;
    if (document.variablesById[variableId]) {
      issues.push(
        issue(
          "invalid-value",
          path,
          `Library Variable ${variableId} conflicts with a local Variable`,
          variableId,
        ),
      );
    }
    if (
      source.variable.id !== variableId ||
      source.source.sourceVariableId !== variableId
    ) {
      issues.push(
        issue(
          "invalid-value",
          path,
          "Library Variable identity must match its map key",
          variableId,
        ),
      );
    }
    const collection =
      document.libraryVariableCollectionsById[
        source.variable.variableCollectionId
      ];
    if (!collection || !sameLibraryIdentity(source.source, collection.source)) {
      issues.push(
        issue(
          "missing-collection",
          `${path}/variable/variableCollectionId`,
          "Library Variable must use a Collection from the same Library release",
          variableId,
        ),
      );
    }
  }
}

function sameLibraryIdentity(
  left: {
    libraryId: string;
    releaseId: string;
    sourceProjectId: string;
    sourceDesignFileId: string;
    sourceDocumentId: string;
  },
  right: {
    libraryId: string;
    releaseId: string;
    sourceProjectId: string;
    sourceDesignFileId: string;
    sourceDocumentId: string;
  },
): boolean {
  return (
    left.libraryId === right.libraryId &&
    left.releaseId === right.releaseId &&
    left.sourceProjectId === right.sourceProjectId &&
    left.sourceDesignFileId === right.sourceDesignFileId &&
    left.sourceDocumentId === right.sourceDocumentId
  );
}

function collectionPath(document: DesignDocument, collectionId: string) {
  return document.variableCollectionsById[collectionId]
    ? `/variableCollectionsById/${escapePointer(collectionId)}`
    : `/libraryVariableCollectionsById/${escapePointer(collectionId)}/collection`;
}

function variablePath(document: DesignDocument, variableId: string) {
  return document.variablesById[variableId]
    ? `/variablesById/${escapePointer(variableId)}`
    : `/libraryVariablesById/${escapePointer(variableId)}/variable`;
}

function validateExplicitModes(
  document: DesignDocument,
  modes: Readonly<Record<string, string>> | undefined,
  ownerPath: string,
  issues: VariableDocumentIssue[],
): void {
  for (const [collectionId, modeId] of Object.entries(modes ?? {})) {
    const collection = variableCollectionDefinition(document, collectionId);
    const path = `${ownerPath}/explicitVariableModes/${escapePointer(collectionId)}`;
    if (!collection) {
      issues.push(
        issue(
          "missing-collection",
          path,
          `Collection ${collectionId} does not exist`,
        ),
      );
    } else if (!collection.modes.some((mode) => mode.modeId === modeId)) {
      issues.push(
        issue(
          "missing-mode",
          path,
          `Mode ${modeId} does not belong to ${collectionId}`,
        ),
      );
    }
  }
}

function validateNodeBindings(
  document: DesignDocument,
  node: DesignNode,
  path: string,
  issues: VariableDocumentIssue[],
): void {
  for (const [field, alias] of Object.entries(node.boundVariables ?? {})) {
    const expected = nodeBindingType(field);
    const variable = variableDefinition(document, alias.id);
    const fieldPath = `${path}/boundVariables/${field}`;
    if (!variable) {
      issues.push(
        issue(
          "missing-variable",
          fieldPath,
          `Variable ${alias.id} does not exist`,
          alias.id,
        ),
      );
    } else if (variable.resolvedType !== expected) {
      issues.push(
        issue(
          "binding-type-mismatch",
          fieldPath,
          `${field} requires ${expected}, received ${variable.resolvedType}`,
          alias.id,
        ),
      );
    }
    if (field === "characters" && node.kind !== "text") {
      issues.push(
        issue(
          "binding-type-mismatch",
          fieldPath,
          "characters binding requires a Text node",
          alias.id,
        ),
      );
    }
  }
  for (const [paintField, paints] of nodePaintFields(node)) {
    paints.forEach((paint, index) => {
      if (paint.type !== "solid" || !paint.boundVariables?.color) return;
      const alias = paint.boundVariables.color;
      const variable = variableDefinition(document, alias.id);
      const fieldPath = `${path}/properties/${paintField}/${index}/boundVariables/color`;
      if (!variable) {
        issues.push(
          issue(
            "missing-variable",
            fieldPath,
            `Variable ${alias.id} does not exist`,
            alias.id,
          ),
        );
      } else if (variable.resolvedType !== "COLOR") {
        issues.push(
          issue(
            "binding-type-mismatch",
            fieldPath,
            `Paint color requires COLOR, received ${variable.resolvedType}`,
            alias.id,
          ),
        );
      }
    });
  }
}

function resolveMode(
  document: DesignDocument,
  collection: VariableCollectionDefinition,
  consumer: VariableConsumer,
): ResolvedVariableMode | null {
  let nodeId = consumer.nodeId;
  const seen = new Set<string>();
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node = document.nodesById[nodeId];
    if (!node) break;
    const explicit = node.explicitVariableModes?.[collection.id];
    if (explicit && collection.modes.some((mode) => mode.modeId === explicit)) {
      return {
        collectionId: collection.id,
        modeId: explicit,
        source: "node",
        sourceId: node.id,
      };
    }
    nodeId = node.parentId ?? undefined;
  }
  const pageMode =
    document.pagesById[consumer.pageId]?.explicitVariableModes?.[collection.id];
  if (pageMode && collection.modes.some((mode) => mode.modeId === pageMode)) {
    return {
      collectionId: collection.id,
      modeId: pageMode,
      source: "page",
      sourceId: consumer.pageId,
    };
  }
  return collection.modes.some(
    (mode) => mode.modeId === collection.defaultModeId,
  )
    ? {
        collectionId: collection.id,
        modeId: collection.defaultModeId,
        source: "default",
        sourceId: collection.id,
      }
    : null;
}

function nodeBindingType(field: string): VariableResolvedDataType | undefined {
  if (field === "visible") return "BOOLEAN";
  if (field === "opacity") return "FLOAT";
  if (field === "characters") return "STRING";
  return undefined;
}

function nodePaintFields(
  node: DesignNode,
): Array<["fills" | "strokes", Paint[]]> {
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
  ) {
    return [
      ["fills", node.properties.fills],
      ["strokes", node.properties.strokes],
    ];
  }
  return [];
}

function hasVariableBinding(node: DesignNode): boolean {
  if (node.boundVariables && Object.keys(node.boundVariables).length > 0)
    return true;
  return nodePaintFields(node).some(([, paints]) =>
    paints.some(
      (paint) => paint.type === "solid" && paint.boundVariables?.color,
    ),
  );
}

function pageIdForNode(
  document: DesignDocument,
  nodeId: string,
): string | null {
  let current = document.nodesById[nodeId];
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.id)) {
    seen.add(current.id);
    current = document.nodesById[current.parentId];
  }
  if (!current) return null;
  return (
    document.pageOrder.find((pageId) =>
      document.pagesById[pageId]?.rootNodeIds.includes(current.id),
    ) ?? null
  );
}

function sameMembers(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const set = new Set(left);
  return (
    left.length === right.length &&
    set.size === left.length &&
    right.every((id) => set.has(id))
  );
}

function failure(
  code: VariableResolutionIssueCode,
  message: string,
  variableId?: string,
): VariableResolutionResult {
  return {
    ok: false,
    issues: [{ code, message, ...(variableId ? { variableId } : {}) }],
  };
}

function issue(
  code: VariableResolutionIssueCode,
  path: string,
  message: string,
  variableId?: string,
): VariableDocumentIssue {
  return { code, path, message, ...(variableId ? { variableId } : {}) };
}

function escapePointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
