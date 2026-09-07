import type {
  OverviewHeroNode,
  OverviewRecordedHeroNode,
} from "../../overview-thread-hero-model.ts";
import {
  hullOutlineRows,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowGroupPlacement,
} from "../../overview-thread-d3-flow-layout.ts";
import type { OverviewBriefSourceHeroNode } from "../../overview-thread-brief-correspondence.ts";
import type { ThreadViewerSession } from "../../../thread/viewer-sessions-client.ts";
import type { ThreadViewerHierarchyProjection } from "../../../../../presentation/workbench/thread/viewer-hierarchy.ts";
import type { ThreadAnalysisSemanticRef } from "../../../../../presentation/workbench/thread/graph.ts";
import type { OverviewViewerOpenTarget } from "../../overview-thread-viewer-discovery.ts";

const NO_VIEWER_ALIASES: ReadonlyMap<
  string,
  readonly OverviewViewerOpenTarget[]
> = new Map();

/** Navigation-only folder. Not a Thread identity or cable endpoint. */
const REQUIREMENTS_NAVIGATION_KEY = "overview-navigation:requirements";

/** One reusable row for the hull and its contextual menu, never a Thread node. */
export interface OverviewHullContentRow {
  readonly key: string;
  readonly kind: "record" | "navigation" | "source";
  readonly label: string;
  readonly detail?: string;
  readonly depth: number;
  readonly parentKey?: string;
  /** Graph node to select when this row is a real entity. Absent for grouping. */
  readonly nodeKey?: string;
  /**
   * Exact graph node that owns a registered App session. Action binding only;
   * it is not a parent, cable endpoint, or occurrence identity.
   */
  readonly viewerNodeKey?: string;
  readonly sessionIds: readonly string[];
  /** Provenance cables may land here. Navigation grouping never does. */
  readonly endpoint: boolean;
}

export interface OverviewHullContent {
  readonly groupKey: string;
  readonly mode: "records" | "tree";
  /** Exact server navigation, brief snapshot tree, or the recorded parent tree. */
  readonly rows: readonly OverviewHullContentRow[];
  /** All immutable records remain separately inspectable, including prior captures. */
  readonly records: readonly OverviewHullContentRow[];
}

export function overviewBriefSnapshotGroupKey(
  brief: OverviewBriefSourceHeroNode["brief"],
): string {
  return `brief-snapshot:${
    JSON.stringify([brief.snapshotId, brief.briefId, brief.revision])
  }`;
}

export function overviewAnalysisBasisGroupKey(
  semanticRef: Pick<
    ThreadAnalysisSemanticRef,
    "domain" | "kind" | "basisFingerprint"
  >,
): string {
  return `analysis-basis:${
    JSON.stringify([
      semanticRef.domain,
      semanticRef.kind,
      semanticRef.basisFingerprint,
    ])
  }`;
}

/**
 * Organize one validated projection once, then reuse it in every presentation.
 * No App, component identity, relation, or current architecture is selected
 * from a label. The structure comes whole from the server's navigation tree;
 * exact artifact anchors only decide which hull can expose it. Brief grouping
 * uses exact snapshot identity already present on source notes. Recorded
 * analysis-node members join that same tree, grouped only by an exact
 * semanticRef domain/kind/basisFingerprint already on the node.
 */
