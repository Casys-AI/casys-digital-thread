/** shadcn/ui Separator, sans Radix : un simple trait décoratif. */

import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/utils.ts";

export interface SeparatorProps extends HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
}

export function Separator(
  { className, orientation = "horizontal", ...props }: SeparatorProps,
): JSX.Element {
  return (
    <div
      role="none"
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-px w-full" : "h-4 w-px",
        className,
      )}
      {...props}
    />
  );
}
