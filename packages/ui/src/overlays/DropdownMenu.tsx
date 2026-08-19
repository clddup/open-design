import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  forwardRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Tooltip } from "./Tooltip";

type DropdownMenuContentProps = MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "collisionPadding" | "side" | "sideOffset"
  >;

export type DropdownMenuProps = Omit<MenuPrimitive.Root.Props, "children"> & {
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

export type DropdownMenuItemProps = Omit<
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
