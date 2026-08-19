import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon";

export type ButtonTone = "default" | "primary" | "danger" | "quiet";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  icon?: IconName;
  tone?: ButtonTone;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { children, icon, tone = "default", className = "", ...props },
    ref,
  ) {
    return (
      <button
        className={`ui-button ui-button--${tone} ${className}`}
        ref={ref}
        type="button"
        {...props}
      >
        {icon && <Icon name={icon} />}
        <span>{children}</span>
      </button>
    );
  },
);