export function buildOverviewHullContents(
  nodes: readonly OverviewHeroNode[],
  sessions: readonly ThreadViewerSession[],
  hierarchy?: ThreadViewerHierarchyProjection,
  placements: Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>> = {},
  viewerAliases: ReadonlyMap<
    string,
    readonly OverviewViewerOpenTarget[]
  > = NO_VIEWER_ALIASES,
): ReadonlyMap<string, OverviewHullContent> {
  const groups = new Map<string, OverviewHeroNode[]>();
  const sessionsByRecord = new Map<string, string[]>();
  const sessionsById = new Map(
    sessions.map((session) => [session.id, session]),
  );
  for (const session of sessions) {
    if (session.anchor.kind === "project-review") continue;
    const key = `${session.anchor.kind}:${session.anchor.id}`;
    sessionsByRecord.set(key, [...sessionsByRecord.get(key) ?? [], session.id]);
  }
  for (const node of nodes) {
    const key = overviewThreadD3FlowGroupIdentity(node.lane, node.groupKey);
    groups.set(key, [...groups.get(key) ?? [], node]);
  }
  const result = new Map<string, OverviewHullContent>();
  const current = hierarchy?.status === "available" ? hierarchy : undefined;
  const depthById = new Map<string, number>();
  // Share the occurrence tree, not its App actions. These default actions
  // belong only to hulls anchored by the corresponding geometry evidence.
  const structureRows: readonly OverviewHullContentRow[] =
    current?.nodes.map((node) => {
      const depth = node.parentId
        ? (depthById.get(node.parentId) ?? -1) + 1
        : 0;
      depthById.set(node.id, depth);
      const sessionIds = node.sessionIds.filter((id) => {
        const session = sessionsById.get(id);
        return session?.anchor.kind === "artifact" &&
          (session.anchor.id === node.geometryArtifactId ||
            node.artifactIds?.includes(session.anchor.id));
      });
      const viewerId = sessionIds.length > 0
        ? sessionViewerArtifactId(sessionsById.get(sessionIds[0]!)!)
        : undefined;
      return {
        key: node.id,
        kind: "navigation" as const,
        label: node.usageLabel ?? node.label,
        ...(node.usageLabel && node.usageLabel !== node.label
          ? { detail: node.label }
          : {}),
        depth,
        ...(node.parentId ? { parentKey: node.parentId } : {}),
        ...(viewerId ? { viewerNodeKey: `artifact:${viewerId}` } : {}),
        sessionIds,
        endpoint: false,
      };
    }) ?? [];
  for (const [groupKey, members] of groups) {
    const recordedMembers = members.filter((member) =>
      member.kind !== "brief-source"
    );
    const records = recordedRows(
      recordedMembers,
      sessionsByRecord,
      placements[groupKey]?.sort,
      viewerAliases,
    );
    const ownArtifactIds = new Set(
      members.flatMap((member) =>
        member.kind === "recorded" && member.node.ref.kind === "artifact"
          ? [member.node.ref.id]
          : []
      ),
    );
    const architectureAnchored =
      current?.architectureArtifactId !== undefined &&
      ownArtifactIds.has(current.architectureArtifactId);
    const anchored = current && (
      architectureAnchored ||
      current.nodes.some((node) =>
        (node.geometryArtifactId !== undefined &&
          ownArtifactIds.has(node.geometryArtifactId)) ||
        node.artifactIds?.some((id) => ownArtifactIds.has(id))
      )
    );
    const requirementNav = requirementsNavigationRows(
      recordedMembers,
      sessionsByRecord,
      viewerAliases,
    );
    const captureKeys = new Set(
      recordedMembers.flatMap((member) =>
        member.kind === "recorded" && member.isRequirementsCapture === true
          ? [member.key]
          : []
      ),
    );
    if (anchored && current) {
      const architectureRows = architectureAnchored
        ? structureRows.map((
          { sessionIds: _sessionIds, viewerNodeKey: _viewer, ...row },
        ) => {
          const sessionIds = current.rootIds.includes(row.key)
            ? sessionsByRecord.get(
              `artifact:${current.architectureArtifactId}`,
            ) ?? []
            : [];
          return {
            ...row,
            // The registered architecture App owns the complete captured model.
            // A child occurrence has no independent SysON App merely because a
            // geometry viewer happens to exist for that same physical part.
            sessionIds,
            ...(sessionIds.length > 0
              ? {
                viewerNodeKey: `artifact:${current.architectureArtifactId}`,
              }
              : {}),
          };
        })
        : structureRows;
      result.set(groupKey, {
        groupKey,
        mode: "tree",
        rows: architectureAnchored
          ? [...architectureRows, ...requirementNav.rows]
          : architectureRows,
        records,
      });
      continue;
    }
    const sources = members.filter((
      member,
    ): member is OverviewBriefSourceHeroNode => member.kind === "brief-source");
    const recorded = members.filter((
      member,
    ): member is OverviewRecordedHeroNode => member.kind === "recorded");
    const analysis = analysisNavigationRows(
      recorded,
      sessionsByRecord,
      viewerAliases,
    );
    const briefRows = briefNavigationRows(sources);
    if (
      analysis.rows.length > 0 || briefRows.length > 0 ||
      requirementNav.rows.length > 0
    ) {
      const remaining = recorded
        .filter((member) =>
          !analysis.groupedKeys.has(member.key) &&
          !requirementNav.groupedKeys.has(member.key) &&
          member.isRequirementsCapture !== true
        )
        .toSorted((left, right) => left.key.localeCompare(right.key))
        .map((member) => recordRow(member, sessionsByRecord, viewerAliases, 0));
      result.set(groupKey, {
        groupKey,
        mode: "tree",
        rows: [
          ...remaining,
          ...analysis.rows,
          ...briefRows,
          ...requirementNav.rows,
        ],
        records,
      });
      continue;
    }
    result.set(groupKey, {
      groupKey,
      mode: "records",
      rows: captureKeys.size === 0
        ? records
        : records.filter((row) =>
          row.nodeKey === undefined || !captureKeys.has(row.nodeKey)
        ),
      records,
    });
  }
  return result;
}

