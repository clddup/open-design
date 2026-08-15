import type { AgentRunRequest, ModelToolSurface } from "./index.js";

const CREATE_INTENT =
  /(?:设计|创建|新建|生成|制作|搭建|画一个|做一个|重新设计)|\b(?:design|create|generate|build|make|compose|draw)\b/i;
const NON_GENERATION_INTENT =
  /(?:修改|调整|优化|替换|删除|重命名|移动|复制|导入|导出|继续|修复|打开|读取|分析)|\b(?:edit|change|update|refine|replace|delete|rename|move|duplicate|import|export|continue|resume|fix|open|read|inspect|analy[sz]e)\b/i;
const PAGE_LIFECYCLE_INTENT =
  /(?:页签|页面标签|分页结构|创建页面|新建页面|删除页面|复制页面|页面排序|重命名页面)|\b(?:create|add|delete|duplicate|reorder|rename)\s+(?:a\s+|the\s+|\d+\s+)?pages?\b/i;

/**
 * Selects the narrow model-facing surface for the first Provider turn.
 *
 * This is intentionally conservative. A compact new-design run requires an
 * exact host inspection, an empty Page (or one empty starter Frame), no
 * attachments/selection/continuation, and an explicit creation intent. Any
 * ambiguity retains the complete general workflow so Page approval, image
 * reading, existing-content edits and recovery are never hidden.
 */
export function resolveInitialModelToolSurface(
  request: Readonly<AgentRunRequest>,
): ModelToolSurface {
  if (
    request.initialDesignInspection === undefined ||
    request.continuation !== undefined ||
    (request.attachments?.length ?? 0) > 0 ||
    request.scope.selectedNodeIds.length > 0 ||
    request.mutationTarget.kind !== "page" ||
    !CREATE_INTENT.test(request.prompt) ||
    NON_GENERATION_INTENT.test(request.prompt) ||
    PAGE_LIFECYCLE_INTENT.test(request.prompt) ||
    !inspectionShowsBlankPage(
      request.initialDesignInspection.content,
      request.mutationTarget.pageId,
    )
  ) {
    return "general";
  }
  return "new-design";
}

function inspectionShowsBlankPage(content: string, pageId: string): boolean {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return false;
  }
  if (!isRecord(value) || !isRecord(value.document)) return false;
  const document = value.document;
  if (!isRecord(document.pagesById)) return false;
  const page = document.pagesById[pageId];
  if (!isRecord(page) || !Array.isArray(page.rootNodeIds)) return false;
  const rootNodeIds = page.rootNodeIds.filter(
    (candidate): candidate is string => typeof candidate === "string",
  );
  if (rootNodeIds.length !== page.rootNodeIds.length) return false;
  if (rootNodeIds.length === 0) return true;
  if (rootNodeIds.length !== 1 || !isRecord(document.nodesById)) return false;
  const root = document.nodesById[rootNodeIds[0]!];
  return (
    isRecord(root) &&
    (root.kind === "frame" || root.kind === "group") &&
    root.parentId === null &&
    Array.isArray(root.childIds) &&
    root.childIds.length === 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
