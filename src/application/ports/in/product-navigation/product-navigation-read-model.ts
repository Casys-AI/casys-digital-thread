/**
 * Provider-neutral product-navigation read model.
 *
 * MCP tools and the Workbench GET/SSE projection consume these types. This is
 * not product authority: exact architecture-capture/4.0 remains the basis.
 */

import type {
  ProductStructureElementRef,
  ProductStructureOccurrenceRef,
} from "../../../../domain/architecture/product-structure-ref.ts";
import {
  productStructureElementRef,
  productStructureOccurrenceRef,
} from "../../../../domain/architecture/product-structure-ref.ts";
import {
  exactRecord,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentRole,
  ProjectSourceAttachmentSourceStatus,
  ProjectSourceAttachmentTarget,
} from "../../../../domain/project-source-workspace/types.ts";
import type { ThreadRequirementDefinitionAttachment } from "../../../../domain/thread/requirement-definition-scope.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";

export const PRODUCT_EXPLORE_SCHEMA = "product-explore/1.0" as const;
export const PRODUCT_SEARCH_SCHEMA = "product-search/1.0" as const;
export const PRODUCT_INSPECT_SCHEMA = "product-inspect/1.0" as const;
export const PRODUCT_SOURCE_CLOSURE_SCHEMA = "product-source-closure/1.0" as const;
export const PRODUCT_NAVIGATION_QUERY_SCHEMA = "product-navigation-query/2.0" as const;
export const THREAD_PRODUCT_NAVIGATION_SCHEMA =
  "thread-product-navigation/1.0" as const;

export const PRODUCT_NAVIGATION_BOUNDS = Object.freeze({
  maxPageSize: 50,
  defaultPageSize: 20,
  maxSearchTextLength: 256,
  maxCursorLength: 4_096,
  maxIndexCacheEntries: 8,
});

export type ProductNavigationStatus =
  | "observed"
  | "unavailable"
  | "unattached"
  | "unresolved";

export type ProductNavigationDiagnosticCode =
  | "basis.stale"
  | "basis.unavailable"
  | "selection.unattached"
  | "selection.invalid"
  | "selection.expected-basis-required"
  | "cursor.mismatch"
  | "architecture.unresolved";

export interface ProductNavigationDiagnostic {
  code: ProductNavigationDiagnosticCode;
  relation: string;
  recovery: string;
}

export interface ProductNavigationBasis {
  projectId: string;
  threadSnapshotId: string;
  threadRevision: number;
  threadSubjectId: string;
  architectureArtifactId: string;
  architectureFingerprint: string;
  captureSchema: "architecture-capture/4.0";
}

export interface ProductNavigationNode {
  element: ProductStructureElementRef;
  occurrence?: ProductStructureOccurrenceRef;
  typedDefinition?: ProductStructureElementRef;
  label: string;
  expandable: boolean;
}

export type ProductStructureSelection =
  | { readonly kind: "element"; readonly element: ProductStructureElementRef }
  | {
    readonly kind: "occurrence";
    readonly occurrence: ProductStructureOccurrenceRef;
  };

export type ProductSearchQueryKind =
  | { readonly kind: "exact-id"; readonly elementId: string }
  | { readonly kind: "text"; readonly text: string };

export interface ProductNavigationScope {
  readonly projectId: string;
  /** Workbench-bound snapshot. MCP omits this; the server selects the current tip. */
  readonly snapshot?: ThreadSnapshot;
  readonly expectedBasis?: ProductNavigationBasis;
}

