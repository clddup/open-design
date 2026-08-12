import type {
  DesignOperation,
  UpdatePropertiesCommand,
} from "@opendesign/design-contracts";
import type { EditorRuntime } from "@opendesign/editor-runtime";
import { useCallback } from "react";
import type {
  MessageKey,
  MessageParameters,
} from "../../../shared/i18n/messages";
import type { UpdatePropertiesPatch } from "./types";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export type ApplyEditorCommands = (
  label: string,
  commands: DesignOperation[],
) => boolean;

export function useEditorCommandController({
  runtime,
  setEditorError,
  t,
  transactionCounter,
}: {
  runtime: EditorRuntime;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const applyCommands = useCallback<ApplyEditorCommands>(
    (label, commands) => {
      const current = runtime.getSnapshot().document;
      const result = runtime.apply({
        transactionId: `transaction_renderer_${Date.now()}_${++transactionCounter.current}`,
        documentId: current.documentId,
        baseRevision: current.revision,
        actor: { type: "user", id: "local-user" },
        label,
        commands,
      });
      setEditorError(result.ok ? null : result.error.message);
      return result.ok;
    },
    [runtime, setEditorError, transactionCounter],
  );

  const updateNode = useCallback(
    (nodeId: string, updates: UpdatePropertiesPatch) => {
      const command: UpdatePropertiesCommand = {
        commandId: `update_${nodeId}`,
        type: "update_properties",
        nodeId,
        ...updates,
      };
      applyCommands(t("history.updateProperties"), [command]);
    },
    [applyCommands, t],
  );

  return { applyCommands, updateNode };
}
