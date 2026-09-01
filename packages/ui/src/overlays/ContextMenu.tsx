import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import type { ReactElement, ReactNode } from "react";

export type ContextMenuProps = {
  children: ReactNode;
  disabled?: boolean;
  onOpenChange?: ContextMenuPrimitive.Root.Props["onOpenChange"];
  trigger: ReactElement;
};

export function ContextMenu({
  children,
  disabled = false,
  onOpenChange,
  trigger,
}: ContextMenuProps) {
  return (
    <ContextMenuPrimitive.Root disabled={disabled} onOpenChange={onOpenChange}>
      <ContextMenuPrimitive.Trigger render={trigger} />
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Positioner
          className="ui-overlay-positioner"
          collisionPadding={8}
        >
          <ContextMenuPrimitive.Popup className="ui-dropdown-menu">
            {children}
          </ContextMenuPrimitive.Popup>
        </ContextMenuPrimitive.Positioner>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  );
}
