import type { ProjectBriefRevision } from "../../../../../domain/project/project-brief.ts";
import type {
  OverviewBriefSourceHeroNode,
  OverviewHeroNode,
  OverviewThreadHeroView,
} from "../../overview-thread-hero-model.ts";
import { overviewBriefSourceKey } from "../../overview-thread-brief-correspondence.ts";
import { overviewBriefSnapshotGroupKey } from "./content.ts";
import {
  type OverviewHullContent,
  type OverviewHullContentRow,
  overviewHullFolderRow,
} from "./types.ts";
import type { OverviewHullAdapter } from "./adapters/types.ts";
import { overviewThreadD3FlowGroupIdentity } from "../../overview-thread-d3-flow-layout.ts";

export const OVERVIEW_BRIEF_HULL_KEY = overviewThreadD3FlowGroupIdentity(
  "requirements",
  "brief",
);

export const OVERVIEW_CURRENT_BRIEF_ADAPTER_ID = "current-brief";

/** Current approved Project intent. Exact correspondences stay on the graph. */
export function withOverviewCurrentBrief(
  view: OverviewThreadHeroView,
  brief: ProjectBriefRevision | undefined,
): OverviewThreadHeroView {
  if (!brief) return view;
  return view;
}

/**
 * Visible Brief hull is the current snapshot tree plus a sibling branch of
 * graph-backed referenced sources. Those sources keep their original
 * snapshot identity; they never retarget onto a later item id. Historical
 * exact snapshots remain here when no current Brief is approved.
 */
export function withOverviewCurrentBriefContent(
  contents: ReadonlyMap<string, OverviewHullContent>,
  nodes: readonly OverviewHeroNode[],
  brief: ProjectBriefRevision | undefined,
): ReadonlyMap<string, OverviewHullContent> {
  const sources = nodes.filter((
    node,
  ): node is OverviewBriefSourceHeroNode => node.kind === "brief-source");
  if (!brief && sources.length === 0) return contents;
  const current = contents.get(OVERVIEW_BRIEF_HULL_KEY);
  const sourceKeys = new Set(sources.map((source) => source.key));
  const seenRecords = new Set(current?.records.map((row) => row.key) ?? []);
  const referenced = overviewBriefReferencedSourceRows(brief, sources);
  const referencedKeys = new Set(referenced.map((row) => row.key));
  const kept = brief
    ? overviewBriefHierarchyRows(brief, sourceKeys)
    : (current?.rows ?? []).filter((row) => !referencedKeys.has(row.key));
  const result = new Map(contents);
  result.set(OVERVIEW_BRIEF_HULL_KEY, {
    groupKey: OVERVIEW_BRIEF_HULL_KEY,
    mode: "tree",
    rows: [...kept, ...referenced],
    records: [
      ...current?.records ?? [],
      ...sources.flatMap((source) =>
        seenRecords.has(source.key) ? [] : [sourceRecord(source)]
      ),
    ],
    ...(current?.status ? { status: current.status } : {}),
    ...(current?.counts ? { counts: current.counts } : {}),
  });
  return result;
}

export const currentBriefAdapter: OverviewHullAdapter = {
  id: OVERVIEW_CURRENT_BRIEF_ADAPTER_ID,
  apply(contents, context) {
    return withOverviewCurrentBriefContent(
      contents,
      context.nodes,
      context.currentBrief,
    );
  },
};

export function overviewBriefRootRowKey(briefSnapshotId: string): string {
  return `current-brief:${briefSnapshotId}`;
}

export function overviewBriefSectionRowKey(
  briefSnapshotId: string,
  kind: string,
): string {
  return `brief-section:${JSON.stringify([briefSnapshotId, kind])}`;
}

export function overviewBriefItemRowKey(
  briefSnapshotId: string,
  itemId: string,
): string {
  return `brief-item:${JSON.stringify([briefSnapshotId, itemId])}`;
}

export function overviewBriefRootLabel(brief: ProjectBriefRevision): string {
  return `Brief courant · ${brief.briefId}`;
}

export function overviewBriefReferencedSnapshotLabel(): string {
  return "Sources référencées";
}