function sessionViewerArtifactId(
  session: ThreadViewerSession,
): string | undefined {
  return session.anchor.kind === "artifact" ? session.anchor.id : undefined;
}

function recordedRows(
  members: readonly OverviewHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  sort: OverviewThreadD3FlowGroupPlacement["sort"],
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): readonly OverviewHullContentRow[] {
  const outline = hullOutlineRows(
    members.map((member) => ({
      ...member,
      ...(member.kind === "recorded" && member.node.recordedAt
        ? { recordedAt: member.node.recordedAt }
        : {}),
    })),
    sort,
    true,
  );
  const ordered = outline.promoted
    ? [
      { node: outline.promoted, depth: 0 },
      ...outline.rows.map((row) => ({ ...row, depth: row.depth + 1 })),
    ]
    : outline.rows;
  return ordered.map(({ node, depth }) => {
    const parentKey = "parentKey" in node ? node.parentKey : undefined;
    const viewer = boundRowViewer(node.key, sessionsByRecord, viewerAliases);
    return {
      key: node.key,
      kind: "record" as const,
      label: node.label,
      ...(node.recordedAt ? { detail: node.recordedAt } : {}),
      depth,
      ...(parentKey ? { parentKey } : {}),
      nodeKey: node.key,
      ...(viewer.viewerNodeKey ? { viewerNodeKey: viewer.viewerNodeKey } : {}),
      sessionIds: viewer.sessionIds,
      endpoint: true,
    };
  });
}

