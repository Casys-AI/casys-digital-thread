import type { ProjectBriefRevision } from "../../../../../domain/project/project-brief.ts";
import type {
  OverviewBriefSourceHeroNode,
  OverviewHeroEdge,
  OverviewThreadHeroView,
} from "../../overview-thread-hero-model.ts";
import { overviewBriefSourceKey } from "../../overview-thread-brief-correspondence.ts";
import type { OverviewHullContent } from "./content.ts";
import { overviewThreadD3FlowGroupIdentity } from "../../overview-thread-d3-flow-layout.ts";

export const OVERVIEW_BRIEF_HULL_KEY = overviewThreadD3FlowGroupIdentity(
  "requirements",
  "brief",
);

/** Full current approved Project intent, not a reconstructed analysis snapshot. */
export function withOverviewCurrentBrief(
  view: OverviewThreadHeroView,
  brief: ProjectBriefRevision | undefined,
): OverviewThreadHeroView {
  if (!brief) return view;
  const nodesByKey = new Map(view.nodes.map((node) => [node.key, node]));
  for (const item of brief.items) {
    const key = overviewBriefSourceKey(brief.id, item.id);
    // The same immutable snapshot+item is already present when a sealed
    // correspondence names it. Preserve its exact source and correspondence.
    if (nodesByKey.has(key)) continue;
    nodesByKey.set(key, {
      kind: "brief-source",
      key,
      lane: "requirements",
      groupKey: "brief",
      label: `${item.id} · brief r${brief.revision}`,
      color: "#7c3aed",
      emphasis: false,
      brief: {
        briefId: brief.briefId,
        snapshotId: brief.id,
        revision: brief.revision,
      },
      sourceItem: item,
      correspondences: [],
    });
  }
  const itemIds = new Set(brief.items.map((item) => item.id));
  const edges: OverviewHeroEdge[] = [];
  for (const item of brief.items) {
    for (const dependencyId of new Set(item.dependsOnItemIds ?? [])) {
      if (!itemIds.has(dependencyId) || dependencyId === item.id) continue;
      const pathKey = `brief-dependency:${
        JSON.stringify([brief.id, dependencyId, item.id])
      }`;
      edges.push({
        key: pathKey,
        fromKey: overviewBriefSourceKey(brief.id, dependencyId),
        toKey: overviewBriefSourceKey(brief.id, item.id),
        kind: "project-dependency",
        emphasis: false,
        pathCount: 1,
        pathKeys: [pathKey],
      });
    }
  }
  return {
    ...view,
    nodes: [...nodesByKey.values()],
    edges: [...view.edges, ...edges],
  };
}

/**
 * Current brief contents are complete and ordered by their authoritative
 * Project snapshot. Analysis records and older source clauses stay evidence;
 * their fingerprints never select or parent a current brief item.
 */
export function withOverviewCurrentBriefContent(
  contents: ReadonlyMap<string, OverviewHullContent>,
  view: OverviewThreadHeroView,
  brief: ProjectBriefRevision | undefined,
): ReadonlyMap<string, OverviewHullContent> {
  if (!brief) return contents;
  const sourcesByKey = new Map(
    view.nodes.flatMap((node) =>
      node.kind === "brief-source" ? [[node.key, node] as const] : []
    ),
  );
  const rootKey = `current-brief:${brief.id}`;
  const current = contents.get(OVERVIEW_BRIEF_HULL_KEY);
  const historicalSources = [...sourcesByKey.values()].filter((node) =>
    node.brief.snapshotId !== brief.id
  );
  const result = new Map(contents);
  result.set(OVERVIEW_BRIEF_HULL_KEY, {
    groupKey: OVERVIEW_BRIEF_HULL_KEY,
    mode: "tree",
    rows: [
      {
        key: rootKey,
        kind: "navigation",
        label: `Brief courant · r${brief.revision}`,
        detail: `${brief.items.length} éléments · approuvé`,
        depth: 0,
        sessionIds: [],
        endpoint: false,
      },
      ...brief.items.flatMap((item) => {
        const source = sourcesByKey.get(
          overviewBriefSourceKey(brief.id, item.id),
        );
        return source ? [sourceRow(source, 1, rootKey)] : [];
      }),
    ],
    records: [
      ...current?.records ?? [],
      ...historicalSources.map((source) => sourceRow(source, 0)),
    ],
  });
  return result;
}

function sourceRow(
  source: OverviewBriefSourceHeroNode,
  depth: number,
  parentKey?: string,
) {
  return {
    key: source.key,
    kind: "source" as const,
    label: source.sourceItem.id,
    depth,
    ...(parentKey ? { parentKey } : {}),
    nodeKey: source.key,
    sessionIds: [],
    endpoint: true,
  };
}
