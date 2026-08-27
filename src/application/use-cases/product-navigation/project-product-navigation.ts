/**
 * Server-owned SysML-first product navigation.
 *
 * Selects the unique current Thread tip and unique architecture-capture/4.0.
 * MCP tools and the Workbench GET/SSE projection are thin consumers.
 */

import type {
  ProductExploreQuery,
  ProductInspectQuery,
  ProductNavigationScope,
  ProductNavigationUseCase,
  ProductSearchQuery,
  ProductSourceClosureQuery,
} from "../../ports/in/product-navigation/product-navigation.ts";
import type {
  OpenedProductStructure,
  ProductStructureTraversal,
} from "../../ports/out/product-navigation/product-structure-traversal.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { resolveProjectSourceClosure } from "../../../domain/project-source-workspace/closure.ts";
import { ProjectSourceWorkspaceError } from "../../../domain/project-source-workspace/types.ts";
import type { ProductNavigationAuthoringAttachmentReader } from "../../ports/out/product-navigation/product-navigation-authoring-attachment-reader.ts";
import { productNavigationAuthoringCursorBinding } from "./product-navigation-authoring-cursor-binding.ts";
import type { ProductNavigationEvidenceAttachmentReader } from "../../ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import { threadRequirementsByCaptureScope } from "../../../domain/thread/requirement-definition-scope.ts";
import { exactRecord } from "../../../domain/kernel/case-validation.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import {
  type ProductStructureElementRef,
  productStructureElementRefsEqual,
  type ProductStructureOccurrenceRef,
} from "../../../domain/architecture/product-structure-ref.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentTarget,
} from "../../../domain/project-source-workspace/types.ts";
import {
  attachmentsForDefinition,
  basesEqual,
  emptyAttachments,
  emptyAuthoringAttachmentPage,
  normalizePageSize,
  parseProductNavigationBasis,
  PRODUCT_EXPLORE_SCHEMA,
  PRODUCT_INSPECT_SCHEMA,
  PRODUCT_NAVIGATION_BOUNDS,
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  PRODUCT_SEARCH_SCHEMA,
  PRODUCT_SOURCE_CLOSURE_SCHEMA,
  type ProductApplicableAction,
  type ProductAttachmentRecrossRecoveryAction,
  type ProductDefinitionScopedEvidence,
  type ProductExploreResult,
  type ProductInspectResult,
  type ProductNavigationAuthoringAttachment,
  type ProductNavigationAuthoringBasisStatus,
  type ProductNavigationBasis,
  type ProductNavigationDiagnostic,
  productNavigationElementNode,
  type ProductNavigationNode,
  type ProductNavigationProjection,
  type ProductSearchQueryKind,
  type ProductSearchResult,
  type ProductSourceClosureResult,
  type ProductStructureSelection,
  slicePage,
  unavailableClosure,
  unavailableExplore,
  unavailableInspect,
  unavailableProductNavigationProjection,
  unavailableSearch,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";

const EXPLORE_CURSOR_SCHEMA = "product-explore-cursor/1.0" as const;
const SEARCH_CURSOR_SCHEMA = "product-search-cursor/1.0" as const;
const OCCURRENCE_CURSOR_SCHEMA = "product-occurrence-cursor/1.0" as const;
const CLOSURE_CURSOR_SCHEMA = "product-source-closure-cursor/1.0" as const;

export interface ProjectProductNavigationDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly traversal: ProductStructureTraversal;
  readonly workspace?: Pick<
    ProjectSourceWorkspaceEventStore,
    "load" | "loadAtFresh"
  >;
  readonly evidenceAttachments?: ProductNavigationEvidenceAttachmentReader;
  readonly authoringAttachments?: ProductNavigationAuthoringAttachmentReader;
}

type OpenedNavigation = {
  readonly kind: "ok";
  readonly basis: ProductNavigationBasis;
  readonly snapshot: ThreadSnapshot;
  readonly structure: OpenedProductStructure;
};

type OpenResult =
  | OpenedNavigation
  | { readonly kind: "missing" }
  | { readonly kind: "stale"; readonly basis: ProductNavigationBasis };

export class ProjectProductNavigation implements ProductNavigationUseCase {
  readonly #projects: ProjectProductNavigationDependencies["projects"];
  readonly #snapshots: ProjectProductNavigationDependencies["snapshots"];
  readonly #traversal: ProductStructureTraversal;
  readonly #workspace: ProjectProductNavigationDependencies["workspace"];
  readonly #evidenceAttachments:
    ProjectProductNavigationDependencies["evidenceAttachments"];
  readonly #authoringAttachments:
    ProjectProductNavigationDependencies["authoringAttachments"];

