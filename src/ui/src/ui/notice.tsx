/** Notice d'état partagée : un ton, un rôle ARIA, jamais de clone local. */

import type { JSX, ReactNode } from "react";
import { cn } from "../lib/utils.ts";

export type NoticeTone = "neutral" | "info" | "success" | "warning" | "danger";

export function Notice({ title, tone = "neutral", children }: {
  title?: ReactNode;
  tone?: NoticeTone;
  children?: ReactNode;
}): JSX.Element {
  return (
    <div
      className={cn(
        "rounded-md px-3 py-2 text-xs",
        tone === "danger"
          ? "bg-destructive/10 text-destructive"
          : tone === "warning"
          ? "bg-warning/10 text-warning"
          : tone === "success"
          ? "bg-success/10 text-success"
          : tone === "info"
          ? "bg-brand/10 text-brand-strong"
          : "bg-muted/50 text-muted-foreground",
      )}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      {title && <strong className="block font-medium">{title}</strong>}
      {children}
    </div>
  );
}

export function EmptyNotice(
  { children }: { children?: ReactNode },
): JSX.Element {
  return (
    <p className="rounded-lg bg-muted/50 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
