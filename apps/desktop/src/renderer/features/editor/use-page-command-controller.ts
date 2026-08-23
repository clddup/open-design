import {
  defaultPageName,
  planCreatePage,
  planDeletePage,
  planDuplicatePage,
  planRenamePage,
  planReorderPage,
  type EditorRuntime,
} from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import type { PageActionResult } from "./types";
import type { ApplyEditorCommands } from "./use-editor-command-controller";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function usePageCommandController({
  applyCommands,
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  applyCommands: ApplyEditorCommands;
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const createPage = useCallback((): PageActionResult => {
    const current = runtime.getSnapshot().document;
    const operationId = `page_create_${Date.now()}_${++transactionCounter.current}`;
    const name = defaultPageName(current.pageOrder.length + 1);
    const plan = planCreatePage(current, {
      pageId: operationId,
      name,
      commandPrefix: operationId,
    });
    if (!plan.ok) {
      setEditorError(plan.message);
      return { ok: false, error: plan.message };
    }
    if (!applyCommands(t("history.createPage"), plan.commands)) {
      return { ok: false, error: t("sidebar.pageApplyFailed") };
    }
    runtime.setSelection([]);
    return { ok: true, pageId: plan.pageId, name };
  }, [applyCommands, runtime, setEditorError, t, transactionCounter]);

  const renamePage = useCallback(
    (pageId: string, name: string): PageActionResult => {
      const current = runtime.getSnapshot().document;
      const operationId = `page_rename_${Date.now()}_${++transactionCounter.current}`;
      const plan = planRenamePage(current, {
        pageId,
        name,
        commandPrefix: operationId,
      });
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.renamePage"), plan.commands)) {
        return { ok: false, error: t("sidebar.pageApplyFailed") };
      }
      return {
        ok: true,
        pageId: plan.pageId,
        name: runtime.getSnapshot().document.pagesById[plan.pageId]?.name,
      };
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const duplicatePage = useCallback(
    (pageId: string): PageActionResult => {
      const current = runtime.getSnapshot().document;
      const operationId = `page_duplicate_${Date.now()}_${++transactionCounter.current}`;
      const plan = planDuplicatePage(current, {
        pageId,
        duplicatePageId: operationId,
        commandPrefix: operationId,
        createNodeId: (_sourceNodeId, index) => `${operationId}_node_${index}`,
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.duplicatePage"), plan.commands)) {
        return { ok: false, error: t("sidebar.pageApplyFailed") };
      }
      runtime.setSelection([]);
      return {
        ok: true,
        pageId: plan.pageId,
        name: runtime.getSnapshot().document.pagesById[plan.pageId]?.name,
      };
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const reorderPage = useCallback(
    (pageId: string, index: number): PageActionResult => {
      const current = runtime.getSnapshot().document;
      const operationId = `page_reorder_${Date.now()}_${++transactionCounter.current}`;
      const plan = planReorderPage(current, {
        pageId,
        index,
        commandPrefix: operationId,
      });
      if (!plan.ok) {
        setEditorError(plan.code === "no-op" ? null : plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.reorderPage"), plan.commands)) {
        return { ok: false, error: t("sidebar.pageApplyFailed") };
      }
      return { ok: true, pageId: plan.pageId };
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  const deletePage = useCallback(
    (pageId: string): PageActionResult => {
      const current = runtime.getSnapshot().document;
      const operationId = `page_delete_${Date.now()}_${++transactionCounter.current}`;
      const plan = planDeletePage(current, {
        pageId,
        commandPrefix: operationId,
      });
      if (!plan.ok) {
        setEditorError(plan.message);
        return { ok: false, error: plan.message };
      }
      if (!applyCommands(t("history.deletePage"), plan.commands)) {
        return { ok: false, error: t("sidebar.pageApplyFailed") };
      }
      return { ok: true, pageId: plan.pageId };
    },
    [applyCommands, runtime, setEditorError, t, transactionCounter],
  );

  return { createPage, deletePage, duplicatePage, renamePage, reorderPage };
}
