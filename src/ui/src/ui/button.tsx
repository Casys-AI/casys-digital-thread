/**
 * Bouton du cockpit. `asChild` délègue le rendu à l'enfant unique, sans
 * dépendance de slot : les classes du bouton sont fusionnées dans les siennes.
 */

import { cva, type VariantProps } from "class-variance-authority";
import { cloneElement, isValidElement } from "react";
import type { ButtonHTMLAttributes, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-sm hover:bg-destructive/90",
        outline:
          "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button(
  { className, variant, size, type = "button", asChild = false, ...props }:
    ButtonProps,
): JSX.Element {
  const classes = cn(buttonVariants({ variant, size, className }));
  if (asChild && isValidElement(props.children)) {
    const child = props.children as JSX.Element;
    const { children: _children, ...rest } = props;
    return cloneElement(child, {
      ...rest,
      className: cn(classes, (child.props as { className?: string }).className),
    });
  }
  return <button type={type} className={classes} {...props} />;
}
