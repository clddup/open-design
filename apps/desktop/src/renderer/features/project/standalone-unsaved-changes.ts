import type { EditorRuntime } from "@opendesign/editor-runtime";
import type { DesktopApi } from "@/shared/desktop-api";
import type {
  WorkspaceFileSnapshot,
  WorkspaceRuntime,
} from "../../state/workspace-runtime";

const LOCAL_PROJECT_ID = "project_local";
type StandaloneFilePort = Pick<
  DesktopApi,
  "confirmUnsavedDesign" | "saveDesignFile"
>;

export function dirtyStandaloneFiles(
  workspace: WorkspaceRuntime,
): WorkspaceFileSnapshot[] {
  return Object.values(workspace.getSnapshot().files).filter(
    (file) =>
      file.projectId === LOCAL_PROJECT_ID &&
      workspace.getRuntime(file.projectId, file.designFileId)?.getSnapshot()
        .state.dirty,
  );
}

const pendingSaves = new WeakMap<EditorRuntime, Promise<boolean>>();

export function saveStandaloneFile(
  workspace: WorkspaceRuntime,
  file: WorkspaceFileSnapshot,
  save: DesktopApi["saveDesignFile"],
  saveAs = false,
): Promise<boolean> {
  const runtime = workspace.getRuntime(file.projectId, file.designFileId);
  if (!runtime) return Promise.resolve(false);
  const previous = pendingSaves.get(runtime) ?? Promise.resolve(true);
  // Previous failures belong to their caller; a new explicit save may retry.
  const operation = previous
    .catch(() => false)
    .then(() => writeStandaloneFile(workspace, file, runtime, save, saveAs));
  pendingSaves.set(runtime, operation);
  const release = () => {
    if (pendingSaves.get(runtime) === operation) pendingSaves.delete(runtime);
  };
  void operation.then(release, release);
  return operation;
}

async function writeStandaloneFile(
  workspace: WorkspaceRuntime,
  file: WorkspaceFileSnapshot,
  runtime: EditorRuntime,
  save: DesktopApi["saveDesignFile"],
  saveAs: boolean,
): Promise<boolean> {
  if (workspace.getRuntime(file.projectId, file.designFileId) !== runtime)
    return false;
  const snapshot = runtime.getSnapshot();
  const result = await save({
    suggestedName: workspace.getSnapshot().files[file.key]?.name ?? file.name,
    contents: JSON.stringify(snapshot.document, null, 2),
    ...(saveAs ? { saveAs: true } : {}),
  });
  if (!result) return false;
  workspace.renameFile(file.projectId, file.designFileId, result.name);
  if (runtime.getSnapshot().document.revision === snapshot.document.revision)
    runtime.checkpoint();
  return true;
}

/** Every accepted discard is tied to the exact revision the user saw. */
export async function confirmStandaloneChanges(
  workspace: WorkspaceRuntime,
  desktop: StandaloneFilePort,
  fileKey?: string,
): Promise<boolean> {
  const discarded = new Map<string, number>();
  while (true) {
    const file = dirtyStandaloneFiles(workspace).find(
      (candidate) =>
        (!fileKey || candidate.key === fileKey) &&
        discarded.get(candidate.key) !==
          workspace
            .getRuntime(candidate.projectId, candidate.designFileId)
            ?.getSnapshot().document.revision,
    );
    if (!file) return true;
    const runtime = workspace.getRuntime(file.projectId, file.designFileId)!;
    const revision = runtime.getSnapshot().document.revision;
    const decision = await desktop.confirmUnsavedDesign(file.name);
    if (decision === "cancel") return false;
    if (decision === "discard") {
      discarded.set(file.key, revision);
      continue;
    }
    do {
      if (!(await saveStandaloneFile(workspace, file, desktop.saveDesignFile)))
        return false;
    } while (runtime.getSnapshot().state.dirty);
  }
}
