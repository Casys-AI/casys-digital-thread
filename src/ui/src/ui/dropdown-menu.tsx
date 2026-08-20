/**
 * Menu déroulant du cockpit, sur Ark UI.
 *
 * Ark porte le placement sur la racine — `align` est donc une prop de
 * `DropdownMenu`, pas de son contenu. Les items d'Ark exigent un `value` ;
 * il sert aussi de clé de sélection. Un item à cocher garde le menu ouvert
 * (`closeOnSelect={false}`), là où Radix demandait `onSelect preventDefault`.
 */

import { Menu as Ark } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export type DropdownMenuAlign = "start" | "center" | "end";

export function DropdownMenu(
  { align = "start", ...props }:
    & { align?: DropdownMenuAlign }
    & ComponentProps<typeof Ark.Root>,
): JSX.Element {
  const placement = align === "center" ? "bottom" : `bottom-${align}`;
  return (
    <Ark.Root
      positioning={{ placement: placement as never, gutter: 4 }}
      {...props}
    />
  );
}

export const DropdownMenuTrigger = Ark.Trigger;
export const DropdownMenuGroup = Ark.ItemGroup;

export function DropdownMenuContent(
  { className, children, ...props }: ComponentProps<typeof Ark.Content>,
): JSX.Element {
  return (
    <Portal>
      <Ark.Positioner>
        <Ark.Content
          className={cn(
            "z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </Ark.Content>
      </Ark.Positioner>
    </Portal>
  );
}

export function DropdownMenuLabel(
  { className, ...props }: ComponentProps<typeof Ark.ItemGroupLabel>,
): JSX.Element {
  return (
    <Ark.ItemGroupLabel
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

const ITEM_CLASS =
  "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50";

export function DropdownMenuItem(
  { className, ...props }: ComponentProps<typeof Ark.Item>,
): JSX.Element {
  return <Ark.Item className={cn(ITEM_CLASS, className)} {...props} />;
}

function MenuCheck(): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export function DropdownMenuCheckboxItem(
  { className, children, ...props }: ComponentProps<typeof Ark.CheckboxItem>,
): JSX.Element {
  return (
    <Ark.CheckboxItem
      closeOnSelect={false}
      className={cn(ITEM_CLASS, "pl-7", className)}
      {...props}
    >
      <Ark.ItemIndicator className="absolute left-2 flex size-3.5 items-center justify-center">
        <MenuCheck />
      </Ark.ItemIndicator>
      <Ark.ItemText>{children}</Ark.ItemText>
    </Ark.CheckboxItem>
  );
}

export function DropdownMenuSeparator(
  { className, ...props }: ComponentProps<typeof Ark.Separator>,
): JSX.Element {
  return (
    <Ark.Separator
      className={cn("-mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}
