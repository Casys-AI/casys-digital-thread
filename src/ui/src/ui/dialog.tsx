/** Modale du cockpit, sur Ark UI — backdrop, focus trap et Échap inclus. */

import { Dialog as Ark } from "@ark-ui/react/dialog";
import { Portal } from "@ark-ui/react/portal";
import type { ComponentProps, JSX } from "react";
import { cn } from "../lib/utils.ts";

export const Dialog = Ark.Root;
export const DialogTrigger = Ark.Trigger;
export const DialogClose = Ark.CloseTrigger;

export function DialogContent(
  { className, children, ...props }: ComponentProps<typeof Ark.Content>,
): JSX.Element {
  return (
    <Portal>
      <Ark.Backdrop className="fixed inset-0 z-50 bg-black/50" />
      <Ark.Positioner className="fixed inset-0 z-50 grid place-items-center p-6">
        <Ark.Content
          className={cn(
            "relative grid w-full max-w-lg gap-4 rounded-xl border border-border bg-background p-6 shadow-lg",
            className,
          )}
          {...props}
        >
          {children}
          <Ark.CloseTrigger
            aria-label="Close"
            className="absolute right-4 top-4 rounded-sm text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </Ark.CloseTrigger>
        </Ark.Content>
      </Ark.Positioner>
    </Portal>
  );
}

export function DialogHeader(
  { className, ...props }: ComponentProps<"div">,
): JSX.Element {
  return (
    <div
      className={cn("flex flex-col gap-1.5 text-left", className)}
      {...props}
    />
  );
}

export function DialogTitle(
  { className, ...props }: ComponentProps<typeof Ark.Title>,
): JSX.Element {
  return (
    <Ark.Title
      className={cn("text-lg font-semibold leading-none", className)}
      {...props}
    />
  );
}

export function DialogDescription(
  { className, ...props }: ComponentProps<typeof Ark.Description>,
): JSX.Element {
  return (
    <Ark.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DialogFooter(
  { className, ...props }: ComponentProps<"div">,
): JSX.Element {
  return <div className={cn("flex justify-end gap-2", className)} {...props} />;
}
