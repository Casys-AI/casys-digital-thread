/**
 * Server-owned SysML-first product navigation.
 *
 * Selects the unique current Thread tip and unique architecture-capture/4.0.
 * MCP tools and the Workbench GET/SSE projection are thin consumers.
 */

import type {
  ProductNavigationNodeQuery,
  ProductNavigationScope,
  ProductNavigationUseCase,
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
import type { ProductNavigationAuthoringAttachmentReader } from "../../ports/out/product-navigation/product-navigation-authoring-attachment-reader.ts";
import type { ProductNavigationEvidenceAttachmentReader } from "../../ports/out/product-navigation/product-navigation-evidence-attachment-reader.ts";
import { fingerprintsEqual } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ProjectSourceAttachmentDeclaredAgainst,
  ProjectSourceAttachmentTarget,
} from "../../../domain/project-source-workspace/types.ts";
import {
  attachmentsForDefinition,
  emptyAttachments,
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
  type ProductNavigationAuthoringAttachments,
  type ProductNavigationAuthoringBasisStatus,
  type ProductNavigationBasis,
  type ProductNavigationChildren,
  type ProductNavigationContext,
  type ProductNavigationNeighborhood,
  type ProductNavigationNode,
  type ProductNavigationPath,
  type ProductNavigationProjection,
  type ProductNavigationRoots,
  type ProductNavigationSearch,
  type ProductNavigationSourceClosure,
  unavailableProductNavigationProjection,
  unavailableProductNavigationRoots,
} from "../../ports/in/product-navigation/product-navigation-read-model.ts";

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

  async roots(query: ProductNavigationScope): Promise<ProductNavigationRoots> {
    const opened = await this.open(query);
    if (!opened) return unavailableProductNavigationRoots();
    const root = opened.structure.root();
    if (!root) {
      return {
        ...unavailableProductNavigationRoots(),
        basis: opened.basis,
        status: "unresolved",
      };
    }
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      roots: [root],
    };
  }

  async children(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationChildren> {
    const opened = await this.open(query);
    if (!opened) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unavailable",
        parent: unresolvedNode(query.node),
        children: [],
      };
    }
    const parent = locate(opened, query.node);
    if (!parent) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unattached",
        basis: opened.basis,
        parent: unresolvedNode(query.node),
        children: [],
      };
    }
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      parent,
      children: [...opened.structure.childrenOf(parent)],
    };
  }

  async path(
    query: ProductNavigationScope & { readonly usagePath: readonly string[] },
  ): Promise<ProductNavigationPath> {
    const opened = await this.open(query);
    if (!opened) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unavailable",
        nodes: [],
      };
    }
    const nodes = opened.structure.path(query.usagePath);
    if (!nodes) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unattached",
        basis: opened.basis,
        nodes: [],
      };
    }
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      nodes: [...nodes],
    };
  }

  async context(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationContext> {
    const opened = await this.open(query);
    if (!opened) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unavailable",
        node: unresolvedNode(query.node),
        attachments: emptyAttachments(),
      };
    }
    const node = locate(opened, query.node);
    if (!node) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unattached",
        basis: opened.basis,
        node: unresolvedNode(query.node),
        attachments: emptyAttachments(),
      };
    }
    const facts = this.#evidenceAttachments
      ? await this.#evidenceAttachments.read(opened.snapshot, {
        projectId: query.projectId,
      })
      : undefined;
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      node,
      attachments: facts
        ? attachmentsForDefinition(
          facts,
          node.definitionId,
          facts.sourceFileIds,
        )
        : emptyAttachments(),
    };
  }

  async search(
    query: ProductNavigationScope & { readonly id: string },
  ): Promise<ProductNavigationSearch> {
    const opened = await this.open(query);
    if (!opened) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unavailable",
        matches: [],
      };
    }
    if (query.id === "latest" || query.id !== query.id.trim()) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unattached",
        basis: opened.basis,
        matches: [],
      };
    }
    const matches = opened.structure.locate(query.id);
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: matches.length === 0 ? "unattached" : "observed",
      basis: opened.basis,
      matches: [...matches],
    };
  }

  async neighborhood(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
    },
  ): Promise<ProductNavigationNeighborhood> {
    const opened = await this.open(query);
    if (!opened) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unavailable",
        node: unresolvedNode(query.node),
        siblings: [],
        children: [],
      };
    }
    const node = locate(opened, query.node);
    if (!node) {
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "unattached",
        basis: opened.basis,
        node: unresolvedNode(query.node),
        siblings: [],
        children: [],
      };
    }
    const around = opened.structure.neighborhood(node);
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      node,
      parent: around.parent,
      siblings: [...around.siblings],
      children: [...around.children],
    };
  }

  async sourceClosure(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
      readonly workspaceRevision: number;
      readonly attachmentId: string;
      readonly attachmentRevision: number;
    },
  ): Promise<ProductNavigationSourceClosure> {
    const opened = await this.open(query);
    if (!opened || !this.#workspace) return unavailableClosure();
    const node = locate(opened, query.node);
    if (!node) {
      return {
        ...unavailableClosure(),
        basis: opened.basis,
        status: "unattached",
      };
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
      const target = exactAuthoringTarget(node);
      if (
        closure.attachment.target.elementId !== target.elementId ||
        closure.attachment.target.elementKind !== target.elementKind
      ) {
        return {
          ...unavailableClosure(),
          basis: opened.basis,
          status: "unattached",
        };
      }
      if (
        authoringBasisStatus(
          closure.attachment.declaredAgainst,
          opened.basis,
          opened.snapshot,
        ) !== "exact-basis"
      ) {
        return { ...unavailableClosure(), basis: opened.basis };
      }
      return {
        schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
        status: "observed",
        basis: opened.basis,
        workspaceRevision: named.workspaceRevision,
        workspaceEventFingerprint: named.lastEventFingerprint
          ? `${named.lastEventFingerprint.algorithm}:${named.lastEventFingerprint.digest}`
          : undefined,
        attachmentId: closure.attachment.attachmentId,
        attachmentRevision: closure.attachment.attachmentRevision,
        closureFingerprint:
          `${closure.fingerprint.algorithm}:${closure.fingerprint.digest}`,
        files: closure.files.map((file) => ({
          fileId: file.fileId,
          fileRevision: file.fileRevision,
          role: file.role,
          resourceUri: file.resourceRef.uri,
          resourceFingerprint:
            `${file.resourceRef.fingerprint.algorithm}:${file.resourceRef.fingerprint.digest}`,
        })),
        edges: closure.edges.map((edge) => ({
          from: { fileId: edge.from.fileId, fileRevision: edge.from.fileRevision },
          to: { fileId: edge.to.fileId, fileRevision: edge.to.fileRevision },
        })),
      };
    } catch {
      return { ...unavailableClosure(), basis: opened.basis };
    }
  }

  async authoringAttachments(
    query: ProductNavigationScope & {
      readonly node: ProductNavigationNodeQuery;
      readonly pageSize?: number;
      readonly cursor?: string;
    },
  ): Promise<ProductNavigationAuthoringAttachments> {
    const opened = await this.open(query);
    if (!opened) {
      return unavailableAuthoring(unresolvedNode(query.node));
    }
    const node = locate(opened, query.node);
    if (!node) {
      return unavailableAuthoring(
        unresolvedNode(query.node),
        opened.basis,
        "unattached",
      );
    }
    if (!this.#authoringAttachments) {
      return unavailableAuthoring(node, opened.basis);
    }
    const target = exactAuthoringTarget(node);
    const page = await this.#authoringAttachments.listActiveHeads({
      projectId: query.projectId,
      target,
      ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: "observed",
      basis: opened.basis,
      node,
      workspaceRevision: page.workspaceRevision,
      ...(page.workspaceEventFingerprint
        ? { workspaceEventFingerprint: page.workspaceEventFingerprint }
        : {}),
      attachments: page.attachments.map((entry) => ({
        ...entry,
        basisStatus: authoringBasisStatus(
          entry.declaredAgainst,
          opened.basis,
          opened.snapshot,
        ),
      })),
      nextCursor: page.nextCursor,
      grants: "none",
    };
  }

  private async open(scope: ProductNavigationScope) {
    const projectId = scope.projectId;
    if (projectId === "latest" || projectId !== projectId.trim()) {
      return undefined;
    }
    const project = await this.#projects.get(projectId);
    if (!project || project.project.id !== projectId) return undefined;
    const thread = scope.snapshot
      ? boundSnapshot(project, scope.snapshot)
      : await this.currentTipSnapshot(project);
    if (!thread) return undefined;
    const structure = await this.#traversal.open(thread);
    if (!structure) return undefined;
    const basis: ProductNavigationBasis = {
      projectId,
      threadSnapshotId: thread.id,
      threadRevision: thread.revision,
      architectureArtifactId: structure.architectureArtifactId,
      architectureFingerprint:
        `${structure.architectureFingerprint.algorithm}:${structure.architectureFingerprint.digest}`,
      captureSchema: "architecture-capture/4.0",
    };
    return { basis, snapshot: thread, structure };
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

  async projection(
    query: ProductNavigationScope,
  ): Promise<ProductNavigationProjection> {
    const roots = await this.roots(query);
    const root = roots.roots[0];
    if (roots.status !== "observed" || !root) {
      return {
        ...unavailableProductNavigationProjection(),
        status: roots.status,
        basis: roots.basis,
      };
    }
    const children = await this.children({ ...query, node: root });
    const context = await this.context({ ...query, node: root });
    return {
      schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
      status: roots.status,
      basis: roots.basis,
      roots: roots.roots,
      children: children.children,
      attachments: context.attachments,
    };
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

function locate(
  opened: { readonly structure: OpenedProductStructure },
  query: ProductNavigationNodeQuery,
): ProductNavigationNode | undefined {
  if (query.kind === "part-definition") {
    const root = opened.structure.root();
    if (root && query.id === root.id) return root;
    if (!opened.structure.hasDefinition(query.id)) return undefined;
    return {
      kind: "part-definition",
      id: query.id,
      label: query.id,
      definitionId: query.id,
      path: [...(query.path ?? [])],
      expandable: opened.structure.childrenOf({
        kind: "part-definition",
        id: query.id,
        path: [...(query.path ?? [])],
      }).length > 0,
    };
  }
  const path = query.path ?? [query.id];
  if (path[path.length - 1] !== query.id) return undefined;
  const nodes = opened.structure.path(path);
  return nodes?.at(-1);
}

function unresolvedNode(
  query: ProductNavigationNodeQuery,
): ProductNavigationNode {
  return {
    kind: query.kind,
    id: query.id,
    label: query.id,
    definitionId: query.kind === "part-definition" ? query.id : query.id,
    usageId: query.kind === "part-usage" ? query.id : undefined,
    path: [...(query.path ?? [])],
    expandable: false,
  };
}

function unavailableClosure(): ProductNavigationSourceClosure {
  return {
    schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
    status: "unavailable",
    files: [],
    edges: [],
  };
}

function unavailableAuthoring(
  node: ProductNavigationNode,
  basis?: ProductNavigationBasis,
  status: ProductNavigationAuthoringAttachments["status"] = "unavailable",
): ProductNavigationAuthoringAttachments {
  return {
    schemaVersion: PRODUCT_NAVIGATION_QUERY_SCHEMA,
    status,
    ...(basis ? { basis } : {}),
    node,
    attachments: [],
    nextCursor: null,
    grants: "none",
  };
}

function exactAuthoringTarget(
  node: ProductNavigationNode,
): ProjectSourceAttachmentTarget {
  if (node.kind === "part-definition") {
    return { elementId: node.id, elementKind: "PartDefinition" };
  }
  return {
    elementId: node.usageId ?? node.id,
    elementKind: "PartUsage",
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
    declared.thread.subjectId === snapshot.subject.id &&
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
