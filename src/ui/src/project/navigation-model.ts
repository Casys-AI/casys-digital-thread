/**
 * Les cinq espaces du cockpit, et leur adressage dans le fragment d'URL.
 *
 * Le fragment est la seule chose que le navigateur possede legitimement ici :
 * il ne porte aucune autorite MCP, ne nomme aucun enregistrement et n'atteint
 * pas le BFF. Il dit seulement quel espace l'humain regarde, ce qui rend l'etat
 * partageable, rechargeable, et rend `aria-current="page"` vrai au lieu d'etre
 * decoratif.
 */
export type ProjectWorkspaceView =
  | "overview"
  | "work"
  | "product"
  | "verification"
  | "operations";

export interface ProjectWorkspaceViewDescriptor {
  readonly id: ProjectWorkspaceView;
  readonly label: string;
  readonly description: string;
}

export const PROJECT_VIEWS: readonly ProjectWorkspaceViewDescriptor[] = [
  {
    id: "overview",
    label: "Project",
    description: "Mission and record",
  },
  {
    id: "work",
    label: "Activity",
    description: "What the agent changes",
  },
  {
    id: "product",
    label: "Product",
    description: "The system and its parts",
  },
  {
    id: "verification",
    label: "Evidence",
    description: "Why a result can be trusted",
  },
  {
    id: "operations",
    label: "Execution",
    description: "Runs, plans and tools",
  },
] as const;

export const DEFAULT_PROJECT_VIEW: ProjectWorkspaceView = "overview";

export function projectViewLabel(view: ProjectWorkspaceView): string {
  return PROJECT_VIEWS.find((candidate) => candidate.id === view)?.label ??
    view;
}

export function projectViewHash(view: ProjectWorkspaceView): string {
  return `#${view}`;
}

/**
 * Fail-closed : un fragment inconnu retombe sur l'espace par defaut plutot que
 * de laisser le cockpit sur un espace vide. Un fragment absent n'est pas une
 * erreur, c'est l'ouverture normale.
 */
export function parseProjectViewHash(hash: string): ProjectWorkspaceView {
  const candidate = hash.replace(/^#/, "");
  return PROJECT_VIEWS.some((view) => view.id === candidate)
    ? candidate as ProjectWorkspaceView
    : DEFAULT_PROJECT_VIEW;
}
