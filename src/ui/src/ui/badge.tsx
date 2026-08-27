/** shadcn/ui Badge (new-york), avec deux variants d'état en plus. */

import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive/10 text-destructive",
        outline: "text-foreground",
        success: "border-transparent bg-success/10 text-success",
        warning: "border-transparent bg-warning/10 text-warning",
        info: "border-transparent bg-brand/10 text-brand",
      },
    },
    defaultVariants: {
      variant: "secondary",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge(
  { className, variant, ...props }: BadgeProps,
): JSX.Element {
  return (
    <span className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}
