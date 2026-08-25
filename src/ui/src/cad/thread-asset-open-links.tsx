import type { JSX } from "react";

export function ThreadAssetOpenLinks({
  stepHref,
  glbHref,
  subject,
}: {
  stepHref?: string;
  glbHref?: string;
  subject: string;
}): JSX.Element | null {
  if (!stepHref && !glbHref) return null;
  return (
    <div
      className="flex flex-wrap gap-1.5"
      role="group"
      aria-label={`Open CAD assets for ${subject}`}
    >
      {stepHref && (
        <ThreadAssetOpenLink href={stepHref} format="STEP" subject={subject} />
      )}
      {glbHref && (
        <ThreadAssetOpenLink href={glbHref} format="GLB" subject={subject} />
      )}
    </div>
  );
}

function ThreadAssetOpenLink({
  href,
  format,
  subject,
}: {
  href: string;
  format: "STEP" | "GLB";
  subject: string;
}): JSX.Element {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-7 items-center rounded-md border border-border px-2.5 font-mono text-[10px] font-medium text-brand hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={`Open ${format} for ${subject}`}
    >
      {`Open ${format}`}
    </a>
  );
}
