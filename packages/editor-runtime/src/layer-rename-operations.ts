import type {
  DesignDocument,
  DesignNode,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";

export const LAYER_RENAME_CURRENT_NAME_TOKEN = "{name}";
export const LAYER_RENAME_ASCENDING_NUMBER_TOKEN = "{n}";
export const LAYER_RENAME_DESCENDING_NUMBER_TOKEN = "{N}";
export const MAX_LAYER_NAME_LENGTH = 256;

export type LayerRenameInput = {
  match: string;
  renameTo: string;
  useRegularExpression: boolean;
};

export type LayerRenameItem = {
  id: string;
  name: string;
};

export type LayerRenamePreview = LayerRenameItem & {
  nextName: string;
};

export type LayerRenameFailureCode =
  | "empty-selection"
  | "missing-node"
  | "outside-page"
  | "invalid-regular-expression"
  | "empty-name"
  | "name-too-long"
  | "no-op";

export type LayerRenamePreviewResult =
  | { ok: true; preview: LayerRenamePreview[] }
  | { ok: false; code: LayerRenameFailureCode; message: string };

export type LayerRenamePlan =
  | {
      ok: true;
      commands: UpdatePropertiesCommand[];
      preview: LayerRenamePreview[];
    }
  | { ok: false; code: LayerRenameFailureCode; message: string };

export function previewLayerRenames(
  items: readonly LayerRenameItem[],
  input: LayerRenameInput,
): LayerRenamePreviewResult {
  if (items.length === 0) {
    return failure("empty-selection", "Select at least one layer to rename");
  }

  let matcher: RegExp | null = null;
  if (input.match.length > 0) {
    try {
      matcher = new RegExp(
        input.useRegularExpression
          ? input.match
          : escapeRegularExpression(input.match),
        "g",
      );
    } catch {
      return failure(
        "invalid-regular-expression",
        "Enter a valid regular expression",
      );
    }
  }

  const preview = items.map((item, index) => {
    const replacement = renderReplacementTemplate(
      input.renameTo,
      item.name,
      index,
      items.length,
      matcher !== null,
    );
    return {
      ...item,
      nextName: matcher ? item.name.replace(matcher, replacement) : replacement,
    };
  });

  if (preview.some(({ nextName }) => nextName.trim().length === 0)) {
    return failure("empty-name", "Layer names must not be empty");
  }
  if (preview.some(({ nextName }) => nextName.length > MAX_LAYER_NAME_LENGTH)) {
    return failure(
      "name-too-long",
      `Layer names must contain at most ${MAX_LAYER_NAME_LENGTH} characters`,
    );
  }
  return { ok: true, preview };
}

export function planRenameLayers(
  document: DesignDocument,
  pageId: string,
  nodeIds: readonly string[],
  input: LayerRenameInput,
  commandPrefix: string,
): LayerRenamePlan {
  const uniqueNodeIds = [...new Set(nodeIds)];
  const items: LayerRenameItem[] = [];
  for (const nodeId of uniqueNodeIds) {
    const node = document.nodesById[nodeId];
    if (!node) {
      return failure("missing-node", `Layer ${nodeId} no longer exists`);
    }
    if (!nodeBelongsToPage(document, pageId, nodeId)) {
      return failure(
        "outside-page",
        `Layer ${nodeId} is not part of the active Page`,
      );
    }
    items.push({ id: nodeId, name: node.name });
  }

  const result = previewLayerRenames(items, input);
  if (!result.ok) return result;
  const commands = result.preview.flatMap(
    ({ id, name, nextName }, index): UpdatePropertiesCommand[] =>
      name === nextName
        ? []
        : [
            {
              commandId: `${commandPrefix}_${index + 1}`,
              type: "update_properties",
              nodeId: id,
              name: nextName,
            },
          ],
  );
  if (commands.length === 0) {
    return failure("no-op", "The new names are unchanged");
  }
  return { ok: true, commands, preview: result.preview };
}

function renderReplacementTemplate(
  template: string,
  currentName: string,
  index: number,
  total: number,
  nativeReplacement: boolean,
): string {
  const values: Record<string, string> = {
    [LAYER_RENAME_CURRENT_NAME_TOKEN]: currentName,
    [LAYER_RENAME_ASCENDING_NUMBER_TOKEN]: String(index + 1),
    [LAYER_RENAME_DESCENDING_NUMBER_TOKEN]: String(total - index),
  };
  return template.replace(/\{name\}|\{n\}|\{N\}/g, (token) => {
    const value = values[token] ?? token;
    return nativeReplacement ? value.replaceAll("$", "$$$$") : value;
  });
}

function nodeBelongsToPage(
  document: DesignDocument,
  pageId: string,
  nodeId: string,
): boolean {
  const page = document.pagesById[pageId];
  if (!page) return false;
  let currentId: string | null = nodeId;
  const visited = new Set<string>();
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const node: DesignNode | undefined = document.nodesById[currentId];
    if (!node) return false;
    if (node.parentId === null) return page.rootNodeIds.includes(node.id);
    currentId = node.parentId;
  }
  return false;
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function failure<TCode extends LayerRenameFailureCode>(
  code: TCode,
  message: string,
): { ok: false; code: TCode; message: string } {
  return { ok: false, code, message };
}
