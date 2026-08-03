/** @jsxImportSource preact */

import type { JSX } from "preact";
import { PROJECT_VIEWS } from "./navigation-model.ts";
import type { ProjectWorkspaceView } from "./navigation-model.ts";

export type { ProjectWorkspaceView };
export { projectViewLabel } from "./navigation-model.ts";

export function ProjectNavigation({
  activeView,
  onChange,
  disabledViews = [],
}: {
  activeView: ProjectWorkspaceView;
  onChange: (view: ProjectWorkspaceView) => void;
  /** A pre-approval discovery has no technical record to inspect yet. */
  disabledViews?: readonly ProjectWorkspaceView[];
}): JSX.Element {
  return (
    <nav class="project-navigation" aria-label="Project workspace">
      {PROJECT_VIEWS.map((view) => {
        const unavailable = disabledViews.includes(view.id);
        return (
          <a
            key={view.id}
            href={`#${view.id}`}
            aria-current={activeView === view.id ? "page" : undefined}
            aria-disabled={unavailable || undefined}
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
            <strong>{view.label}</strong>
            <small>
              {unavailable ? "After technical work" : view.description}
            </small>
          </a>
        );
      })}
    </nav>
  );
}