function requirementsNavigationRows(
  members: readonly OverviewHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): {
  readonly rows: readonly OverviewHullContentRow[];
  readonly groupedKeys: ReadonlySet<string>;
} {
  const unique = new Map<string, OverviewRecordedHeroNode>();
  for (const member of members) {
    if (member.kind !== "recorded") continue;
    if (member.node.entityKind !== "requirement") continue;
    unique.set(member.key, member);
  }
  if (unique.size === 0) {
    return { rows: [], groupedKeys: new Set() };
  }
  const rows: OverviewHullContentRow[] = [{
    key: REQUIREMENTS_NAVIGATION_KEY,
    kind: "navigation",
    label: "Requirements",
    depth: 0,
    sessionIds: [],
    endpoint: false,
  }];
  const groupedKeys = new Set<string>();
  const ordered = [...unique.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  for (const member of ordered) {
    groupedKeys.add(member.key);
    rows.push(
      recordRow(
        member,
        sessionsByRecord,
        viewerAliases,
        1,
        REQUIREMENTS_NAVIGATION_KEY,
      ),
    );
  }
  return { rows, groupedKeys };
}

function analysisNavigationRows(
  members: readonly OverviewRecordedHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): {
  readonly rows: readonly OverviewHullContentRow[];
  readonly groupedKeys: ReadonlySet<string>;
} {
  const unique = new Map<string, OverviewRecordedHeroNode>();
  for (const member of members) unique.set(member.key, member);
  const ordered = [...unique.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  const byBasis = new Map<string, OverviewRecordedHeroNode[]>();
  for (const member of ordered) {
    const basis = exactAnalysisBasis(member);
    if (!basis) continue;
    const key = overviewAnalysisBasisGroupKey(basis);
    byBasis.set(key, [...byBasis.get(key) ?? [], member]);
  }
  const rows: OverviewHullContentRow[] = [];
  const groupedKeys = new Set<string>();
  const groups = [...byBasis.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [parentKey, groupMembers] of groups) {
    const basis = exactAnalysisBasis(groupMembers[0]!)!;
    rows.push({
      key: parentKey,
      kind: "navigation",
      label: analysisBasisGroupLabel(basis.domain),
      detail: basis.basisFingerprint,
      depth: 0,
      sessionIds: [],
      endpoint: false,
    });
    for (const member of groupMembers) {
      groupedKeys.add(member.key);
      rows.push(
        recordRow(member, sessionsByRecord, viewerAliases, 1, parentKey),
      );
    }
  }
  return { rows, groupedKeys };
}

function recordRow(
  member: OverviewRecordedHeroNode,
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
  depth: number,
  parentKey?: string,
): OverviewHullContentRow {
  const viewer = boundRowViewer(member.key, sessionsByRecord, viewerAliases);
  return {
    key: member.key,
    kind: "record",
    label: member.label,
    ...(member.node.recordedAt ? { detail: member.node.recordedAt } : {}),
    depth,
    ...(parentKey ? { parentKey } : {}),
    nodeKey: member.key,
    ...(viewer.viewerNodeKey ? { viewerNodeKey: viewer.viewerNodeKey } : {}),
    sessionIds: viewer.sessionIds,
    endpoint: true,
  };
}

function boundRowViewer(
  nodeKey: string,
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  viewerAliases: ReadonlyMap<string, readonly OverviewViewerOpenTarget[]>,
): {
  readonly sessionIds: readonly string[];
  readonly viewerNodeKey?: string;
} {
  const direct = sessionsByRecord.get(nodeKey) ?? [];
  if (direct.length > 0) {
    return { sessionIds: direct, viewerNodeKey: nodeKey };
  }
  const aliased = viewerAliases.get(nodeKey);
  if (aliased !== undefined && aliased.length > 0) {
    return {
      sessionIds: aliased.map((item) => item.sessionId),
      viewerNodeKey: aliased[0]!.nodeKey,
    };
  }
  return { sessionIds: [] };
}

function exactAnalysisBasis(
  member: OverviewRecordedHeroNode,
): {
  readonly domain: ThreadAnalysisSemanticRef["domain"];
  readonly kind: string;
  readonly basisFingerprint: string;
} | undefined {
  if (member.node.ref.kind !== "analysis-node") return undefined;
  const semanticRef = member.node.analysis?.semanticRef;
  if (
    semanticRef === undefined ||
    semanticRef.domain.trim() === "" ||
    semanticRef.kind.trim() === "" ||
    typeof semanticRef.basisFingerprint !== "string" ||
    semanticRef.basisFingerprint.trim() === ""
  ) {
    return undefined;
  }
  return {
    domain: semanticRef.domain,
    kind: semanticRef.kind,
    basisFingerprint: semanticRef.basisFingerprint,
  };
}

function analysisBasisGroupLabel(
  domain: ThreadAnalysisSemanticRef["domain"],
): string {
  if (domain === "brief") return "Brief analysis";
  if (domain === "sysml") return "SysML analysis";
  if (domain === "cad") return "CAD analysis";
  return `${domain} analysis`;
}

function briefNavigationRows(
  sources: readonly OverviewBriefSourceHeroNode[],
): readonly OverviewHullContentRow[] {
  const unique = new Map<string, OverviewBriefSourceHeroNode>();
  for (const source of sources) unique.set(source.key, source);
  const ordered = [...unique.values()].sort((left, right) =>
    left.key.localeCompare(right.key)
  );
  const bySnapshot = new Map<string, OverviewBriefSourceHeroNode[]>();
  const ungrouped: OverviewBriefSourceHeroNode[] = [];
  for (const source of ordered) {
    const identity = exactBriefIdentity(source.brief);
    if (!identity) {
      ungrouped.push(source);
      continue;
    }
    const bucket = bySnapshot.get(identity.snapshotId) ?? [];
    bucket.push(source);
    bySnapshot.set(identity.snapshotId, bucket);
  }
  const rows: OverviewHullContentRow[] = [];
  const groups = [...bySnapshot.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [, members] of groups) {
    const identities = new Set(
      members.map((member) => JSON.stringify(exactBriefIdentity(member.brief))),
    );
    if (identities.size !== 1 || identities.has("null")) {
      ungrouped.push(...members);
      continue;
    }
    const brief = exactBriefIdentity(members[0]!.brief)!;
    const parentKey = overviewBriefSnapshotGroupKey(brief);
    rows.push({
      key: parentKey,
      kind: "navigation",
      label: `Clauses sources · brief r${brief.revision}`,
      detail: brief.snapshotId,
      depth: 0,
      sessionIds: [],
      endpoint: false,
    });
    for (const source of members) {
      rows.push(briefSourceRow(source, parentKey, 1));
    }
  }
  ungrouped.sort((left, right) => left.key.localeCompare(right.key));
  for (const source of ungrouped) {
    rows.push(briefSourceRow(source, undefined, 0));
  }
  return rows;
}

function briefSourceRow(
  source: OverviewBriefSourceHeroNode,
  parentKey: string | undefined,
  depth: number,
): OverviewHullContentRow {
  return {
    key: source.key,
    kind: "source",
    label: source.sourceItem.id,
    detail: source.sourceItem.kind,
    depth,
    ...(parentKey ? { parentKey } : {}),
    nodeKey: source.key,
    sessionIds: [],
    endpoint: true,
  };
}

function exactBriefIdentity(
  brief: OverviewBriefSourceHeroNode["brief"],
): OverviewBriefSourceHeroNode["brief"] | undefined {
  if (
    typeof brief.snapshotId !== "string" ||
    brief.snapshotId.trim() === "" ||
    typeof brief.briefId !== "string" ||
    brief.briefId.trim() === "" ||
    !Number.isInteger(brief.revision)
  ) {
    return undefined;
  }
  return brief;
}
