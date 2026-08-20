import type { JSX, ReactNode } from "react";
import { cn } from "../lib/utils.ts";
import { Badge } from "../ui/badge.tsx";
import { Separator } from "../ui/separator.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.tsx";
import {
  PRODUCT_FACETS,
  productFacetHash,
  PROJECT_VIEWS,
} from "./navigation-model.ts";
import type {
  ProductWorkspaceFacet,
  ProjectWorkspaceView,
} from "./navigation-model.ts";

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
    <header className="thread-cockpit-header sticky top-0 z-40 flex h-12 min-w-0 items-center gap-3 border-b border-border bg-background px-4">
      <div className="flex shrink-0 items-center gap-2">
        <span className="grid size-6 place-items-center rounded-md bg-brand text-[10px] font-bold text-white">
          DT
        </span>
        <span className="text-sm font-semibold tracking-tight">Casys</span>
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
      <div className="ml-auto flex shrink-0 items-center gap-4 text-xs text-muted-foreground">
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
        <span className="hidden items-center gap-1.5 md:flex">
          <span>{statusLabel}</span>
          <strong className="max-w-64 truncate font-medium text-foreground">
            {statusValue}
          </strong>
        </span>
        <span className="hidden items-center gap-1.5 sm:flex">
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
  activeProductFacet,
  onProductFacetChange,
  sourcingBadge,
}: {
  activeView: ProjectWorkspaceView;
  onChange: (view: ProjectWorkspaceView) => void;
  /** A pre-approval discovery has no technical record to inspect yet. */
  disabledViews?: readonly ProjectWorkspaceView[];
  activeProductFacet?: ProductWorkspaceFacet;
  onProductFacetChange?: (facet: ProductWorkspaceFacet) => void;
  /** Honest coverage chip — typically GAP until ERP records exist. */
  sourcingBadge?: string;
}): JSX.Element {
  return (
    <nav
      className="project-navigation flex flex-col gap-0.5 p-3"
      aria-label="Project workspace"
    >
      {PROJECT_VIEWS.map((view) => {
        const unavailable = disabledViews.includes(view.id);
        const productOpen = view.id === "product" && activeView === "product" &&
          !unavailable;
        return (
          <div key={view.id} className="flex flex-col">
            <a
              href={`#${view.id}`}
              aria-current={activeView === view.id && !productOpen
                ? "page"
                : activeView === view.id
                ? "true"
                : undefined}
              aria-disabled={unavailable || undefined}
              aria-expanded={view.id === "product"
                ? productOpen || undefined
                : undefined}
              aria-label={`${view.label}: ${
                unavailable ? "After technical work" : view.description
              }`}
              className={cn(
                "group flex h-[29px] shrink-0 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                activeView !== view.id && "text-muted-foreground",
                activeView === view.id && !productOpen &&
                  "bg-accent text-accent-foreground",
                activeView === view.id && productOpen && "bg-accent text-brand",
                unavailable && "opacity-50",
              )}
              onClick={(event) => {
                if (unavailable) {
                  event.preventDefault();
                  return;
                }
                // Le lien reste un vrai lien — clic milieu, Cmd+clic et « copier
                // l'adresse » doivent marcher. On n'intercepte que le clic simple.
                if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                event.preventDefault();
                onChange(view.id);
              }}
            >
              <ViewIcon view={view.id} />
              <span>{view.label}</span>
            </a>
            {productOpen && (
              <div
                className="ml-[17px] mt-0.5 flex flex-col gap-px border-l border-border pl-2.5"
                aria-label="Product facets"
              >
                {PRODUCT_FACETS.map((facet) => {
                  const current = (activeProductFacet ?? "structure") ===
                    facet.id;
                  return (
                    <a
                      key={facet.id}
                      href={productFacetHash(facet.id)}
                      aria-current={current ? "page" : undefined}
                      aria-label={`${facet.label}: ${facet.description}`}
                      className={cn(
                        "flex h-6 items-center justify-between gap-2 rounded-[5px] px-2 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                        current &&
                          "bg-accent font-medium text-accent-foreground",
                        facet.id === "sourcing" && !current &&
                          "text-muted-foreground/70",
                      )}
                      onClick={(event) => {
                        if (
                          event.metaKey || event.ctrlKey || event.shiftKey
                        ) return;
                        event.preventDefault();
                        onProductFacetChange?.(facet.id);
                      }}
                    >
                      <span>{facet.label}</span>
                      {facet.id === "sourcing" && sourcingBadge && (
                        <Badge
                          variant={sourcingBadge === "GAP"
                            ? "warning"
                            : "secondary"}
                          className="px-1 py-0 font-mono text-[9px]"
                        >
                          {sourcingBadge}
                        </Badge>
                      )}
                    </a>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
