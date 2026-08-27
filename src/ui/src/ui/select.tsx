/**
 * Select du cockpit, sur Ark UI.
 *
 * Ark tient la liste dans une `collection` plutôt que dans des enfants : le
 * composant prend donc ses options en prop. La valeur reste une chaîne simple
 * côté appelant — Ark travaille en tableau, la conversion est ici.
 */

import { createListCollection, Select as Ark } from "@ark-ui/react/select";
import { Portal } from "@ark-ui/react/portal";
import { useMemo } from "react";
import type { JSX } from "react";
import { cn } from "../lib/utils.ts";

export interface SelectOption {
  readonly value: string;
  readonly label: string;
}

export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly className?: string;
  readonly "aria-labelledby"?: string;
}

function Chevron({ path }: { path: string }): JSX.Element {
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
      <path d={path} />
    </svg>
  );
}

export function Select(
  { options, value, onValueChange, className, ...props }: SelectProps,
): JSX.Element {
  const collection = useMemo(
    () => createListCollection({ items: options as SelectOption[] }),
    [options],
  );
  return (
    <Ark.Root
      collection={collection}
      value={[value]}
      onValueChange={(details) => {
        const next = details.value[0];
        if (next !== undefined) onValueChange(next);
      }}
      positioning={{ sameWidth: true, gutter: 4 }}
    >
      <Ark.Control>
        <Ark.Trigger
          aria-labelledby={props["aria-labelledby"]}
          className={cn(
            "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <Ark.ValueText className="truncate" />
          <span className="text-muted-foreground">
            <Chevron path="m4 6 4 4 4-4" />
          </span>
        </Ark.Trigger>
      </Ark.Control>
      <Portal>
        <Ark.Positioner>
          <Ark.Content className="z-50 max-h-96 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            {options.map((option) => (
              <Ark.Item
                key={option.value}
                item={option}
                className="relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground"
              >
                <Ark.ItemText>{option.label}</Ark.ItemText>
                <Ark.ItemIndicator className="absolute right-2 flex size-3.5 items-center justify-center">
                  <Chevron path="m3.5 8.5 3 3 6-7" />
                </Ark.ItemIndicator>
              </Ark.Item>
            ))}
          </Ark.Content>
        </Ark.Positioner>
      </Portal>
    </Ark.Root>
  );
}