  constructor(dependencies: ProjectProductNavigationDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#traversal = dependencies.traversal;
    this.#workspace = dependencies.workspace;
    this.#evidenceAttachments = dependencies.evidenceAttachments;
    this.#authoringAttachments = dependencies.authoringAttachments;
  }

  async explore(query: ProductExploreQuery): Promise<ProductExploreResult> {
    const opened = await this.open(query);
    if (opened.kind === "missing") return unavailableExplore();
    if (opened.kind === "stale") {
      return unavailableExplore({
        basis: opened.basis,
        diagnostics: [staleBasisDiagnostic()],
      });
    }
    const root = opened.structure.root();
    if (!root || root.element.elementKind !== "PartDefinition") {
      return unavailableExplore({
        basis: opened.basis,
        status: "unresolved",
        diagnostics: [diagnostic(
          "architecture.unresolved",
          "semanticRoot",
          "Recapture architecture-capture/4.0 with an exact semanticRoot PartDefinition.",
        )],
      });
    }
    const focused = query.selection
      ? locateExploreOccurrence(opened.structure, query.selection)
      : {
        focus: root,
        breadcrumbs: [root],
        parent: undefined as ProductNavigationNode | undefined,
        children: opened.structure.childrenOfRoot(),
      };
    if (!focused) {
      return unavailableExplore({
        basis: opened.basis,
        status: "unattached",
        diagnostics: [diagnostic(
          "selection.unattached",
          "selection",
          "Pass a PartUsage occurrence published by explore or inspect on this exact basis.",
        )],
      });
    }
    const pageSize = normalizePageSize(query.pageSize);
    const cursor = decodeNavigationCursor(query.cursor, {
      schemaVersion: EXPLORE_CURSOR_SCHEMA,
      basis: opened.basis,
      focus: query.selection
        ? {
          kind: "occurrence",
          elementKind: query.selection.element.elementKind,
          elementId: query.selection.element.elementId,
          path: [...query.selection.path],
        }
        : {
          kind: "element",
          elementKind: root.element.elementKind,
          elementId: root.element.elementId,
          path: [],
        },
    });
    if (cursor === "invalid") {
      return unavailableExplore({
        basis: opened.basis,
        status: "unresolved",
        diagnostics: [cursorMismatchDiagnostic()],
      });
    }
    const page = slicePage(focused.children, pageSize, cursor);
    const nextCursor = page.nextOffset === null ? null : encodeNavigationCursor({
      schemaVersion: EXPLORE_CURSOR_SCHEMA,
      basis: opened.basis,
      focus: query.selection
        ? {
          kind: "occurrence",
          elementKind: query.selection.element.elementKind,
          elementId: query.selection.element.elementId,
          path: [...query.selection.path],
        }
        : {
          kind: "element",
          elementKind: root.element.elementKind,
          elementId: root.element.elementId,
          path: [],
        },
      offset: page.nextOffset,
    });
    const focusSelection: ProductStructureSelection = focused.focus.occurrence
      ? { kind: "occurrence", occurrence: focused.focus.occurrence }
      : { kind: "element", element: focused.focus.element };
    const parentSelection: ProductStructureSelection | undefined =
      focused.parent?.occurrence
        ? { kind: "occurrence", occurrence: focused.parent.occurrence }
        : focused.parent
        ? { kind: "element", element: focused.parent.element }
        : undefined;
    return {
      schemaVersion: PRODUCT_EXPLORE_SCHEMA,
      status: "observed",
      basis: opened.basis,
      diagnostics: [],
      focus: focused.focus,
      breadcrumbs: focused.breadcrumbs,
      ...(focused.parent ? { parent: focused.parent } : {}),
      children: page.items,
      selections: {
        focus: focusSelection,
        ...(parentSelection ? { parent: parentSelection } : {}),
        children: page.items.flatMap((item) =>
          item.occurrence ? [item.occurrence] : []
        ),
      },
      nextCursor,
      grants: "none",
    };
  }

