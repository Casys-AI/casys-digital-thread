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
    label: "Project",
    description: "Start here: mission & record",
  },
  {
    id: "work",
    index: "02",
    label: "Activity",
    description: "See what the agent changes",
  },
  {
    id: "product",
    index: "03",
    label: "Product",
    description: "Explore the system and its parts",
  },
  {
    id: "verification",
    index: "04",
    label: "Evidence",
    description: "Check why a result can be trusted",
  },
  {
    id: "operations",
    index: "05",
    label: "Execution",
    description: "Inspect runs, plans and connected tools",
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
