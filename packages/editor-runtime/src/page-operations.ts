import type {
  DesignDocument,
  DesignNode,
  DesignOperation,
  DesignPage,
} from "@opendesign/design-contracts";

export type PageOperationFailureCode =
  "not-found" | "duplicate" | "invalid" | "no-op" | "last-page";

export type PageOperationPlan =
  | {
      ok: true;
      pageId: string;
      commands: DesignOperation[];
    }
  | {
      ok: false;
      code: PageOperationFailureCode;
      message: string;
    };

export interface CreatePageInput {
  pageId: string;
  name: string;
  index?: number;
  commandPrefix: string;
}

export interface RenamePageInput {
  pageId: string;
  name: string;
  commandPrefix: string;
}

export interface DuplicatePageInput {
  pageId: string;
  duplicatePageId: string;
  name?: string;
  index?: number;
  commandPrefix: string;
  createNodeId: (sourceNodeId: string, index: number) => string;
}

export interface ReorderPageInput {
  pageId: string;
  index: number;
  commandPrefix: string;
}

export interface DeletePageInput {
  pageId: string;
  commandPrefix: string;
}

export function normalizePageName(value: string): string | null {
  const name = value.trim();
  if (name.length === 0 || name.length > 256 || /\p{Cc}/u.test(name)) {
    return null;
  }
  return name;
}

export function planCreatePage(
  document: DesignDocument,
  input: CreatePageInput,
): PageOperationPlan {
  if (hasOwn(document.pagesById, input.pageId)) {
    return failure("duplicate", `Page ${input.pageId} already exists`);
  }
  const name = normalizePageName(input.name);
  if (!name) return invalidName();
  const index = input.index ?? document.pageOrder.length;
  if (!validInsertIndex(index, document.pageOrder.length)) {
    return failure("invalid", `Page index ${index} is out of range`);
  }
  return {
    ok: true,
    pageId: input.pageId,
    commands: [
      {
        commandId: `${input.commandPrefix}_insert_page`,
        type: "insert_page",
        index,
        page: {
          id: input.pageId,
          name,
          rootNodeIds: [],
          extensions: {},
        },
        nodes: [],
      },
    ],
  };
}

export function planRenamePage(
  document: DesignDocument,
  input: RenamePageInput,
): PageOperationPlan {
  const page = ownPage(document, input.pageId);
  if (!page) return missingPage(input.pageId);
  const name = normalizePageName(input.name);
  if (!name) return invalidName();
  if (name === page.name) return failure("no-op", "Page name is unchanged");
  return {
    ok: true,
    pageId: page.id,
    commands: [
      {
        commandId: `${input.commandPrefix}_rename_page`,
        type: "update_page",
        pageId: page.id,
        name,
      },
    ],
  };
}

export function planDuplicatePage(
  document: DesignDocument,
  input: DuplicatePageInput,
): PageOperationPlan {
  const source = ownPage(document, input.pageId);
  if (!source) return missingPage(input.pageId);
  if (hasOwn(document.pagesById, input.duplicatePageId)) {
    return failure("duplicate", `Page ${input.duplicatePageId} already exists`);
  }
  const name = normalizePageName(input.name ?? copyName(source.name));
  if (!name) return invalidName();
  const sourceIndex = document.pageOrder.indexOf(source.id);
  const index = input.index ?? sourceIndex + 1;
  if (!validInsertIndex(index, document.pageOrder.length)) {
    return failure("invalid", `Page index ${index} is out of range`);
  }

  const sourceNodes = collectPageNodes(document, source);
  const idMap = new Map<string, string>();
  const newIds = new Set<string>();
  for (const [nodeIndex, node] of sourceNodes.entries()) {
    const newId = input.createNodeId(node.id, nodeIndex);
    if (
      newId.length === 0 ||
      hasOwn(document.nodesById, newId) ||
      newIds.has(newId)
    ) {
      return failure(
        "duplicate",
        `Duplicate Page node id ${newId || "<empty>"}`,
      );
    }
    idMap.set(node.id, newId);
    newIds.add(newId);
  }

  const nodes = sourceNodes.map((node) => cloneNode(node, idMap));
  const page: DesignPage = {
    id: input.duplicatePageId,
    name,
    rootNodeIds: source.rootNodeIds.map((nodeId) =>
      requireMapped(idMap, nodeId),
    ),
    extensions: structuredClone(source.extensions),
  };
  return {
    ok: true,
    pageId: page.id,
    commands: [
      {
        commandId: `${input.commandPrefix}_duplicate_page`,
        type: "insert_page",
        index,
        page,
        nodes,
      },
    ],
  };
}