  async search(query: ProductSearchQuery): Promise<ProductSearchResult> {
    const opened = await this.open(query);
    if (opened.kind === "missing") return unavailableSearch();
    if (opened.kind === "stale") {
      return unavailableSearch({
        basis: opened.basis,
        diagnostics: [staleBasisDiagnostic()],
      });
    }
    const hits = opened.structure.searchElements(query.query);
    const pageSize = normalizePageSize(query.pageSize);
    const boundQuery = normalizeSearchQuery(query.query);
    const cursor = decodeNavigationCursor(query.cursor, {
      schemaVersion: SEARCH_CURSOR_SCHEMA,
      basis: opened.basis,
      query: boundQuery,
    });
    if (cursor === "invalid") {
      return unavailableSearch({
        basis: opened.basis,
        status: "unresolved",
        diagnostics: [cursorMismatchDiagnostic()],
      });
    }
    const page = slicePage(hits, pageSize, cursor);
    return {
      schemaVersion: PRODUCT_SEARCH_SCHEMA,
      status: page.items.length === 0 && cursor === 0 ? "unattached" : "observed",
      basis: opened.basis,
      diagnostics: [],
      matches: page.items,
      nextCursor: page.nextOffset === null ? null : encodeNavigationCursor({
        schemaVersion: SEARCH_CURSOR_SCHEMA,
        basis: opened.basis,
        query: boundQuery,
        offset: page.nextOffset,
      }),
      grants: "none",
    };
  }

  async inspect(query: ProductInspectQuery): Promise<ProductInspectResult> {
    if (!query.expectedBasis && query.snapshot === undefined) {
      // Workbench may omit expectedBasis and still inspect the current tip.
    }
    const opened = await this.open(query);
    if (opened.kind === "missing") return unavailableInspect();
    if (opened.kind === "stale") {
      return unavailableInspect({
        basis: opened.basis,
        diagnostics: [staleBasisDiagnostic()],
      });
    }
    const located = locateSelection(opened.structure, query.selection);
    if (!located) {
      return unavailableInspect({
        basis: opened.basis,
        status: "unattached",
        diagnostics: [diagnostic(
          "selection.unattached",
          "selection",
          "Inspect an exact element or occurrence published on this architecture basis.",
        )],
      });
    }
    const selectedElement = located.element;
    const evidenceDefinition = located.typedDefinition ??
      (selectedElement.elementKind === "PartDefinition" ? selectedElement : undefined);
    const evidence = evidenceDefinition
      ? await this.definitionEvidence(
        opened,
        query.projectId,
        evidenceDefinition,
        located.typedDefinition ? "typed_by" : "selected-element",
      )
      : {
        status: "unattached" as const,
        relation: "selected-element" as const,
        definition: selectedElement,
        attachments: emptyAttachments(),
      };
    let authoring;
    try {
      authoring = await this.authoringPage(query.projectId, selectedElement, {
        pageSize: query.pageSize,
        cursor: query.cursor,
        basis: opened.basis,
        selection: canonicalInspectSelection(located),
        snapshot: opened.snapshot,
      });
    } catch (error) {
      if (
        error instanceof ProjectSourceWorkspaceError &&
        error.code === "cursor_mismatch"
      ) {
        return unavailableInspect({
          basis: opened.basis,
          status: "unresolved",
          selectedElement,
          diagnostics: [cursorMismatchDiagnostic()],
        });
      }
      throw error;
    }
    const occurrencePageSize = normalizePageSize(query.occurrencesPageSize);
    const occurrenceCursor = decodeNavigationCursor(query.occurrencesCursor, {
      schemaVersion: OCCURRENCE_CURSOR_SCHEMA,
      basis: opened.basis,
      elementKind: selectedElement.elementKind,
      elementId: selectedElement.elementId,
    });
    if (occurrenceCursor === "invalid") {
      return unavailableInspect({
        basis: opened.basis,
        status: "unresolved",
        selectedElement,
        diagnostics: [cursorMismatchDiagnostic()],
      });
    }
    const occurrencePage = opened.structure.pageOccurrences(
      selectedElement,
      occurrenceCursor,
      occurrencePageSize,
    );
    const applicableActions = inspectActions({
      projectId: query.projectId,
      basis: opened.basis,
      selection: canonicalInspectSelection(located),
      located,
      authoring: authoring.attachments,
      workspaceRevision: authoring.workspaceRevision,
    });
    return {
      schemaVersion: PRODUCT_INSPECT_SCHEMA,
      status: "observed",
      basis: opened.basis,
      diagnostics: [],
      selectedElement,
      ...(located.occurrence ? { selectedOccurrence: located.occurrence } : {}),
      ...(located.typedDefinitionLabel
        ? {
          typedDefinition: {
            relation: "typed_by" as const,
            element: located.typedDefinition!,
            label: located.typedDefinitionLabel,
          },
        }
        : {}),
      definitionScopedEvidence: evidence,
      authoringAttachments: authoring,
      occurrences: {
        occurrences: [...occurrencePage.items],
        nextCursor: occurrencePage.nextOffset === null ? null : encodeNavigationCursor({
          schemaVersion: OCCURRENCE_CURSOR_SCHEMA,
          basis: opened.basis,
          elementKind: selectedElement.elementKind,
          elementId: selectedElement.elementId,
          offset: occurrencePage.nextOffset,
        }),
      },
      applicableActions,
      grants: "none",
    };
  }

