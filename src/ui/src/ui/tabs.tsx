/** shadcn/ui Tabs (new-york), sur Radix — navigation clavier incluse. */

import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const Tabs = TabsPrimitive.Root;

export function TabsList(
  { className, ...props }: ComponentProps<typeof TabsPrimitive.List>,
): JSX.Element {
  return (
    <TabsPrimitive.List
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
  { className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>,
): JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent(
  { className, ...props }: ComponentProps<typeof TabsPrimitive.Content>,
): JSX.Element {
  return (
    <TabsPrimitive.Content
      className={cn(
        "mt-2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
