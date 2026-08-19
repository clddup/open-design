import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type { ReactNode } from "react";

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
    <DialogPrimitive.Root
      disablePointerDismissal={busy}
      onOpenChange={(nextOpen) => {
        if (!busy || nextOpen) onOpenChange(nextOpen);
      }}
      open={open}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="ui-dialog-backdrop" />
        <DialogPrimitive.Viewport className="ui-dialog-viewport">
          <DialogPrimitive.Popup className="ui-confirm-dialog">
            {icon && <span className="ui-confirm-dialog__icon">{icon}</span>}
            <div className="ui-confirm-dialog__content">
              <DialogPrimitive.Title className="ui-confirm-dialog__title">
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="ui-confirm-dialog__description">
                {description}
              </DialogPrimitive.Description>
              {error && (
                <div className="ui-confirm-dialog__error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <div className="ui-confirm-dialog__actions">
              <DialogPrimitive.Close
                className="ui-button ui-button--quiet"
                disabled={busy}
              >
                {cancelLabel}
              </DialogPrimitive.Close>
              <button
                className="ui-button ui-button--danger"
                disabled={busy}
                onClick={onConfirm}
                type="button"
              >
                {confirmLabel}
              </button>
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