  async sourceClosure(
    query: ProductSourceClosureQuery,
  ): Promise<ProductSourceClosureResult> {
    const opened = await this.open(query);
    if (opened.kind === "missing") return unavailableClosure();
    if (opened.kind === "stale") {
      return unavailableClosure({
        basis: opened.basis,
        diagnostics: [staleBasisDiagnostic()],
      });
    }
    if (!this.#workspace) {
      return unavailableClosure({ basis: opened.basis });
    }
    const located = locateSelection(opened.structure, query.selection);
    if (!located) {
      return unavailableClosure({
        basis: opened.basis,
        status: "unattached",
        diagnostics: [diagnostic(
          "selection.unattached",
          "selection",
          "Name the exact element or occurrence attached to the named revision.",
        )],
      });
    }
    try {
      const named = await this.#workspace.loadAtFresh(
        query.projectId,
        query.workspaceRevision,
      );
      const closure = await resolveProjectSourceClosure(named, {
        attachmentId: query.attachmentId,
        attachmentRevision: query.attachmentRevision,
      });
      const target = located.element;
      if (
        closure.attachment.target.elementId !== target.elementId ||
        closure.attachment.target.elementKind !== target.elementKind
      ) {
        return unavailableClosure({
          basis: opened.basis,
          status: "unattached",
          diagnostics: [diagnostic(
            "selection.unattached",
            "attachment.target",
            "The named attachment revision is not attached to this exact SysML element.",
          )],
        });
      }
      if (
        authoringBasisStatus(
          closure.attachment.declaredAgainst,
          opened.basis,
          opened.snapshot,
        ) !== "exact-basis"
      ) {
        return unavailableClosure({
          basis: opened.basis,
          diagnostics: [diagnostic(
            "basis.stale",
            "attachment.declaredAgainst",
            "Recross an exact-basis attachment revision. Different-basis heads stay visible on inspect.",
          )],
        });
      }
      const files = closure.files.map((file) => ({
        kind: "file" as const,
        fileId: file.fileId,
        fileRevision: file.fileRevision,
        role: file.role,
        resourceUri: file.resourceRef.uri,
        resourceFingerprint:
          `${file.resourceRef.fingerprint.algorithm}:${file.resourceRef.fingerprint.digest}`,
      }));
      const edges = closure.edges.map((edge) => ({
        kind: "edge" as const,
        from: { fileId: edge.from.fileId, fileRevision: edge.from.fileRevision },
        to: { fileId: edge.to.fileId, fileRevision: edge.to.fileRevision },
      }));
      const entries = [...files, ...edges];
      if (!closureEntriesAreConnected(files, edges)) {
        return unavailableClosure({ basis: opened.basis });
      }
      const closureFingerprint =
        `${closure.fingerprint.algorithm}:${closure.fingerprint.digest}`;
      const pageSize = normalizePageSize(query.pageSize);
      const selection = query.selection;
      const cursor = decodeNavigationCursor(query.cursor, {
        schemaVersion: CLOSURE_CURSOR_SCHEMA,
        basis: opened.basis,
        workspaceRevision: named.workspaceRevision,
        attachmentId: query.attachmentId,
        attachmentRevision: query.attachmentRevision,
        closureFingerprint,
        selection,
      });
      if (cursor === "invalid") {
        return unavailableClosure({
          basis: opened.basis,
          status: "unresolved",
          diagnostics: [cursorMismatchDiagnostic()],
        });
      }
      const page = slicePage(entries, pageSize, cursor);
      return {
        schemaVersion: PRODUCT_SOURCE_CLOSURE_SCHEMA,
        status: "observed",
        basis: opened.basis,
        diagnostics: [],
        workspaceRevision: named.workspaceRevision,
        workspaceEventFingerprint: named.lastEventFingerprint
          ? `${named.lastEventFingerprint.algorithm}:${named.lastEventFingerprint.digest}`
          : undefined,
        attachmentId: closure.attachment.attachmentId,
        attachmentRevision: closure.attachment.attachmentRevision,
        closureFingerprint,
        entries: page.items,
        fileCount: files.length,
        edgeCount: edges.length,
        nextCursor: page.nextOffset === null ? null : encodeNavigationCursor({
          schemaVersion: CLOSURE_CURSOR_SCHEMA,
          basis: opened.basis,
          workspaceRevision: named.workspaceRevision,
          attachmentId: query.attachmentId,
          attachmentRevision: query.attachmentRevision,
          closureFingerprint,
          selection,
          offset: page.nextOffset,
        }),
        grants: "none",
      };
    } catch {
      return { ...unavailableClosure(), basis: opened.basis };
    }
  }

  async projection(
    query: ProductNavigationScope,
  ): Promise<ProductNavigationProjection> {
    const opened = await this.open(query);
    if (opened.kind === "missing") {
      return unavailableProductNavigationProjection();
    }
    if (opened.kind === "stale") {
      return {
        ...unavailableProductNavigationProjection(),
        basis: opened.basis,
      };
    }
    const root = opened.structure.root();
    if (!root || root.element.elementKind !== "PartDefinition") {
      return {
        ...unavailableProductNavigationProjection(),
        status: "unresolved",
        basis: opened.basis,
      };
    }
    const children = opened.structure.childrenOfRoot();
    const evidence = await this.definitionEvidence(
      opened,
      query.projectId,
      root.element,
      "selected-element",
    );
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      roots: [root],
      children: [...children],
      attachments: evidence.attachments,
    };
  }

  private async authoringPage(
    projectId: string,
    target: ProjectSourceAttachmentTarget,
    query: {
      readonly pageSize?: number;
      readonly cursor?: string;
      readonly basis: ProductNavigationBasis;
      readonly selection: ProductStructureSelection;
      readonly snapshot: ThreadSnapshot;
    },
  ) {
    if (!this.#authoringAttachments) {
      return emptyAuthoringAttachmentPage();
    }
    const page = await this.#authoringAttachments.listActiveHeads({
      projectId,
      target,
      cursorBinding: await productNavigationAuthoringCursorBinding(
        query.basis,
        query.selection,
      ),
      ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return {
      workspaceRevision: page.workspaceRevision,
      ...(page.workspaceEventFingerprint
        ? { workspaceEventFingerprint: page.workspaceEventFingerprint }
        : {}),
      attachments: page.attachments.map((entry) => ({
        ...entry,
        basisStatus: authoringBasisStatus(
          entry.declaredAgainst,
          query.basis,
          query.snapshot,
        ),
      })),
      nextCursor: page.nextCursor,
    };
  }

  private async definitionEvidence(
    opened: OpenedNavigation,
    projectId: string,
    definition: ProductStructureElementRef,
    relation: ProductDefinitionScopedEvidence["relation"],
  ): Promise<ProductDefinitionScopedEvidence> {
    const facts = this.#evidenceAttachments
      ? await this.#evidenceAttachments.read(opened.snapshot, {
        projectId,
        architectureArtifactId: opened.basis.architectureArtifactId,
        architectureFingerprint: opened.basis.architectureFingerprint,
      })
      : undefined;
    const scoped = facts
      ? threadRequirementsByCaptureScope(
        opened.snapshot,
        facts.requirementScopes ?? [],
      )
      : [];
    const attachments = facts
      ? attachmentsForDefinition(
        facts,
        definition.elementId,
        facts.sourceFileIds,
        scoped,
      )
      : emptyAttachments();
    const empty = attachments.sources.length === 0 &&
      attachments.geometry.length === 0 &&
      attachments.physics.length === 0 &&
      attachments.requirements.length === 0;
    return {
      status: empty ? "unattached" : "observed",
      relation,
      definition,
      attachments,
    };
  }

  private async open(scope: ProductNavigationScope): Promise<OpenResult> {
    const projectId = scope.projectId;
    if (projectId === "latest" || projectId !== projectId.trim()) {
      return { kind: "missing" };
    }
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) return { kind: "missing" };
    const thread = scope.snapshot
      ? boundSnapshot(project, scope.snapshot)
      : await this.currentTipSnapshot(project);
    if (!thread) return { kind: "missing" };
    const structure = await this.#traversal.open(thread);
    if (!structure) return { kind: "missing" };
    const basis: ProductNavigationBasis = {
      projectId,
      threadSnapshotId: thread.id,
      threadRevision: thread.revision,
      threadSubjectId: thread.subject.id,
      architectureArtifactId: structure.architectureArtifactId,
      architectureFingerprint:
        `${structure.architectureFingerprint.algorithm}:${structure.architectureFingerprint.digest}`,
      captureSchema: "architecture-capture/4.0",
    };
    if (scope.expectedBasis && !basesEqual(scope.expectedBasis, basis)) {
      return { kind: "stale", basis };
    }
    return { kind: "ok", basis, snapshot: thread, structure };
  }

  private async currentTipSnapshot(project: EngineeringProjectSnapshot) {
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") return undefined;
    const snapshot = await this.#snapshots.get(tip.basis.snapshotId);
    if (!snapshot) return undefined;
    if (
      snapshot.id !== tip.basis.snapshotId ||
      snapshot.revision !== tip.basis.revision ||
      snapshot.subject.id !== tip.basis.subjectId
    ) {
      return undefined;
    }
    return snapshot;
  }
}

