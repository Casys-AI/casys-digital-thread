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
import type {
  ThreadViewerHierarchyNode,
  ThreadViewerHierarchyProjection,
} from "../../../../../presentation/workbench/thread/viewer-hierarchy.ts";
import type { ThreadAnalysisSemanticRef } from "../../../../../presentation/workbench/thread/graph.ts";
import type { OverviewViewerOpenTarget } from "../../overview-thread-viewer-discovery.ts";
import {
  type OverviewHullContent,
  type OverviewHullContentRow,
  overviewHullFolderRow,
} from "./types.ts";
import { overviewHullBoundRowViewer } from "./row-viewer.ts";

export type { OverviewHullContent, OverviewHullContentRow } from "./types.ts";

/**
 * Hulls whose known graph artifacts can later receive the viewer occurrence
 * tree. Fail-closed: architecture and geometry artifacts only. Never invents
 * occurrence identity or a final hierarchy count.
 */
export function overviewHullCanHostViewerHierarchy(
  members: readonly OverviewHeroNode[],
): boolean {
  return members.some((member) =>
    member.kind === "recorded" &&
    member.node.ref.kind === "artifact" &&
    (member.lane === "system-model" || member.lane === "geometry")
  );
}

/**
 * Structured row counts for hulls whose graph artifacts can host the viewer
 * occurrence tree. While the request is in flight those counts size pending
 * rows; after a terminal available or unavailable result they size the shared
 * structured hull path. The count is the known graph outline or exact tree,
 * never an invented occurrence identity.
 */
export function overviewHullHierarchyPendingPlaceholders(
  nodes: readonly OverviewHeroNode[],
  contents: ReadonlyMap<string, OverviewHullContent>,
): ReadonlyMap<string, number> {
  const membersByGroup = new Map<string, OverviewHeroNode[]>();
  for (const node of nodes) {
    const key = overviewThreadD3FlowGroupIdentity(node.lane, node.groupKey);
    const members = membersByGroup.get(key);
    if (members) members.push(node);
    else membersByGroup.set(key, [node]);
  }
  const result = new Map<string, number>();
  for (const [groupKey, members] of membersByGroup) {
    if (!overviewHullCanHostViewerHierarchy(members)) continue;
    const count = contents.get(groupKey)?.rows.length ?? 0;
    if (count > 0) result.set(groupKey, count);
  }
  return result;
}

/**
 * Hierarchy sizes every non-empty hull from its rows, in tree, list, and
 * points. Pending placeholders overlay the same counts; they never invent a
 * second dataset.
 */
export function overviewHullStructureRowCounts(
  contents: ReadonlyMap<string, OverviewHullContent>,
  pendingPlaceholders: ReadonlyMap<string, number> = new Map(),
): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [key, content] of contents) {
    if (content.rows.length > 0) counts[key] = content.rows.length;
  }
  for (const [key, count] of pendingPlaceholders) {
    counts[key] = count;
  }
  return counts;
}

const NO_VIEWER_ALIASES: ReadonlyMap<
  string,
  readonly OverviewViewerOpenTarget[]
> = new Map();

