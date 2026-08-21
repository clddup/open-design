import type { AgentRunRequest, ModelToolSurface } from "./index.js";

const CREATE_INTENT =
  /(?:设计|创建|新建|生成|制作|搭建|画一个|做一个|重新设计)|\b(?:design|create|generate|build|make|compose|draw)\b/i;
const CURRENT_EDIT_INTENT =
  /(?:(?:修改|调整|优化|重新设计|替换|删除|重命名|移动|复制|继续|修复)[^。！？\n]{0,32}(?:当前|现有|已有|选中|刚才|之前|上一次|这个(?:页面|设计|画板|图层)))|(?:(?:当前|现有|已有|选中|刚才|之前|上一次|这个(?:页面|设计|画板|图层))[^。！？\n]{0,32}(?:修改|调整|优化|重新设计|替换|删除|重命名|移动|复制|继续|修复))|(?:\b(?:edit|change|update|redesign|refine|replace|delete|rename|move|duplicate|continue|resume|fix)\b[^.!?\n]{0,48}\b(?:current|existing|selected|previous|last)\b)|(?:\b(?:current|existing|selected|previous|last)\b[^.!?\n]{0,48}\b(?:edit|change|update|redesign|refine|replace|delete|rename|move|duplicate|continue|resume|fix)\b)/i;
const PAGE_LIFECYCLE_INTENT =
  /(?:页签|页面标签|分页结构|创建页面|新建页面|删除页面|复制页面|页面排序|重命名页面)|\b(?:create|add|delete|duplicate|reorder|rename)\s+(?:a\s+|the\s+|\d+\s+)?pages?\b/i;

/**
 * Selects the narrow model-facing surface for the first Provider turn.
 *
 * This is intentionally conservative. A compact new-design run requires an
 * exact host inspection, no attachments/selection/continuation, and an
 * explicit creation intent. The Page may already contain unrelated work: the
 * compact surface can only allocate new stable artboard roots and write
 * beneath them, while Main rejects overlap with existing roots. Any edit,
 * redesign, Page lifecycle, attachment, or recovery intent retains the full
 * workflow.
 */
export function resolveInitialModelToolSurface(
  request: Readonly<AgentRunRequest>,
): ModelToolSurface {
  const targetPageIsEmpty = inspectionTargetPageIsEmpty(
    request.initialDesignInspection?.content,
    request.mutationTarget.kind === "page"
      ? request.mutationTarget.pageId
      : undefined,
  );
  if (
    request.initialDesignInspection === undefined ||
    request.continuation !== undefined ||
    (request.attachments?.length ?? 0) > 0 ||
    request.scope.selectedNodeIds.length > 0 ||
    request.mutationTarget.kind !== "page" ||
    !CREATE_INTENT.test(request.prompt) ||
    (!targetPageIsEmpty && CURRENT_EDIT_INTENT.test(request.prompt)) ||
    PAGE_LIFECYCLE_INTENT.test(request.prompt) ||
    !inspectionContainsTargetPage(
      request.initialDesignInspection.content,
      request.mutationTarget.pageId,
    )
  ) {
    return "general";
  }
  return "new-design";
}

/**
 * Host state outranks ambiguous prose when the bound Page has no material
 * content. Words such as “continue”, “adjust”, or “refine” commonly describe
 * later stages of a brand/UI brief and must not route a fresh Page through the
 * slower existing-document workflow.
 */
function inspectionTargetPageIsEmpty(
  content: string | undefined,
  pageId: string | undefined,
): boolean {
  if (!content || !pageId) return false;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return false;
  }
  if (!isRecord(value) || !isRecord(value.document)) return false;
  const document = value.document;
  if (!isRecord(document.pagesById) || !isRecord(document.nodesById)) {
    return false;
  }
  const nodesById = document.nodesById;
  const page = document.pagesById[pageId];
  if (!isRecord(page) || !Array.isArray(page.rootNodeIds)) return false;
  if (page.rootNodeIds.length === 0) return true;
  return page.rootNodeIds.every((rootId) => {
    if (typeof rootId !== "string") return false;
    const root = nodesById[rootId];
    return (
      isRecord(root) &&
      root.kind === "frame" &&
      Array.isArray(root.childIds) &&
      root.childIds.length === 0
    );
  });
}

function inspectionContainsTargetPage(
  content: string,
  pageId: string,
): boolean {
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
  return page.rootNodeIds.every((candidate) => typeof candidate === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