function boundSnapshot(
  project: EngineeringProjectSnapshot,
  snapshot: ThreadSnapshot,
): ThreadSnapshot | undefined {
  if (
    snapshot.id === "latest" ||
    snapshot.subject.id !== project.project.subjectId
  ) {
    return undefined;
  }
  const listed = project.threadSnapshots.some((item) =>
    item.snapshotId === snapshot.id &&
    item.revision === snapshot.revision &&
    item.subjectId === snapshot.subject.id
  );
  if (!listed) return undefined;
  return snapshot;
}

function locateExploreOccurrence(
  structure: OpenedProductStructure,
  selection: ProductStructureOccurrenceRef,
): {
  readonly focus: ProductNavigationNode;
  readonly breadcrumbs: ProductNavigationNode[];
  readonly parent?: ProductNavigationNode;
  readonly children: readonly ProductNavigationNode[];
} | undefined {
  if (selection.element.elementKind !== "PartUsage") return undefined;
  const breadcrumbs = structure.path(selection.path);
  const focus = breadcrumbs?.at(-1);
  if (!focus?.occurrence) return undefined;
  if (
    !productStructureElementRefsEqual(focus.element, selection.element)
  ) {
    return undefined;
  }
  const around = structure.neighborhood(selection);
  return {
    focus,
    breadcrumbs: [...(breadcrumbs ?? [focus])],
    parent: around.parent,
    children: around.children,
  };
}

