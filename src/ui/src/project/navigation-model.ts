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
    description: "Objective, status and next attention",
  },
  {
    id: "work",
    label: "Activity",
    description: "Recorded work, reviews and lineage",
  },
  {
    id: "product",
    label: "Product",
    description: "Exact registered App handoffs",
  },
  {
    id: "verification",
    label: "Evidence",
    description: "Cases, results and exact provenance",
  },
  {
    id: "operations",
    label: "Systems & runs",
    description: "Execution, integrations and record diagnostics",
  },
] as const;

export const DEFAULT_PROJECT_VIEW: ProjectWorkspaceView = "overview";

/**
 * Keep an objective's supporting sentence only when it adds information.
 * Snapshot producers may repeat the title with different whitespace or final
 * punctuation; rendering both makes the cockpit look denser without helping.
 */
export function hasDistinctProjectObjectiveStatement(
  title: string,
  statement: string,
): boolean {
  const normalize = (value: string): string =>
    value.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").toLowerCase();
  const normalizedStatement = normalize(statement);
  return normalizedStatement.length > 0 &&
    normalizedStatement !== normalize(title);
}

export type ProjectDeepLinkTarget =
  | "review/brief"
  | "review/architecture"
  | "review/requirements"
  | "review/geometry";

export interface ProjectWorkspaceLocation {
  readonly view: ProjectWorkspaceView;
  readonly target?: ProjectDeepLinkTarget;
}

const DEEP_LINK_VIEW: Readonly<
  Record<ProjectDeepLinkTarget, ProjectWorkspaceView>
> = {
  "review/brief": "work",
  "review/architecture": "work",
  "review/requirements": "work",
  "review/geometry": "work",
};

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
  return parseProjectLocationHash(hash).view;
}

export function projectDeepLinkHash(target: ProjectDeepLinkTarget): string {
  return `#${DEEP_LINK_VIEW[target]}/${target}`;
}

/** Only the fixed, non-authoritative review targets are accepted. */
export function parseProjectLocationHash(
  hash: string,
): ProjectWorkspaceLocation {
  const candidate = hash.replace(/^#/, "");
  const target = (Object.keys(DEEP_LINK_VIEW) as ProjectDeepLinkTarget[]).find(
    (item) => `${DEEP_LINK_VIEW[item]}/${item}` === candidate,
  );
  if (target) return { view: DEEP_LINK_VIEW[target], target };
  return PROJECT_VIEWS.some((view) => view.id === candidate)
    ? { view: candidate as ProjectWorkspaceView }
    : { view: DEFAULT_PROJECT_VIEW };
}

export function projectDeepLinkDomId(target: ProjectDeepLinkTarget): string {
  return `review-${target.split("/")[1]}`;
}

/**
 * A live snapshot refresh must not steal scroll focus from the reader. The
 * caller records this stable key only after the target element was found and
 * scrolled; a new explicit navigation clears it first.
 */
export function shouldScrollProjectDeepLink(
  lastScrolledKey: string | undefined,
  target: ProjectDeepLinkTarget,
): boolean {
  return lastScrolledKey !== projectDeepLinkHash(target);
}
