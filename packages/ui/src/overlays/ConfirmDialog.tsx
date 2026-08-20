import type { ReactNode } from "react";
import { Dialog, DialogDismiss } from "./Dialog";

export type ConfirmDialogProps = {
  busy?: boolean;
  cancelLabel: string;
  confirmLabel: string;
  description: ReactNode;
  error?: ReactNode;
  icon?: ReactNode;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  title: ReactNode;
};

export function ConfirmDialog({
  busy = false,
  cancelLabel,
  confirmLabel,
  description,
  error,
  icon,
  onConfirm,
  onOpenChange,
  open,
  title,
}: ConfirmDialogProps) {
  return (
    <Dialog
      busy={busy}
      className="ui-confirm-dialog"
      description={description}
      footer={
        <>
          <DialogDismiss className="ui-button ui-button--quiet" disabled={busy}>
            {cancelLabel}
          </DialogDismiss>
          <button
            className="ui-button ui-button--danger"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </>
      }
      icon={icon}
      onOpenChange={onOpenChange}
      open={open}
      size="small"
      title={title}
    >
      {error && (
        <div className="ui-confirm-dialog__error" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