function locateSelection(
  structure: OpenedProductStructure,
  selection: ProductStructureSelection,
): {
  readonly element: ProductStructureElementRef;
  readonly occurrence?: ProductStructureOccurrenceRef;
  readonly typedDefinition?: ProductStructureElementRef;
  readonly typedDefinitionLabel?: string;
  readonly expandable: boolean;
  readonly node?: ProductNavigationNode;
} | undefined {
  if (selection.kind === "occurrence") {
    const nodes = structure.path(selection.occurrence.path);
    const node = nodes?.at(-1);
    if (!node?.occurrence) return undefined;
    if (
      !productStructureElementRefsEqual(
        node.element,
        selection.occurrence.element,
      )
    ) {
      return undefined;
    }
    const typed = node.element.elementKind === "PartUsage"
      ? structure.typedDefinition(node.element.elementId)
      : undefined;
    return {
      element: node.element,
      occurrence: node.occurrence,
      typedDefinition: typed?.element ?? node.typedDefinition,
      typedDefinitionLabel: typed?.label,
      expandable: node.expandable,
      node,
    };
  }
  if (!structure.hasElement(selection.element)) return undefined;
  const record = structure.element(selection.element.elementId);
  if (
    !record ||
    !productStructureElementRefsEqual(record.element, selection.element)
  ) {
    return undefined;
  }
  const typed = record.element.elementKind === "PartUsage"
    ? structure.typedDefinition(record.element.elementId)
    : undefined;
  return {
    element: record.element,
    typedDefinition: typed?.element,
    typedDefinitionLabel: typed?.label,
    expandable: record.expandable,
    node: productNavigationElementNode({
      element: record.element,
      label: record.label,
      expandable: record.expandable,
    }),
  };
}

function canonicalInspectSelection(located: {
  readonly element: ProductStructureElementRef;
  readonly occurrence?: ProductStructureOccurrenceRef;
}): ProductStructureSelection {
  return located.occurrence
    ? { kind: "occurrence", occurrence: located.occurrence }
    : { kind: "element", element: located.element };
}

