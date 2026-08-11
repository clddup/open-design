import { Glyph } from "@opendesign/ui";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useI18n } from "../i18n";
import type { WorkspaceSnapshot } from "../workspace-runtime";

type RenameState = {
  draft: string;
  error: boolean;
  fileKey: string;
  saving: boolean;
};

export function DesignFileTabs({
  snapshot,
  onActivate,
  canRename,
  onRename,
}: {
  snapshot: WorkspaceSnapshot;
  onActivate: (projectId: string, designFileId: string) => void;
  canRename: (projectId: string, designFileId: string) => boolean;
  onRename: (
    projectId: string,
    designFileId: string,
    name: string,
  ) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameSubmission = useRef<Promise<void> | null>(null);
  const restoreFocusKey = useRef<string | null>(null);
  const [renameState, setRenameState] = useState<RenameState | null>(null);

  useEffect(() => {
    if (!renameState || renameState.saving) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renameState?.error, renameState?.fileKey, renameState?.saving]);

  useEffect(() => {
    if (renameState || !restoreFocusKey.current) return;
    tabRefs.current.get(restoreFocusKey.current)?.focus();
    restoreFocusKey.current = null;
  }, [renameState]);

  useEffect(() => {
    if (renameState && !snapshot.files[renameState.fileKey]) {
      setRenameState(null);
    }
  }, [renameState, snapshot.files]);

  const beginRename = (fileKey: string) => {
    const file = snapshot.files[fileKey];
    if (!file || !canRename(file.projectId, file.designFileId)) return;
    onActivate(file.projectId, file.designFileId);
    setRenameState({
      draft: file.name,
      error: false,
      fileKey,
      saving: false,
    });
  };

  const finishRename = (fileKey: string, restoreFocus: boolean) => {
    if (restoreFocus) restoreFocusKey.current = fileKey;
    setRenameState(null);
  };

  const cancelRename = (fileKey: string) => finishRename(fileKey, true);

  const commitRename = (fileKey: string, restoreFocus = true) => {
    if (renameSubmission.current) return renameSubmission.current;
    const current = renameState;
    const file = snapshot.files[fileKey];
    if (!current || current.fileKey !== fileKey || !file) {
      return Promise.resolve();
    }
    const name = current.draft.trim();
    if (name.length === 0 || name.length > 256) {
      setRenameState({ ...current, error: true });
      return Promise.resolve();
    }
    if (name === file.name) {
      finishRename(fileKey, restoreFocus);
      return Promise.resolve();
    }
    setRenameState({ ...current, draft: name, error: false, saving: true });
    const submission = onRename(file.projectId, file.designFileId, name)
      .then((renamed) => {
        if (renamed) finishRename(fileKey, restoreFocus);
        else
          setRenameState((state) =>
            state?.fileKey === fileKey ? { ...state, saving: false } : state,
          );
      })
      .finally(() => {
        if (renameSubmission.current === submission) {
          renameSubmission.current = null;
        }
      });
    renameSubmission.current = submission;
    return submission;
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    activeKey: string,
  ) => {
    if (event.key === "F2") {
      event.preventDefault();
      beginRename(activeKey);
      return;
    }
    const index = snapshot.openFileKeys.indexOf(activeKey);
    let nextKey: string | undefined;
    if (event.key === "ArrowLeft") {
      nextKey =
        snapshot.openFileKeys[
          (index - 1 + snapshot.openFileKeys.length) %
            snapshot.openFileKeys.length
        ];
    } else if (event.key === "ArrowRight") {
      nextKey =
        snapshot.openFileKeys[(index + 1) % snapshot.openFileKeys.length];
    } else if (event.key === "Home") {
      nextKey = snapshot.openFileKeys[0];
    } else if (event.key === "End") {
      nextKey = snapshot.openFileKeys[snapshot.openFileKeys.length - 1];
    }
    if (!nextKey) return;
    const file = snapshot.files[nextKey];
    if (!file) return;
    event.preventDefault();
    onActivate(file.projectId, file.designFileId);
    tabRefs.current.get(nextKey)?.focus();
  };

  return (
    <div
      aria-label={t("tabs.openDesignFiles")}
      className="design-file-tabs"
      role="tablist"
    >
      {snapshot.openFileKeys.map((key) => {
        const file = snapshot.files[key];
        if (!file) return null;
        const active = key === snapshot.activeFileKey;
        const editing = renameState?.fileKey === key;
        if (editing) {
          const errorId = `design-file-rename-error-${file.designFileId}`;
          return (
            <div
              className={`design-file-tab design-file-tab--editing${active ? " design-file-tab--active" : ""}`}
              key={key}
            >
              <Glyph name="frame" size={13} />
              <input
                aria-busy={renameState.saving}
                aria-describedby={renameState.error ? errorId : undefined}
                aria-invalid={renameState.error}
                aria-label={t("tabs.renameFile", { name: file.name })}
                className="design-file-tab__input"
                disabled={renameState.saving}
                maxLength={256}
                onBlur={() => void commitRename(key, false)}
                onChange={(event) =>
                  setRenameState((state) =>
                    state?.fileKey === key
                      ? {
                          ...state,
                          draft: event.target.value,
                          error: false,
                        }
                      : state,
                  )
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename(key);
                  } else if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename(key);
                  }
                }}
                ref={renameInputRef}
                value={renameState.draft}
              />
              {renameState.error && (
                <span className="visually-hidden" id={errorId} role="alert">
                  {t("tabs.renameFileError")}
                </span>
              )}
              {file.retainedByRunIds.length > 0 && (
                <i aria-label={t("tabs.backgroundTask")} />
              )}
            </div>
          );
        }
        const renameable = canRename(file.projectId, file.designFileId);
        return (
          <button
            aria-selected={active}
            className="design-file-tab"
            key={key}
            onClick={() => onActivate(file.projectId, file.designFileId)}
            onDoubleClick={(event: MouseEvent<HTMLButtonElement>) => {
              if (!renameable) return;
              event.preventDefault();
              beginRename(key);
            }}
            onKeyDown={(event) => handleKeyDown(event, key)}
            ref={(element) => {
              if (element) tabRefs.current.set(key, element);
              else tabRefs.current.delete(key);
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            title={renameable ? t("tabs.renameFileHint") : file.name}
            type="button"
          >
            <Glyph name="frame" size={13} />
            <span className="design-file-tab__name">{file.name}</span>
            {file.retainedByRunIds.length > 0 && (
              <i aria-label={t("tabs.backgroundTask")} />
            )}
          </button>
        );
      })}
    </div>
  );
}
