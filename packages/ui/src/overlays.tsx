import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  forwardRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

export function TooltipProvider({
  children,
  delayDuration = 450,
  skipDelayDuration = 200,
}: {
  children: ReactNode;
  delayDuration?: number;
  skipDelayDuration?: number;
}) {
  return (
    <TooltipPrimitive.Provider
      delay={delayDuration}
      timeout={skipDelayDuration}
    >
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  children,
  content,
  side = "bottom",
  sideOffset = 6,
}: {
  children: ReactElement;
  content: ReactNode;
  side?: TooltipPrimitive.Positioner.Props["side"];
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger render={children} />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          className="ui-overlay-positioner"
          collisionPadding={8}
          side={side}
          sideOffset={sideOffset}
        >
          <TooltipPrimitive.Popup className="ui-tooltip" role="tooltip">
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
  >;

type DropdownMenuProps = Omit<MenuPrimitive.Root.Props, "children"> & {
  children: ReactNode;
  contentProps?: Omit<DropdownMenuContentProps, "children">;
  icon: ReactNode;
  label: string;
};

function mergeClassName<State>(
  base: string,
  className: string | ((state: State) => string | undefined),
): string | ((state: State) => string) {
  if (typeof className === "function") {
    return (state) => [base, className(state)].filter(Boolean).join(" ");
  }
  return [base, className].filter(Boolean).join(" ");
}

function DropdownMenuContent({
  align = "end",
  alignOffset = 0,
  children,
  collisionPadding = 8,
  side = "bottom",
  sideOffset = 6,
  ...popupProps
}: DropdownMenuContentProps) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="ui-overlay-positioner"
        collisionPadding={collisionPadding}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup {...popupProps}>{children}</MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenu({
  children,
  contentProps,
  icon,
  label,
  defaultOpen = false,
  onOpenChange,
  open: openProp,
  ...rootProps
}: DropdownMenuProps) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const controlled = openProp !== undefined;
  const open = openProp ?? localOpen;
  const { className = "", ...remainingContentProps } = contentProps ?? {};

  const updateOpen: MenuPrimitive.Root.Props["onOpenChange"] = (
    nextOpen,
    details,
  ) => {
    if (!controlled) setLocalOpen(nextOpen);
    onOpenChange?.(nextOpen, details);
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (controlled || event.button !== 0 || event.pointerType === "touch") {
      return;
    }
    setLocalOpen((current) => !current);
  };

  const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
    if (!controlled) {
      (
        event as MouseEvent<HTMLButtonElement> & {
          preventBaseUIHandler?: () => void;
        }
      ).preventBaseUIHandler?.();
    }
  };

  return (
    <MenuPrimitive.Root onOpenChange={updateOpen} open={open} {...rootProps}>
      <Tooltip content={label}>
        <MenuPrimitive.Trigger
          aria-label={label}
          className="ui-icon-button"
          onMouseDown={handleMouseDown}
          onPointerDown={handlePointerDown}
        >
          {icon}
        </MenuPrimitive.Trigger>
      </Tooltip>
      <DropdownMenuContent
        className={mergeClassName("ui-dropdown-menu", className)}
        {...remainingContentProps}
      >
        {children}
      </DropdownMenuContent>
    </MenuPrimitive.Root>
  );
}

type DropdownMenuItemProps = Omit<
  MenuPrimitive.Item.Props,
  "children" | "onClick"
> & {
  children: ReactNode;
  icon?: ReactNode;
  onSelect?: MenuPrimitive.Item.Props["onClick"];
  shortcut?: string;
};

export const DropdownMenuItem = forwardRef<HTMLElement, DropdownMenuItemProps>(
  function DropdownMenuItem(
    { children, className = "", icon, onSelect, shortcut, ...props },
    ref,
  ) {
    return (
      <MenuPrimitive.Item
        className={mergeClassName("ui-dropdown-menu__item", className)}
        onClick={onSelect}
        ref={ref}
        {...props}
      >
        {icon && <span className="ui-dropdown-menu__icon">{icon}</span>}
        <span className="ui-dropdown-menu__label">{children}</span>
        {shortcut && (
          <span aria-hidden="true" className="ui-dropdown-menu__shortcut">
            {shortcut}
          </span>
        )}
      </MenuPrimitive.Item>
    );
  },
);

export const DropdownMenuSeparator = forwardRef<
  HTMLDivElement,
  MenuPrimitive.Separator.Props
>(function DropdownMenuSeparator({ className = "", ...props }, ref) {
  return (
    <MenuPrimitive.Separator
      className={mergeClassName("ui-dropdown-menu__separator", className)}
      ref={ref}
      {...props}
    />
  );
});

export type DesktopSelectOption = {
  value: string;
  label: ReactNode;
  textValue?: string;
  disabled?: boolean;
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
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  onValueChange: (value: string) => void;
  options: readonly DesktopSelectOption[];
  placeholder?: string;
  size?: "default" | "compact";
  value: string | null;
}) {
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
          <svg aria-hidden="true" height="12" viewBox="0 0 12 12" width="12">
            <path d="m3 4.5 3 3 3-3" />
          </svg>
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
                    <svg
                      aria-hidden="true"
                      height="12"
                      viewBox="0 0 12 12"
                      width="12"
                    >
                      <path d="m2.5 6.2 2.1 2.1 4.9-5" />
                    </svg>
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