function inspectActions(input: {
  readonly projectId: string;
  readonly basis: ProductNavigationBasis;
  readonly selection: ProductStructureSelection;
  readonly located: {
    readonly element: ProductStructureElementRef;
    readonly occurrence?: ProductStructureOccurrenceRef;
    readonly typedDefinition?: ProductStructureElementRef;
    readonly expandable: boolean;
  };
  readonly authoring: readonly ProductNavigationAuthoringAttachment[];
  readonly workspaceRevision?: number;
}): ProductApplicableAction[] {
  const actions: ProductApplicableAction[] = [];
  const selection = input.selection;
  if (input.located.occurrence) {
    actions.push({
      status: "ready",
      kind: "explore-selection",
      tool: "project_product_explore",
      arguments: {
        projectId: input.projectId,
        expectedBasis: input.basis,
        selection: input.located.occurrence,
      },
    });
  }
  if (input.located.typedDefinition) {
    actions.push({
      status: "ready",
      kind: "inspect-selection",
      tool: "project_product_inspect",
      arguments: {
        projectId: input.projectId,
        expectedBasis: input.basis,
        selection: {
          kind: "element",
          element: input.located.typedDefinition,
        },
      },
    });
  }
  const workspaceRevision = input.workspaceRevision;
  if (workspaceRevision === undefined) return actions;
  for (const attachment of input.authoring) {
    actions.push({
      status: "ready",
      kind: "read-attachment",
      tool: "project_source_attachment_read",
      arguments: {
        projectId: input.projectId,
        workspaceRevision,
        attachmentId: attachment.attachmentId,
        attachmentRevision: attachment.attachmentRevision,
      },
    });
    if (attachment.fileHeadRevision !== null) {
      actions.push({
        status: "ready",
        kind: "read-source-file",
        tool: "project_source_file_read",
        arguments: {
          projectId: input.projectId,
          workspaceRevision,
          fileId: attachment.fileId,
          fileRevision: attachment.fileHeadRevision,
        },
      });
    } else if (attachment.fileHeadRevision === null) {
      actions.push({
        status: "blocked",
        kind: "read-source-file",
        code: "action.file-head-missing",
        recovery:
          "Read the attachment metadata. Restore or recapture the file before reading bytes.",
      });
    }
    const captureBlocked = blockedCaptureOrClosure(attachment);
    if (captureBlocked) {
      const recovery = blockedRecovery({
        code: captureBlocked,
        projectId: input.projectId,
        workspaceRevision,
        attachment,
      });
      for (
        const kind of [
          "capture-technical-source",
          "read-source-closure",
        ] as const
      ) {
        if (captureBlocked === "action.different-basis") {
          actions.push({
            status: "blocked",
            kind,
            code: captureBlocked,
            recovery,
            recoveryAction: blockedRecoveryAction({
              projectId: input.projectId,
              workspaceRevision,
              attachment,
            }),
          });
          continue;
        }
        actions.push({
          status: "blocked",
          kind,
          code: captureBlocked,
          recovery,
        });
      }
      continue;
    }
    actions.push({
      status: "ready",
      kind: "capture-technical-source",
      tool: "project_technical_source_capture",
      arguments: {
        projectId: input.projectId,
        workspaceRevision,
        attachmentId: attachment.attachmentId,
        attachmentRevision: attachment.attachmentRevision,
      },
    });
    actions.push({
      status: "ready",
      kind: "read-source-closure",
      tool: "project_source_closure",
      arguments: {
        projectId: input.projectId,
        expectedBasis: input.basis,
        selection,
        workspaceRevision,
        attachmentId: attachment.attachmentId,
        attachmentRevision: attachment.attachmentRevision,
      },
    });
  }
  return actions;
}

function blockedCaptureOrClosure(
  attachment: ProductNavigationAuthoringAttachment,
): "action.source-removed" | "action.different-basis" | undefined {
  if (attachment.sourceStatus === "source-removed") return "action.source-removed";
  if (attachment.basisStatus === "different-basis") return "action.different-basis";
  return undefined;
}

function blockedRecovery(
  input: {
    readonly code: "action.source-removed" | "action.different-basis";
    readonly projectId: string;
    readonly workspaceRevision?: number;
    readonly attachment: ProductNavigationAuthoringAttachment;
  },
): string {
  if (input.code === "action.source-removed") {
    return "The source file is tombstoned. Restore or recapture a successor file revision before capture or closure.";
  }
  const attachment = input.attachment;
  const recrossArguments = {
    projectId: input.projectId,
    ...(input.workspaceRevision === undefined
      ? {}
      : { expectedWorkspaceRevision: input.workspaceRevision }),
    attachments: [{
      attachmentId: attachment.attachmentId,
      activeAttachmentRevision: attachment.attachmentRevision,
    }],
  };
  return "Call project_source_attachment_recross with " +
    `${
      JSON.stringify(recrossArguments)
    } and a new mutationId. The server recrosses this existing attachment against the published current architecture basis before capture or closure.`;
}

