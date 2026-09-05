import type { JSX, ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { Separator } from "../ui/separator.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.tsx";
import { PROJECT_VIEWS } from "./navigation-model.ts";
import type { ProjectWorkspaceView } from "./navigation-model.ts";

export type { ProjectWorkspaceView };
export { projectViewLabel } from "./navigation-model.ts";

/**
 * La topbar unique du cockpit : marque produit, identité du projet, signaux
 * de session. Les coordonnées exactes (id, révision, contexte) restent
 * disponibles au survol du nom — le chrome ne les répète plus.
 */
export function ProjectCockpitHeader({
  projectId,
  revision,
  projectName,
  context,
  streamState,
  streamLabel,
  statusLabel,
  statusValue,
  metaLabel,
  metaValue,
  badge,
}: {
  projectId: string;
  revision: number;
  projectName: string;
  context: string;
  streamState: string;
  streamLabel: string;
  statusLabel: string;
  statusValue: ReactNode;
  metaLabel: string;
  metaValue: ReactNode;
  badge?: ReactNode;
}): JSX.Element {
  return (
    <header className="thread-cockpit-header sticky top-0 z-40 flex h-14 min-w-0 items-center gap-3 border-b border-border bg-background/95 px-5 backdrop-blur">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-brand font-mono text-[9px] font-bold tracking-wide text-white">
          DT
        </span>
        <span className="hidden text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground sm:inline">
          Casys
        </span>
      </div>
      <Separator orientation="vertical" />
      <div className="flex min-w-0 items-center gap-2">
        <TooltipProvider delayDuration={250}>
          <Tooltip side="bottom" align="start">
            <TooltipTrigger asChild>
              <h1 className="min-w-0 cursor-default truncate text-sm font-medium">
                {projectName}
              </h1>
            </TooltipTrigger>
            <TooltipContent>
              <span className="font-mono">
                {projectId} · R{revision} · {context}
              </span>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {badge && <span className="shrink-0">{badge}</span>}
      </div>
      <div className="thread-header-signals ml-auto flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
        <span
          className="group flex items-center gap-1.5"
          data-state={streamState}
          aria-live="polite"
        >
          <i
            aria-hidden="true"
            className="size-1.5 rounded-full bg-success group-data-[state=connecting]:bg-warning group-data-[state=reconnecting]:bg-warning group-data-[state=history]:bg-muted-foreground group-data-[state=snapshot]:bg-muted-foreground"
          />
          <strong className="font-medium">{streamLabel}</strong>
        </span>
        <span className="thread-header-status hidden items-center gap-1.5 md:flex">
          <span>{statusLabel}</span>
          <strong className="max-w-64 truncate font-medium text-foreground">
            {statusValue}
          </strong>
        </span>
        <span className="thread-header-meta hidden items-center gap-1.5 sm:flex">
          <span>{metaLabel}</span>
          <strong className="font-medium text-foreground">{metaValue}</strong>
        </span>
      </div>
    </header>
  );
}

/** Pictogrammes 16px des cinq espaces, trait 1.5 sur currentColor. */
const VIEW_ICON_PATHS: Record<ProjectWorkspaceView, string[]> = {
  overview: [
    "M2.5 6.5 8 2l5.5 4.5V13a1 1 0 0 1-1 1H9.5v-4h-3v4H3.5a1 1 0 0 1-1-1Z",
  ],
  work: ["M1.5 8h2.6l1.9-4.8L9 12.8 10.9 8h3.6"],
  product: [
    "M8 1.5 14 5v6l-6 3.5L2 11V5Z",
    "M2 5l6 3.5L14 5",
    "M8 8.5v6",
  ],
  verification: [
    "M8 1.5 13.5 3.5v4c0 3.4-2.4 5.8-5.5 7-3.1-1.2-5.5-3.6-5.5-7v-4Z",
    "m5.6 7.9 1.7 1.7 3.1-3.2",
  ],
  operations: ["m3 5 3 3-3 3", "M8.5 11.5h4.5"],
};

function ViewIcon({ view }: { view: ProjectWorkspaceView }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0 opacity-70 group-hover:opacity-100 group-aria-[current=page]:opacity-100 group-aria-[current=page]:text-brand group-aria-[current=true]:opacity-100"
    >
      {VIEW_ICON_PATHS[view].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

export function ProjectNavigation({
  activeView,
  onChange,
  disabledViews = [],
  status,
}: {
  activeView: ProjectWorkspaceView;
  onChange: (view: ProjectWorkspaceView) => void;
  /** A pre-approval discovery has no technical record to inspect yet. */
  disabledViews?: readonly ProjectWorkspaceView[];
  /** Compact projection truth kept inside the one Project header. */
  status?: ReactNode;
}): JSX.Element {
  const projectViews = PROJECT_VIEWS.filter((view) => view.id !== "operations");
  const utilityViews = PROJECT_VIEWS.filter((view) => view.id === "operations");
  const renderView = (view: (typeof PROJECT_VIEWS)[number]) => {
    const unavailable = disabledViews.includes(view.id);
    return (
      <div key={view.id} className="project-navigation-item shrink-0">
        <a
          href={`#${view.id}`}
          aria-current={activeView === view.id ? "page" : undefined}
          aria-disabled={unavailable || undefined}
          aria-label={`${view.label}: ${
            unavailable ? "After technical work" : view.description
          }`}
          className={cn(
            "group relative flex h-10 items-center gap-2 rounded-md px-2.5 text-[13px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
            activeView !== view.id && "text-muted-foreground",
            activeView === view.id &&
              "bg-accent text-accent-foreground before:absolute before:inset-x-2 before:bottom-0 before:h-0.5 before:rounded-full before:bg-brand",
            unavailable && "opacity-50",
          )}
          onClick={(event) => {
            if (unavailable) {
              event.preventDefault();
              return;
            }
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            onChange(view.id);
          }}
        >
          <ViewIcon view={view.id} />
          <span>{view.label}</span>
        </a>
      </div>
    );
  };

  return (
    <nav
      className="project-navigation"
      aria-label="Project workspace"
    >
      <span className="project-navigation-heading sr-only">
        Project
      </span>
      <div
        className="project-navigation-primary"
        role="group"
        aria-label="Project views"
      >
        {projectViews.map(renderView)}
      </div>
      <div
        className="project-navigation-utility"
        role="group"
        aria-label="Project utilities"
      >
        <span className="project-navigation-heading sr-only">
          Utility
        </span>
        {utilityViews.map(renderView)}
      </div>
      {status && <div className="project-navigation-status">{status}</div>}
    </nav>
  );
}
