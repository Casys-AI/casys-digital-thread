/** @jsxImportSource preact */

import type { JSX } from "preact";

export type ProjectWorkspaceView =
  | "overview"
  | "work"
  | "product"
  | "verification"
  | "operations";

const PROJECT_VIEWS: readonly {
  id: ProjectWorkspaceView;
  index: string;
  label: string;
  description: string;
}[] = [
  {
    id: "overview",
    index: "01",
    label: "Overview",
    description: "Intent & progress",
  },
  {
    id: "work",
    index: "02",
    label: "Work",
    description: "Human + agent",
  },
  {
    id: "product",
    index: "03",
    label: "Product",
    description: "Parts & facets",
  },
  {
    id: "verification",
    index: "04",
    label: "Verification",
    description: "Evidence & impact",
  },
  {
    id: "operations",
    index: "05",
    label: "Operations",
    description: "Runs & tools",
  },
] as const;

export function ProjectNavigation({
  activeView,
  onChange,
}: {
  activeView: ProjectWorkspaceView;
  onChange: (view: ProjectWorkspaceView) => void;
}): JSX.Element {
  return (
    <nav class="project-navigation" aria-label="Project workspace">
      {PROJECT_VIEWS.map((view) => (
        <button
          key={view.id}
          type="button"
          aria-current={activeView === view.id ? "page" : undefined}
          onClick={() => onChange(view.id)}
        >
          <span aria-hidden="true">{view.index}</span>
          <strong>{view.label}</strong>
          <small>{view.description}</small>
        </button>
      ))}
    </nav>
  );
}

export function projectViewLabel(view: ProjectWorkspaceView): string {
  return PROJECT_VIEWS.find((candidate) => candidate.id === view)?.label ??
    view;
}
