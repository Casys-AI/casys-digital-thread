/** shadcn/ui Tooltip (new-york), sur Radix. */

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent(
  { className, sideOffset = 4, children, ...props }: ComponentProps<
    typeof TooltipPrimitive.Content
  >,
): JSX.Element {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