/** Navigation-only folder. Not a Thread identity or cable endpoint. */
const REQUIREMENTS_NAVIGATION_KEY = "overview-navigation:requirements";

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
 * from a label. The structure comes whole from the server's navigation tree.
 * Architecture artifacts still select the SysML hull. Geometry may expose the
 * same tree while CAD joins are absent; exact geometry identities only decide
 * overlay graphRefs and viewer actions, never whether the tree is visible.
 * Brief grouping uses exact snapshot identity already present on source notes.
 * Recorded analysis-node members join that same tree, grouped only by an exact
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
  // Share the occurrence tree, not its App actions. Viewer actions still
  // require exact geometry evidence on the occurrence; Geometry may host the
  // tree while those joins are empty.
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
        graphRefs: [],
        role: "folder" as const,
        selectable: false,
        focusable: true,
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
    const cadJoined = current !== undefined &&
      current.nodes.some((node) =>
        (node.geometryArtifactId !== undefined &&
          ownArtifactIds.has(node.geometryArtifactId)) ||
        node.artifactIds?.some((id) => ownArtifactIds.has(id))
      );
    const geometryHost = hullHostsGeometryArtifacts(members);
    const geometryStructureAnchored = geometryHost &&
      current !== undefined &&
      current.nodes.length > 0;
    const anchored = current && (
      architectureAnchored || cadJoined || geometryStructureAnchored
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
      const namedCount = occurrenceArtifactNameCount(
        current.nodes,
        ownArtifactIds,
      );
      const uniqueArchitectureRoot = architectureAnchored &&
        current.architectureArtifactId !== undefined &&
        current.rootIds.length === 1 &&
        ownArtifactIds.has(current.architectureArtifactId);
      const identified = structureRows.map((row) => {
        const occurrence = current.nodes.find((node) => node.id === row.key);
        return withOccurrenceGraphIdentity(row, occurrence, {
          architectureAnchored,
          architectureArtifactId: current.architectureArtifactId,
          uniqueArchitectureRoot,
          rootIds: current.rootIds,
          ownArtifactIds,
          namedCount,
        });
      });
      const architectureRows = architectureAnchored
        ? identified.map((
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
        : geometryHost
        ? identified.map(withUnjoinedGeometryOccurrence)
        : identified;
      result.set(
        groupKey,
        withHullOverlayStatus({
          groupKey,
          mode: "tree",
          rows: architectureAnchored
            ? [...architectureRows, ...requirementNav.rows]
            : architectureRows,
          records,
        }, members),
      );
      continue;
    }
    const recorded = members.filter((
      member,
    ): member is OverviewRecordedHeroNode => member.kind === "recorded");
    const analysis = analysisNavigationRows(
      recorded,
      sessionsByRecord,
      viewerAliases,
    );
    if (analysis.rows.length > 0 || requirementNav.rows.length > 0) {
      const remaining = recorded
        .filter((member) =>
          !analysis.groupedKeys.has(member.key) &&
          !requirementNav.groupedKeys.has(member.key) &&
          member.isRequirementsCapture !== true
        )
        .toSorted((left, right) => left.key.localeCompare(right.key))
        .map((member) => recordRow(member, sessionsByRecord, viewerAliases, 0));
      result.set(
        groupKey,
        withHullOverlayStatus({
          groupKey,
          mode: "tree",
          rows: [
            ...remaining,
            ...analysis.rows,
            ...requirementNav.rows,
          ],
          records,
        }, members),
      );
      continue;
    }
    result.set(
      groupKey,
      withHullOverlayStatus({
        groupKey,
        mode: "records",
        rows: captureKeys.size === 0
          ? records
          : records.filter((row) =>
            row.nodeKey === undefined || !captureKeys.has(row.nodeKey)
          ),
        records,
      }, members),
    );
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
    const viewer = overviewHullBoundRowViewer(
      node.key,
      sessionsByRecord,
      viewerAliases,
    );
    return graphBackedRow({
      key: node.key,
      kind: "record",
      label: node.label,
      ...(node.recordedAt ? { detail: node.recordedAt } : {}),
      depth,
      ...(parentKey ? { parentKey } : {}),
      nodeKey: node.key,
      ...(viewer.viewerNodeKey ? { viewerNodeKey: viewer.viewerNodeKey } : {}),
      sessionIds: viewer.sessionIds,
      endpoint: true,
      ...(node.recordedAt
        ? { provenance: { recordedAt: node.recordedAt } }
        : {}),
    });
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
  const rows: OverviewHullContentRow[] = [overviewHullFolderRow({
    key: REQUIREMENTS_NAVIGATION_KEY,
    label: "Requirements",
    depth: 0,
  })];
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
    rows.push(overviewHullFolderRow({
      key: parentKey,
      label: analysisBasisGroupLabel(basis.domain),
      detail: basis.basisFingerprint,
      depth: 0,
    }));
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
  const viewer = overviewHullBoundRowViewer(
    member.key,
    sessionsByRecord,
    viewerAliases,
  );
  return graphBackedRow({
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
    ...(member.node.recordedAt
      ? { provenance: { recordedAt: member.node.recordedAt } }
      : {}),
  });
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

function withHullOverlayStatus(
  content: OverviewHullContent,
  members: readonly OverviewHeroNode[],
): OverviewHullContent {
  const status = uniqueHullOverlayStatus(members);
  return status ? { ...content, status } : content;
}

function uniqueHullOverlayStatus(
  members: readonly OverviewHeroNode[],
): "active" | "blocked" | undefined {
  const statuses = new Set<"active" | "blocked">();
  for (const member of members) {
    if (member.kind === "recorded" && member.activityStatus) {
      statuses.add(member.activityStatus);
    }
  }
  return statuses.size === 1 ? [...statuses][0] : undefined;
}

function graphBackedRow(
  row: OverviewHullContentRow & { readonly nodeKey: string },
): OverviewHullContentRow {
  return {
    ...row,
    graphRefs: row.graphRefs ?? [row.nodeKey],
    selectable: row.selectable ?? true,
    focusable: row.focusable ?? true,
  };
}

function occurrenceNamedArtifactIds(
  node: ThreadViewerHierarchyNode,
): readonly string[] {
  return [
    ...new Set([
      ...node.artifactIds ?? [],
      ...node.geometryArtifactId ? [node.geometryArtifactId] : [],
    ]),
  ];
}

function occurrenceArtifactNameCount(
  nodes: readonly ThreadViewerHierarchyNode[],
  ownArtifactIds: ReadonlySet<string>,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const id of occurrenceNamedArtifactIds(node)) {
      if (!ownArtifactIds.has(id)) continue;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

function withOccurrenceGraphIdentity(
  row: OverviewHullContentRow,
  occurrence: ThreadViewerHierarchyNode | undefined,
  spec: {
    readonly architectureAnchored: boolean;
    readonly architectureArtifactId: string | undefined;
    readonly uniqueArchitectureRoot: boolean;
    readonly rootIds: readonly string[];
    readonly ownArtifactIds: ReadonlySet<string>;
    readonly namedCount: ReadonlyMap<string, number>;
  },
): OverviewHullContentRow {
  const graphRefs = occurrenceGraphRefs(row.key, occurrence, spec);
  const overlay = graphRefs.length > 0;
  return {
    ...row,
    graphRefs,
    role: overlay ? "overlay" : "folder",
    selectable: overlay,
    focusable: true,
  };
}

function hullHostsGeometryArtifacts(
  members: readonly OverviewHeroNode[],
): boolean {
  return members.some((member) =>
    member.kind === "recorded" &&
    member.node.ref.kind === "artifact" &&
    member.lane === "geometry"
  );
}

function withUnjoinedGeometryOccurrence(
  row: OverviewHullContentRow,
): OverviewHullContentRow {
  if ((row.graphRefs ?? []).length > 0) return row;
  const { viewerNodeKey: _viewer, ...rest } = row;
  return {
    ...rest,
    detail: "unjoined · pending CAD",
    availability: "unresolved",
    graphRefs: [],
    sessionIds: [],
    endpoint: false,
    role: "folder",
    selectable: false,
    focusable: true,
  };
}

function occurrenceGraphRefs(
  rowKey: string,
  occurrence: ThreadViewerHierarchyNode | undefined,
  spec: {
    readonly architectureAnchored: boolean;
    readonly architectureArtifactId: string | undefined;
    readonly uniqueArchitectureRoot: boolean;
    readonly rootIds: readonly string[];
    readonly ownArtifactIds: ReadonlySet<string>;
    readonly namedCount: ReadonlyMap<string, number>;
  },
): readonly string[] {
  if (!occurrence) return [];
  if (spec.architectureAnchored) {
    if (
      spec.uniqueArchitectureRoot &&
      spec.rootIds[0] === rowKey &&
      spec.architectureArtifactId &&
      spec.ownArtifactIds.has(spec.architectureArtifactId)
    ) {
      return [`artifact:${spec.architectureArtifactId}`];
    }
    return [];
  }
  return occurrenceNamedArtifactIds(occurrence)
    .filter((id) =>
      spec.ownArtifactIds.has(id) && spec.namedCount.get(id) === 1
    )
    .map((id) => `artifact:${id}`);
}
