import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { MessageKey, MessageParameters } from "../shared/i18n/messages";
import { useEditorCommandController } from "./features/editor/use-editor-command-controller";
import { usePageCommandController } from "./features/editor/use-page-command-controller";
import { useVariableActions } from "./use-variable-actions";

type Translate = (key: MessageKey, parameters?: MessageParameters) => string;

export function useDocumentCommandControllers({
  runtime,
  selectedNodeId,
  setEditorError,
  t,
  transactionCounter,
}: {
  runtime: EditorRuntime;
  selectedNodeId?: string;
  setEditorError: (message: string | null) => void;
  t: Translate;
  transactionCounter: { current: number };
}) {
  const editorCommands = useEditorCommandController({
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });
  const variableActions = useVariableActions({
    applyCommands: editorCommands.applyCommands,
    runtime,
    selectedNodeId,
    setEditorError,
    t,
    transactionCounter,
  });
  const pageActions = usePageCommandController({
    applyCommands: editorCommands.applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });
  return { editorCommands, pageActions, variableActions };
}