export interface ProductExploreQuery extends ProductNavigationScope {
  readonly selection?: ProductStructureOccurrenceRef;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProductSearchQuery extends ProductNavigationScope {
  readonly query: ProductSearchQueryKind;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProductInspectQuery extends ProductNavigationScope {
  readonly selection: ProductStructureSelection;
  readonly pageSize?: number;
  readonly cursor?: string;
  readonly occurrencesPageSize?: number;
  readonly occurrencesCursor?: string;
}

export interface ProductSourceClosureQuery extends ProductNavigationScope {
  readonly selection: ProductStructureSelection;
  readonly workspaceRevision: number;
  readonly attachmentId: string;
  readonly attachmentRevision: number;
  readonly pageSize?: number;
  readonly cursor?: string;
}

export interface ProductNavigationAttachment {
  group: "sources" | "geometry" | "physics" | "requirements";
  kind: "source-file" | "artifact" | "requirement";
  id: string;
  label: string;
}

export interface ProductNavigationAttachments {
  sources: ProductNavigationAttachment[];
  geometry: ProductNavigationAttachment[];
  physics: ProductNavigationAttachment[];
  requirements: ProductNavigationAttachment[];
}

export type ProductNavigationAuthoringBasisStatus =
  | "exact-basis"
  | "different-basis";

export interface ProductNavigationAuthoringAttachment {
  attachmentId: string;
  attachmentRevision: number;
  fingerprint: ContentFingerprint;
  fileId: string;
  fileHeadRevision: number | null;
  sourceStatus: ProjectSourceAttachmentSourceStatus;
  role: ProjectSourceAttachmentRole;
  target: ProjectSourceAttachmentTarget;
  declaredAgainst: ProjectSourceAttachmentDeclaredAgainst;
  basisStatus: ProductNavigationAuthoringBasisStatus;
}

export interface ProductNavigationAuthoringAttachmentPage {
  workspaceRevision?: number;
  workspaceEventFingerprint?: string;
  attachments: ProductNavigationAuthoringAttachment[];
  nextCursor: string | null;
}

export interface ProductSearchHit {
  element: ProductStructureElementRef;
  label: string;
  match: "exact-id" | "label-token" | "id-token";
}

export type ProductTypedDefinitionRelation = "typed_by" | "selected-element";

export interface ProductDefinitionScopedEvidence {
  status: "observed" | "unattached";
  relation: ProductTypedDefinitionRelation;
  definition: ProductStructureElementRef;
  attachments: ProductNavigationAttachments;
}

export interface ProductOccurrencePage {
  occurrences: ProductNavigationNode[];
  nextCursor: string | null;
}

export type ProductApplicableActionKind =
  | "read-attachment"
  | "read-source-file"
  | "read-source-closure"
  | "capture-technical-source"
  | "explore-selection"
  | "inspect-selection";

export type ProductApplicableActionCode =
  | "action.source-removed"
  | "action.different-basis"
  | "action.file-head-missing";

/**
 * A bounded authoring recovery the caller can complete only by supplying a
 * fresh mutation id. This is a Digital Thread operation, not provider input.
 */
export interface ProductAttachmentRecrossRecoveryAction {
  readonly tool: "project_source_attachment_recross";
  readonly arguments: {
    readonly projectId: string;
    readonly expectedWorkspaceRevision: number;
    readonly attachments: readonly [{
      readonly attachmentId: string;
      readonly activeAttachmentRevision: number;
    }];
  };
  readonly callerSupplied: readonly ["mutationId"];
}

export type ProductApplicableAction =
  | {
    status: "ready";
    kind: "read-attachment";
    tool: "project_source_attachment_read";
    arguments: {
      projectId: string;
      workspaceRevision: number;
      attachmentId: string;
      attachmentRevision: number;
    };
  }
  | {
    status: "ready";
    kind: "read-source-file";
    tool: "project_source_file_read";
    arguments: {
      projectId: string;
      workspaceRevision: number;
      fileId: string;
      fileRevision: number;
    };
  }
  | {
    status: "ready";
    kind: "read-source-closure";
    tool: "project_source_closure";
    arguments: {
      projectId: string;
      expectedBasis: ProductNavigationBasis;
      selection: ProductStructureSelection;
      workspaceRevision: number;
      attachmentId: string;
      attachmentRevision: number;
    };
  }
  | {
    status: "ready";
    kind: "capture-technical-source";
    tool: "project_technical_source_capture";
    arguments: {
      projectId: string;
      workspaceRevision: number;
      attachmentId: string;
      attachmentRevision: number;
    };
  }
  | {
    status: "ready";
    kind: "explore-selection";
    tool: "project_product_explore";
    arguments: {
      projectId: string;
      expectedBasis: ProductNavigationBasis;
      selection: ProductStructureOccurrenceRef;
    };
  }
  | {
    status: "ready";
    kind: "inspect-selection";
    tool: "project_product_inspect";
    arguments: {
      projectId: string;
      expectedBasis: ProductNavigationBasis;
      selection: ProductStructureSelection;
    };
  }
  | {
    status: "blocked";
    kind: ProductApplicableActionKind;
    code: "action.different-basis";
    recovery: string;
    recoveryAction: ProductAttachmentRecrossRecoveryAction;
  }
  | {
    status: "blocked";
    kind: ProductApplicableActionKind;
    code: Exclude<ProductApplicableActionCode, "action.different-basis">;
    recovery: string;
  };

export interface ProductExploreSelections {
  focus: ProductStructureSelection;
  parent?: ProductStructureSelection;
  children: ProductStructureOccurrenceRef[];
}

export interface ProductExploreResult {
  schemaVersion: typeof PRODUCT_EXPLORE_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  diagnostics: ProductNavigationDiagnostic[];
  focus?: ProductNavigationNode;
  breadcrumbs: ProductNavigationNode[];
  parent?: ProductNavigationNode;
  children: ProductNavigationNode[];
  selections?: ProductExploreSelections;
  nextCursor: string | null;
  grants: "none";
}

export interface ProductSearchResult {
  schemaVersion: typeof PRODUCT_SEARCH_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  diagnostics: ProductNavigationDiagnostic[];
  matches: ProductSearchHit[];
  nextCursor: string | null;
  grants: "none";
}

export interface ProductInspectResult {
  schemaVersion: typeof PRODUCT_INSPECT_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  diagnostics: ProductNavigationDiagnostic[];
  selectedElement?: ProductStructureElementRef;
  selectedOccurrence?: ProductStructureOccurrenceRef;
  typedDefinition?: {
    relation: "typed_by";
    element: ProductStructureElementRef;
    label: string;
  };
  definitionScopedEvidence?: ProductDefinitionScopedEvidence;
  authoringAttachments: ProductNavigationAuthoringAttachmentPage;
  occurrences: ProductOccurrencePage;
  applicableActions: ProductApplicableAction[];
  grants: "none";
}

export interface ProductNavigationSourceClosureFile {
  fileId: string;
  fileRevision: number;
  role: string;
  resourceUri: string;
  resourceFingerprint: string;
}

export interface ProductNavigationSourceClosureEdge {
  from: { fileId: string; fileRevision: number };
  to: { fileId: string; fileRevision: number };
}

export type ProductSourceClosureEntry =
  | ({
    kind: "file";
  } & ProductNavigationSourceClosureFile)
  | ({
    kind: "edge";
  } & ProductNavigationSourceClosureEdge);

export interface ProductSourceClosureResult {
  schemaVersion: typeof PRODUCT_SOURCE_CLOSURE_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  diagnostics: ProductNavigationDiagnostic[];
  workspaceRevision?: number;
  workspaceEventFingerprint?: string;
  attachmentId?: string;
  attachmentRevision?: number;
  closureFingerprint?: string;
  entries: ProductSourceClosureEntry[];
  fileCount: number;
  edgeCount: number;
  nextCursor: string | null;
  grants: "none";
}

/**
 * Workbench GET/SSE packaging of roots plus the unique-root neighborhood.
 * Not a dump of the product tree.
 */
export interface ProductNavigationProjection {
  schemaVersion: typeof PRODUCT_NAVIGATION_QUERY_SCHEMA;
  status: ProductNavigationStatus;
  basis?: ProductNavigationBasis;
  roots: ProductNavigationNode[];
  children: ProductNavigationNode[];
  attachments: ProductNavigationAttachments;
}

export interface ProductNavigationAttachmentGraph {
  readonly nodes: readonly {
    readonly ref: { readonly kind: string; readonly id: string };
    readonly label: string;
  }[];
  readonly edges: readonly {
    readonly relation: string;
    readonly from: { readonly kind: string; readonly id: string };
    readonly to: { readonly kind: string; readonly id: string };
  }[];
}

export function emptyAttachments(): ProductNavigationAttachments {
  return {
    sources: [],
    geometry: [],
    physics: [],
    requirements: [],
  };
}

export function emptyAuthoringAttachmentPage(): ProductNavigationAuthoringAttachmentPage {
  return { attachments: [], nextCursor: null };
}

export function productNavigationOccurrenceNode(input: {
  readonly element: ProductStructureElementRef;
  readonly path: readonly string[];
  readonly label: string;
  readonly typedDefinition?: ProductStructureElementRef;
  readonly expandable: boolean;
}): ProductNavigationNode {
  const occurrence = productStructureOccurrenceRef({
    element: input.element,
    path: input.path,
  });
  return {
    element: occurrence.element,
    occurrence,
    ...(input.typedDefinition ? { typedDefinition: input.typedDefinition } : {}),
    label: input.label,
    expandable: input.expandable,
  };
}

export function productNavigationElementNode(input: {
  readonly element: ProductStructureElementRef;
  readonly label: string;
  readonly expandable: boolean;
}): ProductNavigationNode {
  return {
    element: productStructureElementRef(
      input.element.elementKind,
      input.element.elementId,
    ),
    label: input.label,
    expandable: input.expandable,
  };
}

export function parseProductNavigationBasis(
  value: unknown,
  path: string,
): ProductNavigationBasis {
  const rec = exactRecord(value, [
    "projectId",
    "threadSnapshotId",
    "threadRevision",
    "threadSubjectId",
    "architectureArtifactId",
    "architectureFingerprint",
    "captureSchema",
  ], path);
  const architectureFingerprint = nonEmptyText(
    rec.architectureFingerprint,
    `${path}.architectureFingerprint`,
  );
  if (!/^sha256:[a-f0-9]{64}$/.test(architectureFingerprint)) {
    throw new TypeError(
      `${path}.architectureFingerprint must be sha256:<64 hex>.`,
    );
  }
  if (rec.captureSchema !== "architecture-capture/4.0") {
    throw new TypeError(
      `${path}.captureSchema must be architecture-capture/4.0.`,
    );
  }
  return {
    projectId: parseBasisId(rec.projectId, `${path}.projectId`),
    threadSnapshotId: parseBasisId(
      rec.threadSnapshotId,
      `${path}.threadSnapshotId`,
    ),
    threadRevision: positiveInteger(rec.threadRevision, `${path}.threadRevision`),
    threadSubjectId: parseBasisId(rec.threadSubjectId, `${path}.threadSubjectId`),
    architectureArtifactId: parseBasisId(
      rec.architectureArtifactId,
      `${path}.architectureArtifactId`,
    ),
    architectureFingerprint,
    captureSchema: "architecture-capture/4.0",
  };
}

export function basesEqual(
  left: ProductNavigationBasis,
  right: ProductNavigationBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.threadSnapshotId === right.threadSnapshotId &&
    left.threadRevision === right.threadRevision &&
    left.threadSubjectId === right.threadSubjectId &&
    left.architectureArtifactId === right.architectureArtifactId &&
    left.architectureFingerprint === right.architectureFingerprint &&
    left.captureSchema === right.captureSchema;
}

function parseBasisId(value: unknown, path: string): string {
  const id = safeId(nonEmptyText(value, path), path);
  if (id.toLowerCase() === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  return id;
}

export function slicePage<T>(
  items: readonly T[],
  pageSize: number,
  offset = 0,
): { readonly items: T[]; readonly nextOffset: number | null } {
  const size = Math.min(
    PRODUCT_NAVIGATION_BOUNDS.maxPageSize,
    Math.max(1, pageSize),
  );
  const start = Math.max(0, offset);
  const page = items.slice(start, start + size);
  const next = start + page.length;
  return {
    items: page,
    nextOffset: next < items.length ? next : null,
  };
}

export function normalizePageSize(value: number | undefined): number {
  if (value === undefined) return PRODUCT_NAVIGATION_BOUNDS.defaultPageSize;
  if (!Number.isSafeInteger(value) || value < 1) {
    return PRODUCT_NAVIGATION_BOUNDS.defaultPageSize;
  }
  return Math.min(value, PRODUCT_NAVIGATION_BOUNDS.maxPageSize);
}

export function unavailableProductNavigationProjection(): ProductNavigationProjection {
  return {
    schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
    status: "unavailable",
    roots: [],
    children: [],
    attachments: emptyAttachments(),
  };
}

export function unavailableExplore(
  extras: Partial<ProductExploreResult> = {},
): ProductExploreResult {
  return {
    schemaVersion: PRODUCT_EXPLORE_SCHEMA,
    status: extras.status ?? "unavailable",
    diagnostics: extras.diagnostics ?? [],
    breadcrumbs: extras.breadcrumbs ?? [],
    children: extras.children ?? [],
    nextCursor: extras.nextCursor ?? null,
    grants: "none",
    ...(extras.basis ? { basis: extras.basis } : {}),
    ...(extras.focus ? { focus: extras.focus } : {}),
    ...(extras.parent ? { parent: extras.parent } : {}),
    ...(extras.selections ? { selections: extras.selections } : {}),
  };
}

export function unavailableSearch(
  extras: Partial<ProductSearchResult> = {},
): ProductSearchResult {
  return {
    schemaVersion: PRODUCT_SEARCH_SCHEMA,
    status: extras.status ?? "unavailable",
    diagnostics: extras.diagnostics ?? [],
    matches: extras.matches ?? [],
    nextCursor: extras.nextCursor ?? null,
    grants: "none",
    ...(extras.basis ? { basis: extras.basis } : {}),
  };
}

export function unavailableInspect(
  extras: Partial<ProductInspectResult> = {},
): ProductInspectResult {
  return {
    schemaVersion: PRODUCT_INSPECT_SCHEMA,
    status: extras.status ?? "unavailable",
    diagnostics: extras.diagnostics ?? [],
    authoringAttachments: extras.authoringAttachments ??
      emptyAuthoringAttachmentPage(),
    occurrences: extras.occurrences ?? { occurrences: [], nextCursor: null },
    applicableActions: extras.applicableActions ?? [],
    grants: "none",
    ...(extras.basis ? { basis: extras.basis } : {}),
    ...(extras.selectedElement ? { selectedElement: extras.selectedElement } : {}),
    ...(extras.selectedOccurrence
      ? { selectedOccurrence: extras.selectedOccurrence }
      : {}),
    ...(extras.typedDefinition ? { typedDefinition: extras.typedDefinition } : {}),
    ...(extras.definitionScopedEvidence
      ? { definitionScopedEvidence: extras.definitionScopedEvidence }
      : {}),
  };
}

export function unavailableClosure(
  extras: Partial<ProductSourceClosureResult> = {},
): ProductSourceClosureResult {
  return {
    schemaVersion: PRODUCT_SOURCE_CLOSURE_SCHEMA,
    status: extras.status ?? "unavailable",
    diagnostics: extras.diagnostics ?? [],
    entries: extras.entries ?? [],
    fileCount: extras.fileCount ?? 0,
    edgeCount: extras.edgeCount ?? 0,
    nextCursor: extras.nextCursor ?? null,
    grants: "none",
    ...(extras.basis ? { basis: extras.basis } : {}),
  };
}

export function attachmentsForDefinition(
  graph: ProductNavigationAttachmentGraph,
  definitionId: string,
  sourceFileIds?: ReadonlySet<string> | readonly string[],
  requirementScopes?: readonly ThreadRequirementDefinitionAttachment[],
): ProductNavigationAttachments {
  const allowed = sourceFileIds === undefined
    ? undefined
    : sourceFileIds instanceof Set
    ? sourceFileIds
    : new Set(sourceFileIds);
  const from = `part-definition:${definitionId}`;
  const attachments = emptyAttachments();
  for (const edge of graph.edges) {
    if (`${edge.from.kind}:${edge.from.id}` !== from) continue;
    const node = graph.nodes.find((item) =>
      item.ref.kind === edge.to.kind && item.ref.id === edge.to.id
    );
    const label = node?.label ?? edge.to.id;
    if (edge.relation === "represented_by" && edge.to.kind === "source-file") {
      if (allowed && !allowed.has(edge.to.id)) continue;
      attachments.sources.push({
        group: "sources",
        kind: "source-file",
        id: edge.to.id,
        label,
      });
    } else if (
      edge.relation === "represented_by" && edge.to.kind === "artifact"
    ) {
      attachments.geometry.push({
        group: "geometry",
        kind: "artifact",
        id: edge.to.id,
        label,
      });
    } else if (edge.relation === "verified_by") {
      attachments.physics.push({
        group: "physics",
        kind: "artifact",
        id: edge.to.id,
        label,
      });
    } else if (edge.relation === "constrained_by") {
      attachments.requirements.push({
        group: "requirements",
        kind: "requirement",
        id: edge.to.id,
        label,
      });
    }
  }
  const seen = new Set(attachments.requirements.map((item) => item.id));
  for (const requirement of requirementScopes ?? []) {
    if (requirement.targetElementId !== definitionId) continue;
    if (seen.has(requirement.requirementId)) continue;
    seen.add(requirement.requirementId);
    attachments.requirements.push({
      group: "requirements",
      kind: "requirement",
      id: requirement.requirementId,
      label: requirement.name,
    });
  }
  attachments.requirements.sort((left, right) => left.id.localeCompare(right.id));
  return attachments;
}