export function overviewBriefSectionLabel(kind: string): string {
  return kind.split("-").filter((part) => part.length > 0).map((part) =>
    `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
  ).join(" ");
}

export function overviewBriefHierarchyRows(
  brief: ProjectBriefRevision,
  sourceKeys: ReadonlySet<string> = new Set(),
): readonly OverviewHullContentRow[] {
  const rootKey = overviewBriefRootRowKey(brief.id);
  const itemCount = brief.items.length;
  const itemsByKind = new Map<string, ProjectBriefRevision["items"]>();
  for (const item of brief.items) {
    itemsByKind.set(item.kind, [...itemsByKind.get(item.kind) ?? [], item]);
  }
  const rows: OverviewHullContentRow[] = [overviewHullFolderRow({
    key: rootKey,
    label: overviewBriefRootLabel(brief),
    detail: itemCount === 1
      ? "1 élément · approuvé"
      : `${itemCount} éléments · approuvé`,
    depth: 0,
    nativeAction: "open-current-brief",
  })];
  const kinds = [...itemsByKind.keys()];
  const sections = overviewBriefSectionRows(brief, rootKey);
  for (const [index, section] of sections.entries()) {
    rows.push(section);
    for (const item of itemsByKind.get(kinds[index]!) ?? []) {
      rows.push(overviewBriefItemRow(brief, item, section.key, sourceKeys));
    }
  }
  return rows;
}

export function overviewBriefSectionRows(
  brief: ProjectBriefRevision,
  parentKey?: string,
): readonly OverviewHullContentRow[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const item of brief.items) {
    const previous = counts.get(item.kind) ?? 0;
    if (previous === 0) order.push(item.kind);
    counts.set(item.kind, previous + 1);
  }
  return order.map((kind) => {
    const count = counts.get(kind) ?? 0;
    return overviewHullFolderRow({
      key: overviewBriefSectionRowKey(brief.id, kind),
      label: overviewBriefSectionLabel(kind),
      detail: count === 1 ? "1 élément" : `${count} éléments`,
      depth: parentKey === undefined ? 0 : 1,
      ...(parentKey ? { parentKey } : {}),
    });
  });
}

function overviewBriefItemRow(
  brief: ProjectBriefRevision,
  item: ProjectBriefRevision["items"][number],
  parentKey: string,
  sourceKeys: ReadonlySet<string>,
): OverviewHullContentRow {
  const sourceKey = overviewBriefSourceKey(brief.id, item.id);
  const joined = sourceKeys.has(sourceKey);
  return {
    key: overviewBriefItemRowKey(brief.id, item.id),
    kind: joined ? "source" : "navigation",
    label: item.id,
    detail: item.kind,
    depth: 2,
    parentKey,
    ...(joined ? { nodeKey: sourceKey, graphRefs: [sourceKey] } : {
      graphRefs: [],
    }),
    sessionIds: [],
    endpoint: joined,
    selectable: joined,
    focusable: true,
    provenance: {
      sourceId: item.id,
      snapshotId: brief.id,
      revision: brief.revision,
    },
  };
}

function overviewBriefReferencedSourceRows(
  brief: ProjectBriefRevision | undefined,
  sources: readonly OverviewBriefSourceHeroNode[],
): readonly OverviewHullContentRow[] {
  const currentItemSourceKeys = new Set(
    brief
      ? brief.items.map((item) => overviewBriefSourceKey(brief.id, item.id))
      : [],
  );
  const leftover: OverviewBriefSourceHeroNode[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (currentItemSourceKeys.has(source.key) || seen.has(source.key)) {
      continue;
    }
    seen.add(source.key);
    leftover.push(source);
  }
  leftover.sort((left, right) => left.key.localeCompare(right.key));
  const bySnapshot = new Map<string, OverviewBriefSourceHeroNode[]>();
  const ungrouped: OverviewBriefSourceHeroNode[] = [];
  for (const source of leftover) {
    const identity = exactReferencedBriefIdentity(source.brief);
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
      members.map((member) =>
        JSON.stringify(exactReferencedBriefIdentity(member.brief))
      ),
    );
    if (identities.size !== 1 || identities.has("null")) {
      ungrouped.push(...members);
      continue;
    }
    const referenced = exactReferencedBriefIdentity(members[0]!.brief)!;
    const parentKey = overviewBriefSnapshotGroupKey(referenced);
    rows.push(overviewHullFolderRow({
      key: parentKey,
      label: overviewBriefReferencedSnapshotLabel(),
      detail: referenced.snapshotId,
      depth: 0,
    }));
    for (const source of members) {
      rows.push(referencedSourceRow(source, parentKey, 1));
    }
  }
  ungrouped.sort((left, right) => left.key.localeCompare(right.key));
  for (const source of ungrouped) {
    rows.push(referencedSourceRow(source, undefined, 0));
  }
  return rows;
}

function referencedSourceRow(
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
    graphRefs: [source.key],
    sessionIds: [],
    endpoint: true,
    selectable: true,
    focusable: true,
    provenance: {
      sourceId: source.sourceItem.id,
      snapshotId: source.brief.snapshotId,
      revision: source.brief.revision,
    },
  };
}

function exactReferencedBriefIdentity(
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

function sourceRecord(
  source: OverviewBriefSourceHeroNode,
): OverviewHullContentRow {
  return {
    key: source.key,
    kind: "source",
    label: source.sourceItem.id,
    detail: source.sourceItem.kind,
    depth: 0,
    nodeKey: source.key,
    graphRefs: [source.key],
    sessionIds: [],
    endpoint: true,
    selectable: true,
    focusable: true,
    provenance: {
      sourceId: source.sourceItem.id,
      snapshotId: source.brief.snapshotId,
      revision: source.brief.revision,
    },
  };
}
