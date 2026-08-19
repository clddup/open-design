import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";

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
