import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../icons/Icon";
import { Tooltip } from "../overlays/Tooltip";

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
  selected?: boolean;
};

export function IconButton({
  label,
  icon,
  selected,
  className = "",
  ...props
}: IconButtonProps) {
  const button = (
    <button
      aria-label={label}
      aria-pressed={selected}
      className={`ui-icon-button ${className}`}
      type="button"
      {...props}
    >
      <Icon name={icon} />
    </button>
  );

  return (
    <Tooltip content={label}>
      {props.disabled ? (
        <span className="ui-disabled-tooltip-trigger">{button}</span>
      ) : (
        button
      )}
    </Tooltip>
  );
}
