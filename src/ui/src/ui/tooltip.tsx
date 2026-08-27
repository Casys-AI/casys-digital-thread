/**
 * Tooltip du cockpit, sur Ark UI.
 *
 * Ark porte le placement sur la racine (`positioning`) là où shadcn le portait
 * sur le contenu (`side`/`align`) : `TooltipContent` accepte toujours les deux,
 * et `Tooltip` les traduit. Ark n'a pas de provider — `TooltipProvider` reste
 * exporté pour ne pas casser les appelants et porte le délai d'ouverture.
 */

import { Tooltip as Ark } from "@ark-ui/react/tooltip";
import { Portal } from "@ark-ui/react/portal";
import { createContext, useContext } from "react";
import type { ComponentChildren } from "preact";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

const OpenDelayContext = createContext(250);

export function TooltipProvider(
  { delayDuration = 250, children }: {
    delayDuration?: number;
    children?: ComponentChildren;
  },
): JSX.Element {
  return (
    <OpenDelayContext.Provider value={delayDuration}>
      {children}
    </OpenDelayContext.Provider>
  );
}

export type TooltipSide = "top" | "right" | "bottom" | "left";
export type TooltipAlign = "start" | "center" | "end";

export function Tooltip(
  { side = "top", align = "center", children, ...props }:
    & { side?: TooltipSide; align?: TooltipAlign }
    & ComponentProps<typeof Ark.Root>,
): JSX.Element {
  const openDelay = useContext(OpenDelayContext);
  const placement = align === "center" ? side : `${side}-${align}`;
  return (
    <Ark.Root
      openDelay={openDelay}
      closeDelay={80}
      positioning={{ placement: placement as never, gutter: 4 }}
      {...props}
    >
      {children}
    </Ark.Root>
  );
}

export const TooltipTrigger = Ark.Trigger;

export function TooltipContent(
  { className, children, ...props }:
    & { side?: TooltipSide; align?: TooltipAlign }
    & ComponentProps<typeof Ark.Content>,
): JSX.Element {
  const { side: _side, align: _align, ...rest } = props;
  return (
    <Portal>
      <Ark.Positioner>
        <Ark.Content
          className={cn(
            "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground",
            className,
          )}
          {...rest}
        >
          {children}
        </Ark.Content>
      </Ark.Positioner>
    </Portal>
  );
}
