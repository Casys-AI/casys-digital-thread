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

/**
 * Product facets live under the Product space (validated mockup 5a).
 * Sourcing is a reserved to-Buy lane: the hash is real, the record may be GAP.
 */
export type ProductWorkspaceFacet = "structure" | "requirements" | "sourcing";

export interface ProjectWorkspaceViewDescriptor {
  readonly id: ProjectWorkspaceView;
  readonly label: string;
  readonly description: string;
}

export interface ProductWorkspaceFacetDescriptor {
  readonly id: ProductWorkspaceFacet;
  readonly label: string;
  readonly description: string;
}

export const PROJECT_VIEWS: readonly ProjectWorkspaceViewDescriptor[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Mission and record",
  },
  {
    id: "work",
    label: "Work",
    description: "What the agent changes",
  },
  {
    id: "product",
    label: "Product",
    description: "The system and its parts",
  },
  {
    id: "verification",
    label: "Verification",
    description: "Why a result can be trusted",
  },
  {
    id: "operations",
    label: "Operations",
    description: "Runs, plans and tools",
  },
] as const;

export const PRODUCT_FACETS: readonly ProductWorkspaceFacetDescriptor[] = [
  {
    id: "structure",
    label: "Structure",
    description: "Sealed geometry and the SysML model that names it",
  },
  {
    id: "requirements",
    label: "Requirements",
    description: "What the product must hold, and the last recorded verdict",
  },
  {
    id: "sourcing",
    label: "Sourcing · ERP",
    description: "To Buy coverage — reserved until sourcing starts",
  },
] as const;

export const DEFAULT_PROJECT_VIEW: ProjectWorkspaceView = "overview";
export const DEFAULT_PRODUCT_FACET: ProductWorkspaceFacet = "structure";

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
  readonly productFacet?: ProductWorkspaceFacet;
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

export function productFacetLabel(facet: ProductWorkspaceFacet): string {
  return PRODUCT_FACETS.find((candidate) => candidate.id === facet)?.label ??
    facet;
}

export function productFacetHash(facet: ProductWorkspaceFacet): string {
  return `#product/${facet}`;
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
  if (candidate === "product" || candidate.startsWith("product/")) {
    const facetId = candidate === "product"
      ? DEFAULT_PRODUCT_FACET
      : candidate.slice("product/".length);
    const facet = PRODUCT_FACETS.find((item) => item.id === facetId);
    return {
      view: "product",
      productFacet: facet?.id ?? DEFAULT_PRODUCT_FACET,
    };
  }
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
