import {
  LAYER_RENAME_ASCENDING_NUMBER_TOKEN,
  LAYER_RENAME_CURRENT_NAME_TOKEN,
  LAYER_RENAME_DESCENDING_NUMBER_TOKEN,
  previewLayerRenames,
  type LayerRenameFailureCode,
  type LayerRenameInput,
  type LayerRenameItem,
} from "@opendesign/editor-runtime";
import { Button, Dialog, DialogDismiss } from "@opendesign/ui";
import { useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n";
import styles from "./RenameLayersDialog.module.scss";

export type RenameLayersResult = { ok: true } | { ok: false; error: string };

export type RenameLayersDialogProps = {
  items: readonly LayerRenameItem[];
  onClose: () => void;
  onRename: (input: LayerRenameInput) => RenameLayersResult;
};

const PREVIEW_LIMIT = 12;

export function RenameLayersDialog({
  items,
  onClose,
  onRename,
}: RenameLayersDialogProps) {
  const { t } = useI18n();
  const [match, setMatch] = useState("");
  const [renameTo, setRenameTo] = useState(LAYER_RENAME_CURRENT_NAME_TOKEN);
  const [useRegularExpression, setUseRegularExpression] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const renameInput = useRef<HTMLInputElement | null>(null);
  const request = useMemo<LayerRenameInput>(
    () => ({ match, renameTo, useRegularExpression }),
    [match, renameTo, useRegularExpression],
  );
  const result = useMemo(
    () => previewLayerRenames(items, request),
    [items, request],
  );
  const changedCount = result.ok
    ? result.preview.filter(({ name, nextName }) => name !== nextName).length
    : 0;
  const validationError = result.ok
    ? changedCount === 0
      ? t("renameLayers.noChange")
      : null
    : renameFailureMessage(result.code, t);

  const insertToken = (token: string) => {
    const input = renameInput.current;
    const start = input?.selectionStart ?? renameTo.length;
    const end = input?.selectionEnd ?? start;
    setRenameTo(`${renameTo.slice(0, start)}${token}${renameTo.slice(end)}`);
    setApplyError(null);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const submit = () => {
    if (!result.ok || changedCount === 0) return;
    const applied = onRename(request);
    if (applied.ok) onClose();
    else setApplyError(applied.error);
  };

  return (
    <Dialog
      closeLabel={t("renameLayers.close")}
      description={t("renameLayers.description", { count: items.length })}
      footer={
        <>
          <DialogDismiss className="ui-button ui-button--quiet">
            {t("common.cancel")}
          </DialogDismiss>
          <Button
            disabled={!result.ok || changedCount === 0}
            onClick={submit}
            tone="primary"
          >
            {t("renameLayers.action", { count: changedCount })}
          </Button>
        </>
      }
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title={t("renameLayers.title")}
    >
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className={styles.field}>
          <span>{t("renameLayers.match")}</span>
          <input
            autoFocus
            onChange={(event) => {
              setMatch(event.target.value);
              setApplyError(null);
            }}
            placeholder={t("renameLayers.matchPlaceholder")}
            value={match}
          />
        </label>
        <label className={styles.regexOption}>
          <input
            checked={useRegularExpression}
            onChange={(event) => {
              setUseRegularExpression(event.target.checked);
              setApplyError(null);
            }}
            type="checkbox"
          />
          <span>{t("renameLayers.regularExpression")}</span>
        </label>
        <label className={styles.field}>
          <span>{t("renameLayers.renameTo")}</span>
          <input
            maxLength={256}
            onChange={(event) => {
              setRenameTo(event.target.value);
              setApplyError(null);
            }}
            ref={renameInput}
            value={renameTo}
          />
        </label>
        <div
          aria-label={t("renameLayers.tokens")}
          className={styles.tokens}
          role="group"
        >
          <button
            onClick={() => insertToken(LAYER_RENAME_CURRENT_NAME_TOKEN)}
            type="button"
          >
            {t("renameLayers.currentName")}
          </button>
          <button
            onClick={() => insertToken(LAYER_RENAME_ASCENDING_NUMBER_TOKEN)}
            type="button"
          >
            {t("renameLayers.numberAscending")}
          </button>
          <button
            onClick={() => insertToken(LAYER_RENAME_DESCENDING_NUMBER_TOKEN)}
            type="button"
          >
            {t("renameLayers.numberDescending")}
          </button>
        </div>
        <section className={styles.preview}>
          <div className={styles.previewHeading}>
            <span>{t("renameLayers.preview")}</span>
            <span>{t("renameLayers.changed", { count: changedCount })}</span>
          </div>
          {result.ok && (
            <div className={styles.previewList}>
              {result.preview.slice(0, PREVIEW_LIMIT).map((item) => (
                <div className={styles.previewRow} key={item.id}>
                  <span title={item.name}>{item.name}</span>
                  <span aria-hidden="true">→</span>
                  <span title={item.nextName}>{item.nextName}</span>
                </div>
              ))}
              {result.preview.length > PREVIEW_LIMIT && (
                <span className={styles.previewMore}>
                  {t("renameLayers.previewMore", {
                    count: result.preview.length - PREVIEW_LIMIT,
                  })}
                </span>
              )}
            </div>
          )}
        </section>
        {(applyError || validationError) && (
          <div className={styles.error} role="alert">
            {applyError ?? validationError}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function renameFailureMessage(
  code: LayerRenameFailureCode,
  t: ReturnType<typeof useI18n>["t"],
): string {
  switch (code) {
    case "invalid-regular-expression":
      return t("renameLayers.invalidRegularExpression");
    case "empty-name":
      return t("renameLayers.emptyName");
    case "name-too-long":
      return t("renameLayers.nameTooLong");
    case "no-op":
      return t("renameLayers.noChange");
    case "empty-selection":
    case "missing-node":
    case "outside-page":
      return t("renameLayers.targetUnavailable");
  }
}
