/** Disclosure du cockpit, sur Ark UI. `data-state` porte open/closed. */

import { Collapsible as Ark } from "@ark-ui/react/collapsible";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

/**
 * `onOpenChange` garde la signature plate `(open: boolean) => void` des
 * appelants ; Ark passe un objet de détails, la conversion est ici.
 */
export function Collapsible(
  { onOpenChange, ...props }:
    & { onOpenChange?: (open: boolean) => void }
    & Omit<ComponentProps<typeof Ark.Root>, "onOpenChange">,
): JSX.Element {
  return (
    <Ark.Root
      onOpenChange={(details) => onOpenChange?.(details.open)}
      {...props}
    />
  );
}

export function CollapsibleTrigger(
  { className, ...props }: ComponentProps<typeof Ark.Trigger>,
): JSX.Element {
  return (
    <Ark.Trigger
      className={cn(
        "flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function CollapsibleContent(
  { className, ...props }: ComponentProps<typeof Ark.Content>,
): JSX.Element {
  return <Ark.Content className={cn(className)} {...props} />;
}
