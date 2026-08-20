import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon } from "../icons/Icon";

export type DialogProps = {
  busy?: boolean;
  children?: ReactNode;
  className?: string;
  closeLabel?: string;
  description?: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  size?: "small" | "medium" | "large";
  title: ReactNode;
};

export function Dialog({
  busy = false,
  children,
  className = "",
  closeLabel,
  description,
  footer,
  icon,
  onOpenChange,
  open,
  size = "medium",
  title,
}: DialogProps) {
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
          <DialogPrimitive.Popup
            className={`ui-dialog ui-dialog--${size} ${className}`}
          >
            <header className="ui-dialog__header">
              {icon && <span className="ui-dialog__icon">{icon}</span>}
              <div className="ui-dialog__heading">
                <DialogPrimitive.Title className="ui-dialog__title">
                  {title}
                </DialogPrimitive.Title>
                {description && (
                  <DialogPrimitive.Description className="ui-dialog__description">
                    {description}
                  </DialogPrimitive.Description>
                )}
              </div>
              {closeLabel && (
                <DialogPrimitive.Close
                  aria-label={closeLabel}
                  className="ui-dialog__close"
                  disabled={busy}
                >
                  <Icon name="lucide:x" size={14} />
                </DialogPrimitive.Close>
              )}
            </header>
            {children && <div className="ui-dialog__body">{children}</div>}
            {footer && <footer className="ui-dialog__footer">{footer}</footer>}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogDismiss = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function DialogDismiss({ className = "", type = "button", ...props }, ref) {
  return (
    <DialogPrimitive.Close
      className={className}
      ref={ref}
      type={type}
      {...props}
    />
  );
});
