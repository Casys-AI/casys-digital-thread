import type { ThreadGraphRef } from "../thread/types.ts";
import type { ThreadViewerSession } from "../thread/viewer-sessions-client.ts";

/** Presentation metadata only; it never creates a viewer capability. */
export interface OverviewViewerHierarchy {
  readonly status: "available" | "unavailable";
  readonly rootIds: readonly string[];
  readonly nodes: readonly {
    readonly id: string;
    readonly parentId?: string;
    readonly sessionIds: readonly string[];
  }[];
}

/** Recorded graph identity used to resolve a unique requirements source. */
export interface OverviewViewerAliasRecord {
  readonly key: string;
  readonly groupKey: string;
  readonly ref: Pick<ThreadGraphRef, "kind" | "id">;
  /** Exact capture predicate; never inferred from group, label, or provider. */
  readonly isRequirementsCapture?: boolean;
}

/** Exact Thread edge fields used for requirement → capture aliases. */
export interface OverviewViewerAliasEdge {
  readonly from: Pick<ThreadGraphRef, "kind" | "id">;
  readonly to: Pick<ThreadGraphRef, "kind" | "id">;
  readonly relation: string;
}

/**
 * Existing registered session to open, already pointed at the session's
 * recorded anchor. It is not a fabricated capability on the clicked node.
 */
export interface OverviewViewerOpenTarget {
  readonly sessionId: string;
  readonly nodeKey: string;
}

/** Open the unique current hierarchy root session, otherwise nothing. */
export function overviewDefaultViewerSessions(
  sessions: readonly ThreadViewerSession[],
  hierarchy?: OverviewViewerHierarchy,
): readonly ThreadViewerSession[] {
  if (hierarchy === undefined || hierarchy.status !== "available") {
    return [];
  }
  const rootId = hierarchy.rootIds[0];
  if (hierarchy.rootIds.length !== 1 || rootId === undefined) {
    return [];
  }
  const root = hierarchy.nodes.find((node) => node.id === rootId);
  const sessionId = root?.sessionIds[0];
  if (
    root === undefined || root.sessionIds.length !== 1 ||
    sessionId === undefined
  ) {
    return [];
  }
  const session = sessions.find((item) => item.id === sessionId);
  return session === undefined || session.anchor.kind === "project-review"
    ? []
    : [session];
}

/** Stable graph key of a registered session's actual recorded anchor. */
export function overviewCanonicalViewerNodeKey(
  session: ThreadViewerSession,
): string | undefined {
  if (session.anchor.kind === "project-review") return undefined;
  return graphRefKey(session.anchor);
}

/**
 * Unique requirements-capture traces_to aliases only.
 * Direct registered sessions stay on their recorded anchors; a requirement
 * never receives a fabricated or reanchored session.
 */
export function overviewRequirementSourceViewerAliases(
  records: readonly OverviewViewerAliasRecord[],
  edges: readonly OverviewViewerAliasEdge[],
  sessions: readonly ThreadViewerSession[],
): ReadonlyMap<string, readonly OverviewViewerOpenTarget[]> {
  const recordsByKey = new Map(records.map((record) => [record.key, record]));
  const sessionsByAnchor = new Map<string, string[]>();
  for (const session of sessions) {
    const nodeKey = overviewCanonicalViewerNodeKey(session);
    if (!nodeKey) continue;
    sessionsByAnchor.set(nodeKey, [
      ...sessionsByAnchor.get(nodeKey) ?? [],
      session.id,
    ]);
  }
  const aliases = new Map<string, readonly OverviewViewerOpenTarget[]>();
  for (const record of records) {
    if (record.ref.kind !== "requirement") continue;
    const sources = uniqueRequirementsCaptureSources(
      record,
      edges,
      recordsByKey,
    );
    if (sources.length !== 1) continue;
    const sourceKey = sources[0]!;
    const sessionIds = sessionsByAnchor.get(sourceKey) ?? [];
    if (sessionIds.length === 0) continue;
    aliases.set(
      record.key,
      sessionIds.map((sessionId) => ({ sessionId, nodeKey: sourceKey })),
    );
  }
  return aliases;
}

function uniqueRequirementsCaptureSources(
  requirement: OverviewViewerAliasRecord,
  edges: readonly OverviewViewerAliasEdge[],
  recordsByKey: ReadonlyMap<string, OverviewViewerAliasRecord>,
): readonly string[] {
  const sources = new Set<string>();
  for (const edge of edges) {
    if (
      edge.relation !== "traces_to" ||
      edge.from.kind !== "artifact" ||
      edge.to.kind !== "requirement" ||
      edge.to.id !== requirement.ref.id
    ) {
      continue;
    }
    const source = recordsByKey.get(graphRefKey(edge.from));
    if (
      source === undefined ||
      source.ref.kind !== "artifact" ||
      source.isRequirementsCapture !== true
    ) {
      continue;
    }
    sources.add(source.key);
  }
  return [...sources];
}

function graphRefKey(reference: Pick<ThreadGraphRef, "kind" | "id">): string {
  return `${reference.kind}:${reference.id}`;
}
