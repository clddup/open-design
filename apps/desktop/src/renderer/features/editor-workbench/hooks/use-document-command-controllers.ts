import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { MessageKey, MessageParameters } from "@/shared/i18n/messages";
import {
  useEditorCommandController,
  usePageCommandController,
} from "@/renderer/features/editor";
import { useVariableActions } from "./use-variable-actions";
import { useStyleActions } from "./use-style-actions";

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
  const styleActions = useStyleActions({
    applyCommands: editorCommands.applyCommands,
    runtime,
    setEditorError,
    t,
    transactionCounter,
  });
  return { editorCommands, pageActions, styleActions, variableActions };
}
