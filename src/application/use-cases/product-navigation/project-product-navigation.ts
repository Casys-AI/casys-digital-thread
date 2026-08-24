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
import { requireActiveTechnicalSourceFile } from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import { PROJECT_SOURCE_WORKSPACE_BOUNDS } from "../../../domain/project-source-workspace/types.ts";
import type {
  ProjectSourceFileRevision,
  ProjectSourceWorkspaceState,
} from "../../../domain/project-source-workspace/types.ts";
import { contentRevisionAt } from "../../../domain/project-source-workspace/transitions.ts";
import type { ProductNavigationAttachmentReader } from "../../ports/out/product-navigation/product-navigation-attachment-reader.ts";
import {
  attachmentsForDefinition,
  emptyAttachments,
  PRODUCT_NAVIGATION_QUERY_SCHEMA,
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
  readonly attachments?: ProductNavigationAttachmentReader;
}

export class ProjectProductNavigation implements ProductNavigationUseCase {
  readonly #projects: ProjectProductNavigationDependencies["projects"];
  readonly #snapshots: ProjectProductNavigationDependencies["snapshots"];
  readonly #traversal: ProductStructureTraversal;
  readonly #workspace: ProjectProductNavigationDependencies["workspace"];
  readonly #attachments: ProjectProductNavigationDependencies["attachments"];

  constructor(dependencies: ProjectProductNavigationDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#traversal = dependencies.traversal;
    this.#workspace = dependencies.workspace;
    this.#attachments = dependencies.attachments;
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
    const facts = this.#attachments
      ? await this.#attachments.read(opened.snapshot, {
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
      readonly fileId: string;
      readonly fileRevision: number;
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
    const facts = this.#attachments
      ? await this.#attachments.read(opened.snapshot, {
        projectId: query.projectId,
      })
      : undefined;
    const attached = facts
      ? attachmentsForDefinition(
        facts,
        node.definitionId,
        facts.sourceFileIds,
      ).sources.some((item) => item.id === `${query.fileId}@${query.fileRevision}`)
      : false;
    if (!attached) {
      return {
        ...unavailableClosure(),
        basis: opened.basis,
        status: "unattached",
      };
    }
    const record = facts?.sourceFiles?.find((file) =>
      file.fileId === query.fileId && file.fileRevision === query.fileRevision
    );
    if (!record) {
      return {
        ...unavailableClosure(),
        basis: opened.basis,
        status: "unattached",
      };
    }
    try {
      const named = await this.#workspace.loadAtFresh(
        query.projectId,
        record.workspaceRevision,
      );
      const walked = walkSourceClosure(named, query.fileId, query.fileRevision);
      if (!walked) {
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
        files: walked.files,
        edges: walked.edges,
      };
    } catch {
      return { ...unavailableClosure(), basis: opened.basis };
    }
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

function walkSourceClosure(
  state: ProjectSourceWorkspaceState,
  fileId: string,
  fileRevision: number,
): {
  files: ProductNavigationSourceClosure["files"];
  edges: ProductNavigationSourceClosure["edges"];
} | undefined {
  const files: ProductNavigationSourceClosure["files"] = [];
  const edges: ProductNavigationSourceClosure["edges"] = [];
  const seen = new Set<string>();
  const queue: { fileId: string; fileRevision: number }[] = [{
    fileId,
    fileRevision,
  }];
  let bound = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.fileId}@${current.fileRevision}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bound += 1;
    if (bound > PROJECT_SOURCE_WORKSPACE_BOUNDS.maxPageSize) return undefined;
    const root = bound === 1 &&
      current.fileId === fileId &&
      current.fileRevision === fileRevision;
    let record: ProjectSourceFileRevision;
    try {
      record = root
        ? requireActiveTechnicalSourceFile(
          state,
          current.fileId,
          current.fileRevision,
        )
        : namedContentRevision(state, current.fileId, current.fileRevision);
    } catch {
      return undefined;
    }
    if (
      record.dependencies.length >
        PROJECT_SOURCE_WORKSPACE_BOUNDS.maxDependencyFanout
    ) {
      return undefined;
    }
    files.push({
      fileId: record.fileId,
      fileRevision: record.fileRevision,
      role: record.role,
      resourceUri: record.resourceRef.uri,
      resourceFingerprint:
        `${record.resourceRef.fingerprint.algorithm}:${record.resourceRef.fingerprint.digest}`,
    });
    for (const dependency of record.dependencies) {
      edges.push({
        from: { fileId: record.fileId, fileRevision: record.fileRevision },
        to: {
          fileId: dependency.fileId,
          fileRevision: dependency.fileRevision,
        },
      });
      queue.push(dependency);
    }
  }
  return { files, edges };
}

function namedContentRevision(
  state: ProjectSourceWorkspaceState,
  fileId: string,
  fileRevision: number,
): ProjectSourceFileRevision {
  const record = contentRevisionAt(state, fileId, fileRevision);
  if (record.kind !== "content") {
    throw new Error(
      `File ${fileId}@${fileRevision} is not a content revision at workspace ${state.workspaceRevision}.`,
    );
  }
  return record;
}
