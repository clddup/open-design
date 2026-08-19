import { Select as SelectPrimitive } from "@base-ui/react/select";
import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

export type DesktopSelectOption = {
  value: string;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
};

export type DesktopSelectProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: readonly DesktopSelectOption[];
  placeholder?: string;
  size?: "default" | "compact";
  value: string | null;
};

export function DesktopSelect({
  ariaLabel,
  className = "",
  disabled = false,
  onValueChange,
  options,
  placeholder,
  size = "default",
  value,
}: DesktopSelectProps) {
  return (
    <SelectPrimitive.Root
      disabled={disabled}
      items={options.map((option) => ({
        label: option.label,
        value: option.value,
      }))}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") onValueChange(nextValue);
      }}
      value={value}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={`ui-select ui-select--${size} ${className}`}
      >
        <SelectPrimitive.Value
          className="ui-select__value"
          placeholder={placeholder}
        />
        <SelectPrimitive.Icon className="ui-select__icon">
          <Icon name="lucide:chevron-down" size={12} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Positioner
          align="start"
          alignItemWithTrigger={false}
          className="ui-overlay-positioner"
          collisionPadding={8}
          sideOffset={4}
        >
          <SelectPrimitive.Popup className="ui-select__popup">
            <SelectPrimitive.List className="ui-select__list">
              {options.map((option) => (
                <SelectPrimitive.Item
                  className="ui-select__item"
                  disabled={option.disabled}
                  key={option.value}
                  label={option.textValue}
                  value={option.value}
                >
                  <SelectPrimitive.ItemIndicator className="ui-select__indicator">
                    <Icon name="lucide:check" size={12} />
                  </SelectPrimitive.ItemIndicator>
                  <SelectPrimitive.ItemText className="ui-select__item-text">
                    {option.label}
                  </SelectPrimitive.ItemText>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.List>
          </SelectPrimitive.Popup>
        </SelectPrimitive.Positioner>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
