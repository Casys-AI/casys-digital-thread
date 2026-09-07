import type { ProjectBriefRevision } from "../../../../../domain/project/project-brief.ts";
import type {
  OverviewBriefSourceHeroNode,
  OverviewThreadHeroView,
} from "../../overview-thread-hero-model.ts";
import type { OverviewHullContent, OverviewHullContentRow } from "./types.ts";
import { overviewThreadD3FlowGroupIdentity } from "../../overview-thread-d3-flow-layout.ts";

export const OVERVIEW_BRIEF_HULL_KEY = overviewThreadD3FlowGroupIdentity(
  "requirements",
  "brief",
);

/** Current approved Project intent. Exact correspondences stay on the graph. */
export function withOverviewCurrentBrief(
  view: OverviewThreadHeroView,
  brief: ProjectBriefRevision | undefined,
): OverviewThreadHeroView {
  if (!brief) return view;
  return view;
}

/**
 * Visible Brief hull is a section index of the current snapshot. The hull
 * itself is the wrapper; historical and requirement-backed sources stay
 * evidence records, never current-section leaves.
 */
export function withOverviewCurrentBriefContent(
  contents: ReadonlyMap<string, OverviewHullContent>,
  view: OverviewThreadHeroView,
  brief: ProjectBriefRevision | undefined,
): ReadonlyMap<string, OverviewHullContent> {
  if (!brief) return contents;
  const current = contents.get(OVERVIEW_BRIEF_HULL_KEY);
  const sources = view.nodes.filter((
    node,
  ): node is OverviewBriefSourceHeroNode => node.kind === "brief-source");
  const seenRecords = new Set(current?.records.map((row) => row.key) ?? []);
  const result = new Map(contents);
  result.set(OVERVIEW_BRIEF_HULL_KEY, {
    groupKey: OVERVIEW_BRIEF_HULL_KEY,
    mode: "tree",
    rows: overviewBriefSectionRows(brief),
    records: [
      ...current?.records ?? [],
      ...sources.flatMap((source) =>
        seenRecords.has(source.key) ? [] : [sourceRecord(source)]
      ),
    ],
  });
  return result;
}

export function overviewBriefSectionRowKey(
  briefSnapshotId: string,
  kind: string,
): string {
  return `brief-section:${JSON.stringify([briefSnapshotId, kind])}`;
}

export function overviewBriefSectionLabel(kind: string): string {
  return kind.split("-").filter((part) => part.length > 0).map((part) =>
    `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
  ).join(" ");
}

export function overviewBriefSectionRows(
  brief: ProjectBriefRevision,
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
    return {
      key: overviewBriefSectionRowKey(brief.id, kind),
      kind: "navigation" as const,
      label: overviewBriefSectionLabel(kind),
      detail: count === 1 ? "1 élément" : `${count} éléments`,
      depth: 0,
      sessionIds: [],
      endpoint: false,
      nativeAction: "open-current-brief" as const,
    };
  });
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
    sessionIds: [],
    endpoint: true,
  };
}
