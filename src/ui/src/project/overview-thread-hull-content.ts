import type { OverviewHeroNode } from "./overview-thread-hero-model.ts";
import {
  hullOutlineRows,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowGroupPlacement,
} from "./overview-thread-d3-flow-layout.ts";
import type { ThreadViewerSession } from "../thread/viewer-sessions-client.ts";
import type { ThreadViewerHierarchyProjection } from "../../../presentation/workbench/thread/viewer-hierarchy.ts";

/** One reusable row for the hull and its contextual menu, never a Thread node. */
export interface OverviewHullContentRow {
  readonly key: string;
  readonly kind: "record" | "structure";
  readonly label: string;
  readonly detail?: string;
  readonly depth: number;
  readonly nodeKey?: string;
  readonly sessionIds: readonly string[];
}

export interface OverviewHullContent {
  readonly groupKey: string;
  readonly mode: "records" | "structure";
  /** Exact server navigation, or the recorded parent tree when none is available. */
  readonly rows: readonly OverviewHullContentRow[];
  /** All immutable records remain separately inspectable, including prior captures. */
  readonly records: readonly OverviewHullContentRow[];
}

/**
 * Organize one validated projection once, then reuse it in every presentation.
 * No App, component identity, relation, or current architecture is selected
 * from a label. The structure comes whole from the server's navigation tree;
 * exact artifact anchors only decide which hull can expose it.
 */
export function buildOverviewHullContents(
  nodes: readonly OverviewHeroNode[],
  sessions: readonly ThreadViewerSession[],
  hierarchy?: ThreadViewerHierarchyProjection,
  placements: Readonly<Record<string, OverviewThreadD3FlowGroupPlacement>> = {},
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
      return {
        key: node.id,
        kind: "structure",
        label: node.usageLabel ?? node.label,
        ...(node.usageLabel && node.usageLabel !== node.label
          ? { detail: node.label }
          : {}),
        depth,
        sessionIds: node.sessionIds.filter((id) => {
          const session = sessionsById.get(id);
          return session?.anchor.kind === "artifact" &&
            (session.anchor.id === node.geometryArtifactId ||
              node.artifactIds?.includes(session.anchor.id));
        }),
      };
    }) ?? [];
  for (const [groupKey, members] of groups) {
    const records = recordedRows(
      members,
      sessionsByRecord,
      placements[groupKey]?.sort,
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
    if (!anchored || !current) {
      result.set(groupKey, {
        groupKey,
        mode: "records",
        rows: records,
        records,
      });
      continue;
    }
    result.set(groupKey, {
      groupKey,
      mode: "structure",
      rows: architectureAnchored
        ? structureRows.map((row) => ({
          ...row,
          // The registered architecture App owns the complete captured model.
          // A child occurrence has no independent SysON App merely because a
          // geometry viewer happens to exist for that same physical part.
          sessionIds: current.rootIds.includes(row.key)
            ? sessionsByRecord.get(
              `artifact:${current.architectureArtifactId}`,
            ) ?? []
            : [],
        }))
        : structureRows,
      records,
    });
  }
  return result;
}

function recordedRows(
  members: readonly OverviewHeroNode[],
  sessionsByRecord: ReadonlyMap<string, readonly string[]>,
  sort: OverviewThreadD3FlowGroupPlacement["sort"],
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
  return ordered.map(({ node, depth }) => ({
    key: node.key,
    kind: "record",
    label: node.label,
    ...(node.recordedAt ? { detail: node.recordedAt } : {}),
    depth,
    nodeKey: node.key,
    sessionIds: sessionsByRecord.get(node.key) ?? [],
  }));
}
