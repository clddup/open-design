import { Glyph } from "@opendesign/ui";
import { useRef, type KeyboardEvent } from "react";
import { useI18n } from "../i18n";
import type { WorkspaceSnapshot } from "../workspace-runtime";

export function DesignFileTabs({
  snapshot,
  onActivate,
}: {
  snapshot: WorkspaceSnapshot;
  onActivate: (projectId: string, designFileId: string) => void;
}) {
  const { t } = useI18n();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    activeKey: string,
  ) => {
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
        return (
          <button
            aria-selected={active}
            className="design-file-tab"
            key={key}
            onClick={() => onActivate(file.projectId, file.designFileId)}
            onKeyDown={(event) => handleKeyDown(event, key)}
            ref={(element) => {
              if (element) tabRefs.current.set(key, element);
              else tabRefs.current.delete(key);
            }}
            role="tab"
            tabIndex={active ? 0 : -1}
            type="button"
          >
            <Glyph name="frame" size={13} />
            <span>{file.name}</span>
            {file.retainedByRunIds.length > 0 && (
              <i aria-label={t("tabs.backgroundTask")} />
            )}
          </button>
        );
      })}
    </div>
  );
}
