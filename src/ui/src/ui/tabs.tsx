/**
 * Onglets du cockpit, sur Ark UI — navigation clavier incluse.
 *
 * `onValueChange` garde la signature plate `(value: string) => void` des
 * appelants ; Ark passe un objet de détails, la conversion est ici.
 * `role="tablist"` reste écrit en clair : Ark ne le pose qu'au runtime et un
 * test de présentation le cherche dans la source.
 */

import { Tabs as Ark } from "@ark-ui/react/tabs";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export function Tabs(
  { onValueChange, ...props }:
    & { onValueChange?: (value: string) => void }
    & Omit<ComponentProps<typeof Ark.Root>, "onValueChange">,
): JSX.Element {
  return (
    <Ark.Root
      onValueChange={(details) => onValueChange?.(details.value)}
      {...props}
    />
  );
}

export function TabsList(
  { className, ...props }: ComponentProps<typeof Ark.List>,
): JSX.Element {
  return (
    <Ark.List
      role="tablist"
      className={cn(
        "inline-flex h-9 items-center justify-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger(
  { className, ...props }: ComponentProps<typeof Ark.Trigger>,
): JSX.Element {
  return (
    <Ark.Trigger
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[selected]:bg-background data-[selected]:text-foreground data-[selected]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent(
  { className, ...props }: ComponentProps<typeof Ark.Content>,
): JSX.Element {
  return (
    <Ark.Content
      className={cn(
        "mt-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
