import {
  createWelcomeDocument,
  type EditorRuntime,
  type EditorSnapshot,
} from "@opendesign/editor-runtime";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  WorkspaceRuntime,
  type WorkspaceFileIdentity,
  type WorkspaceSnapshot,
} from "./state/workspace-runtime";

export const LOCAL_PROJECT_ID = "project_local";
export const LOCAL_DESIGN_FILE_ID = "design_local";

type EditorRuntimeContextValue = {
  workspace: WorkspaceRuntime;
  workspaceSnapshot: WorkspaceSnapshot;
  runtime: EditorRuntime;
  activePageId: string;
  replaceDocument: (document: unknown, name?: string) => EditorRuntime;
  openFile: (
    identity: WorkspaceFileIdentity,
    document: EditorSnapshot["document"],
  ) => EditorRuntime;
  activateFile: (projectId: string, designFileId: string) => void;
  activatePage: (pageId: string) => void;
};

const EditorRuntimeContext = createContext<EditorRuntimeContextValue | null>(
  null,
);

export function EditorRuntimeProvider({ children }: { children: ReactNode }) {
  const [workspace] = useState(
    () =>
      new WorkspaceRuntime({
        projectId: LOCAL_PROJECT_ID,
        designFileId: LOCAL_DESIGN_FILE_ID,
        name: "Untitled.opendesign",
        document: createWelcomeDocument(),
      }),
  );
  const workspaceSnapshot = useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
  );
  const runtime = workspace.getActiveRuntime();
  const activeFile = workspaceSnapshot.files[workspaceSnapshot.activeFileKey];
  if (!activeFile) throw new Error("Active design file is missing");

  const replaceDocument = useCallback(
    (document: unknown, name = "Untitled.opendesign") =>
      workspace.replaceActiveFile(
        {
          projectId: LOCAL_PROJECT_ID,
          designFileId: `design_local_${Date.now()}`,
          name,
        },
        document as EditorSnapshot["document"],
      ),
    [workspace],
  );
  const openFile = useCallback(
    (identity: WorkspaceFileIdentity, document: EditorSnapshot["document"]) =>
      workspace.openFile(identity, document),
    [workspace],
  );
  const activateFile = useCallback(
    (projectId: string, designFileId: string) =>
      workspace.activateFile(projectId, designFileId),
    [workspace],
  );
  const activatePage = useCallback(
    (pageId: string) => workspace.activatePage(pageId),
    [workspace],
  );
  const value = useMemo(
    () => ({
      workspace,
      workspaceSnapshot,
      runtime,
      activePageId: activeFile.activePageId,
      replaceDocument,
      openFile,
      activateFile,
      activatePage,
    }),
    [
      activateFile,
      activatePage,
      activeFile.activePageId,
      openFile,
      replaceDocument,
      runtime,
      workspace,
      workspaceSnapshot,
    ],
  );

  return (
    <EditorRuntimeContext.Provider value={value}>
      {children}
    </EditorRuntimeContext.Provider>
  );
}

export function useEditorRuntime(): EditorRuntimeContextValue {
  const value = useContext(EditorRuntimeContext);
  if (!value) {
    throw new Error("EditorRuntimeProvider is missing");
  }
  return value;
}

export function useEditorSnapshot(): EditorSnapshot {
  const { runtime } = useEditorRuntime();
  return useSyncExternalStore(
    useCallback((notify) => runtime.subscribe(() => notify()), [runtime]),
    useCallback(() => runtime.getSnapshot(), [runtime]),
  );
}
