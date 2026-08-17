/** shadcn/ui Card (new-york). */

import type { HTMLAttributes, JSX } from "react";
import { cn } from "../lib/utils.ts";

export function Card(
  { className, ...props }: HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border border-border bg-card text-card-foreground shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader(
  { className, ...props }: HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  return (
    <div
      className={cn("flex flex-col gap-1.5 px-5 pt-5", className)}
      {...props}
    />
  );
}

export function CardTitle(
  { className, ...props }: HTMLAttributes<HTMLHeadingElement>,
): JSX.Element {
  // Un titre de carte appartient à l'outline de la page, pas à un div.
  return (
    <h3
      className={cn("m-0 font-semibold leading-none", className)}
      {...props}
    />
  );
}

export function CardDescription(
  { className, ...props }: HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  return (
    <div
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function CardContent(
  { className, ...props }: HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function CardFooter(
  { className, ...props }: HTMLAttributes<HTMLDivElement>,
): JSX.Element {
  return (
    <div
      className={cn("flex items-center px-5 pb-5", className)}
      {...props}
    />
  );
}
