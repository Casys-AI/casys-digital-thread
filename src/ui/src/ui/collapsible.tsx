/** shadcn/ui Collapsible (new-york), sur Radix. */

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const Collapsible = CollapsiblePrimitive.Root;

export function CollapsibleTrigger(
  { className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Trigger>,
): JSX.Element {
  return (
    <CollapsiblePrimitive.Trigger
      className={cn(
        "flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function CollapsibleContent(
  { className, ...props }: ComponentProps<typeof CollapsiblePrimitive.Content>,
): JSX.Element {
  return <CollapsiblePrimitive.Content className={cn(className)} {...props} />;
}