export function planReorderPage(
  document: DesignDocument,
  input: ReorderPageInput,
): PageOperationPlan {
  const page = ownPage(document, input.pageId);
  if (!page) return missingPage(input.pageId);
  if (
    !Number.isInteger(input.index) ||
    input.index < 0 ||
    input.index >= document.pageOrder.length
  ) {
    return failure("invalid", `Page index ${input.index} is out of range`);
  }
  if (document.pageOrder.indexOf(page.id) === input.index) {
    return failure("no-op", "Page position is unchanged");
  }
  return {
    ok: true,
    pageId: page.id,
    commands: [
      {
        commandId: `${input.commandPrefix}_move_page`,
        type: "move_page",
        pageId: page.id,
        index: input.index,
      },
    ],
  };
}

export function planDeletePage(
  document: DesignDocument,
  input: DeletePageInput,
): PageOperationPlan {
  const page = ownPage(document, input.pageId);
  if (!page) return missingPage(input.pageId);
  if (document.pageOrder.length <= 1) {
    return failure("last-page", "A Design File must contain at least one Page");
  }
  return {
    ok: true,
    pageId: page.id,
    commands: [
      {
        commandId: `${input.commandPrefix}_delete_page`,
        type: "delete_page",
        pageId: page.id,
      },
    ],
  };
}

function collectPageNodes(
  document: DesignDocument,
  page: DesignPage,
): DesignNode[] {
  const nodes: DesignNode[] = [];
  const visit = (nodeId: string): void => {
    const node = document.nodesById[nodeId];
    if (!node) return;
    nodes.push(node);
    node.childIds.forEach(visit);
  };
  page.rootNodeIds.forEach(visit);
  return nodes;
}

function cloneNode(
  node: DesignNode,
  idMap: ReadonlyMap<string, string>,
): DesignNode {
  return {
    ...structuredClone(node),
    id: requireMapped(idMap, node.id),
    parentId: node.parentId ? requireMapped(idMap, node.parentId) : null,
    childIds: node.childIds.map((nodeId) => requireMapped(idMap, nodeId)),
  };
}

function requireMapped(
  idMap: ReadonlyMap<string, string>,
  nodeId: string,
): string {
  const mapped = idMap.get(nodeId);
  if (!mapped) throw new Error(`Page node ${nodeId} is not mapped`);
  return mapped;
}

function copyName(sourceName: string): string {
  const prefix = "Copy of ";
  return `${prefix}${sourceName}`.slice(0, 256);
}

function validInsertIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

function ownPage(
  document: DesignDocument,
  pageId: string,
): DesignPage | undefined {
  return hasOwn(document.pagesById, pageId)
    ? document.pagesById[pageId]
    : undefined;
}

function hasOwn<T>(value: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function missingPage(pageId: string): PageOperationPlan {
  return failure("not-found", `Page ${pageId} does not exist`);
}

function invalidName(): PageOperationPlan {
  return failure(
    "invalid",
    "Page name must contain 1–256 non-control characters",
  );
}

function failure(
  code: PageOperationFailureCode,
  message: string,
): PageOperationPlan {
  return { ok: false, code, message };
}
