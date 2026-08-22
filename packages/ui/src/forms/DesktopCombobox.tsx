import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import type { ReactNode } from "react";
import { Icon } from "../icons/Icon";

export type DesktopComboboxOption = {
  value: string;
  label: ReactNode;
  textValue: string;
  keywords?: string;
  disabled?: boolean;
};

export type DesktopComboboxProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  emptyLabel: string;
  onValueChange: (value: string) => void;
  options: readonly DesktopComboboxOption[];
  searchAriaLabel: string;
  searchPlaceholder: string;
  size?: "default" | "compact";
  value: string | null;
};

export function DesktopCombobox({
  ariaLabel,
  className = "",
  disabled = false,
  emptyLabel,
  onValueChange,
  options,
  searchAriaLabel,
  searchPlaceholder,
  size = "default",
  value,
}: DesktopComboboxProps) {
  const selected = options.find((option) => option.value === value) ?? null;
  return (
    <ComboboxPrimitive.Root
      autoHighlight
      disabled={disabled}
      filter={(option, query) =>
        `${option.textValue} ${option.keywords ?? ""}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase())
      }
      isItemEqualToValue={(left, right) => left.value === right.value}
      itemToStringLabel={(option) => option.textValue}
      itemToStringValue={(option) => option.value}
      items={options}
      onValueChange={(option) => {
        if (option) onValueChange(option.value);
      }}
      value={selected}
    >
      <ComboboxPrimitive.InputGroup
        className={`ui-combobox ui-combobox--${size} ${className}`}
      >
        <ComboboxPrimitive.Input
          aria-label={ariaLabel}
          autoComplete="off"
          className="ui-combobox__control"
          placeholder={searchPlaceholder}
        />
        <ComboboxPrimitive.Trigger
          aria-label={searchAriaLabel}
          className="ui-combobox__trigger"
        >
          <Icon name="lucide:chevrons-up-down" size={12} />
        </ComboboxPrimitive.Trigger>
      </ComboboxPrimitive.InputGroup>
      <ComboboxPrimitive.Portal>
        <ComboboxPrimitive.Positioner
          align="start"
          className="ui-overlay-positioner"
          collisionPadding={8}
          sideOffset={4}
        >
          <ComboboxPrimitive.Popup className="ui-combobox__popup">
            <ComboboxPrimitive.Empty className="ui-combobox__empty">
              {emptyLabel}
            </ComboboxPrimitive.Empty>
            <ComboboxPrimitive.List className="ui-combobox__list">
              {(option: DesktopComboboxOption) => (
                <ComboboxPrimitive.Item
                  className="ui-combobox__item"
                  disabled={option.disabled}
                  key={option.value}
                  value={option}
                >
                  <ComboboxPrimitive.ItemIndicator className="ui-combobox__indicator">
                    <Icon name="lucide:check" size={12} />
                  </ComboboxPrimitive.ItemIndicator>
                  <span className="ui-combobox__item-text">{option.label}</span>
                </ComboboxPrimitive.Item>
              )}
            </ComboboxPrimitive.List>
          </ComboboxPrimitive.Popup>
        </ComboboxPrimitive.Positioner>
      </ComboboxPrimitive.Portal>
    </ComboboxPrimitive.Root>
  );
}