function blockedRecoveryAction(
  input: {
    readonly projectId: string;
    readonly workspaceRevision: number;
    readonly attachment: ProductNavigationAuthoringAttachment;
  },
): ProductAttachmentRecrossRecoveryAction {
  return {
    tool: "project_source_attachment_recross",
    arguments: {
      projectId: input.projectId,
      expectedWorkspaceRevision: input.workspaceRevision,
      attachments: [{
        attachmentId: input.attachment.attachmentId,
        activeAttachmentRevision: input.attachment.attachmentRevision,
      }],
    },
    callerSupplied: ["mutationId"],
  };
}

function authoringBasisStatus(
  declared: ProjectSourceAttachmentDeclaredAgainst,
  basis: ProductNavigationBasis,
  snapshot: ThreadSnapshot,
): ProductNavigationAuthoringBasisStatus {
  if (
    declared.thread.snapshotId === basis.threadSnapshotId &&
    declared.thread.revision === basis.threadRevision &&
    declared.thread.subjectId === basis.threadSubjectId &&
    snapshot.subject.id === basis.threadSubjectId &&
    declared.architecture.artifactId === basis.architectureArtifactId &&
    fingerprintsEqual(
      declared.architecture.fingerprint,
      fingerprintFromRef(basis.architectureFingerprint),
    ) &&
    declared.architecture.captureSchema === basis.captureSchema
  ) {
    return "exact-basis";
  }
  return "different-basis";
}

function fingerprintFromRef(value: string): {
  algorithm: "sha256";
  digest: string;
} | undefined {
  const match = /^sha256:([a-f0-9]{64})$/.exec(value);
  if (!match) return undefined;
  return { algorithm: "sha256", digest: match[1]! };
}

function diagnostic(
  code: ProductNavigationDiagnostic["code"],
  relation: string,
  recovery: string,
): ProductNavigationDiagnostic {
  return { code, relation, recovery };
}

function staleBasisDiagnostic(): ProductNavigationDiagnostic {
  return diagnostic(
    "basis.stale",
    "expectedBasis",
    "Call again with the published current basis, or start from projectId only. Historical navigation is refused.",
  );
}

function cursorMismatchDiagnostic(): ProductNavigationDiagnostic {
  return diagnostic(
    "cursor.mismatch",
    "cursor",
    "Reuse the opaque nextCursor from this tool on the same project, basis and selection.",
  );
}

function normalizeSearchQuery(
  query: ProductSearchQueryKind,
): ProductSearchQueryKind {
  if (query.kind === "exact-id") {
    return { kind: "exact-id", elementId: query.elementId };
  }
  return { kind: "text", text: query.text.trim().toLowerCase() };
}

function encodeNavigationCursor(
  payload: Record<string, unknown> & { readonly offset: number },
): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

function decodeNavigationCursor(
  cursor: string | undefined,
  expected: Record<string, unknown>,
): number | "invalid" {
  if (cursor === undefined) return 0;
  if (
    cursor === "latest" ||
    cursor.length > PRODUCT_NAVIGATION_BOUNDS.maxCursorLength
  ) {
    return "invalid";
  }
  try {
    const rec = exactRecord(
      JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(decodeBase64Url(cursor)),
      ),
      [...Object.keys(expected), "offset"],
      "$cursor",
    );
    if (rec.schemaVersion !== expected.schemaVersion) return "invalid";
    const basis = parseProductNavigationBasis(rec.basis, "$cursor.basis");
    if (!basesEqual(basis, expected.basis as ProductNavigationBasis)) {
      return "invalid";
    }
    for (const key of Object.keys(expected)) {
      if (key === "schemaVersion" || key === "basis") continue;
      if (JSON.stringify(rec[key]) !== JSON.stringify(expected[key])) {
        return "invalid";
      }
    }
    if (!Number.isSafeInteger(rec.offset) || Number(rec.offset) < 0) {
      return "invalid";
    }
    return Number(rec.offset);
  } catch {
    return "invalid";
  }
}

function closureEntriesAreConnected(
  files: readonly { readonly fileId: string; readonly fileRevision: number }[],
  edges: readonly {
    readonly from: { readonly fileId: string; readonly fileRevision: number };
    readonly to: { readonly fileId: string; readonly fileRevision: number };
  }[],
): boolean {
  const keys = new Set(
    files.map((file) => `${file.fileId}@${file.fileRevision}`),
  );
  return edges.every((edge) =>
    keys.has(`${edge.from.fileId}@${edge.from.fileRevision}`) &&
    keys.has(`${edge.to.fileId}@${edge.to.fileRevision}`)
  );
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

function decodeBase64Url(value: string): Uint8Array {
  if (value.length === 0 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("invalid base64url");
  }
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") +
    "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
