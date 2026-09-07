/**
 * Overview hull version history.
 *
 * Reuses the Workbench's generic version projection. It never invents family
 * membership, folds by label, or builds a second graph authority.
 */
import type {
  ThreadEvidenceFamilyGraph,
  ThreadGraph,
  ThreadGraphRef,
} from "../../../thread/types.ts";
import {
  buildVersionedProvenanceProjection,
  type VersionedEvidenceFamily,
} from "../../../thread/versioned-provenance-model.ts";

/** Already-classified Overview record used only to place a family in a hull. */
export interface OverviewVersionHistoryRecord {
  readonly key: string;
  readonly hullKey: string;
}

export interface OverviewHullVersionHistory {
  readonly hullKey: string;
  readonly historicalCount: number;
  readonly familyIds: readonly string[];
}

export interface OverviewVersionHistoryProjection {
  /** Layout graph: original node objects, algorithm-owned remapped edges. */
  readonly displayedGraph: ThreadGraph;
  readonly hulls: readonly OverviewHullVersionHistory[];
  readonly hiddenMemberKeys: ReadonlySet<string>;
}

/** Compact hull and menu copy. Collapsed history is the default. */
export function overviewHullHistoryLabel(
  historicalCount: number,
  expanded: boolean,
): string {
  return expanded ? "Hide history" : `History ${historicalCount}`;
}

/**
 * Fold BFF-declared families onto current members per hull. Expanding a hull
 * exempts exactly those families. Ambiguous or inconsistently placed members
 * stay visible.
 */
export function buildOverviewVersionHistory(
  graph: ThreadGraph,
  familyGraph: ThreadEvidenceFamilyGraph,
  classifiedRecords: readonly OverviewVersionHistoryRecord[],
  expandedHullKeys: ReadonlySet<string> = new Set(),
): OverviewVersionHistoryProjection {
  const hullByRecordKey = new Map(
    classifiedRecords.map((record) => [record.key, record.hullKey]),
  );
  const baseline = buildVersionedProvenanceProjection(graph, familyGraph);
  const foldableById = new Map<string, VersionedEvidenceFamily>();
  for (const family of baseline.familyByVisibleRef.values()) {
    foldableById.set(family.family.id, family);
  }

  const hullsByKey = new Map<string, {
    familyIds: string[];
    historicalCount: number;
  }>();
  const inconsistentFamilyIds = new Set<string>();
  for (const family of foldableById.values()) {
    const hullKey = consistentHullKey(family, hullByRecordKey);
    if (!hullKey) {
      inconsistentFamilyIds.add(family.family.id);
      continue;
    }
    const historicalCount = Math.max(0, family.members.length - 1);
    if (historicalCount === 0) continue;
    const hull = hullsByKey.get(hullKey) ?? {
      familyIds: [],
      historicalCount: 0,
    };
    hull.familyIds.push(family.family.id);
    hull.historicalCount += historicalCount;
    hullsByKey.set(hullKey, hull);
  }

  const foldingFamilyIds = new Set<string>();
  for (const [hullKey, hull] of hullsByKey) {
    if (expandedHullKeys.has(hullKey)) continue;
    for (const familyId of hull.familyIds) foldingFamilyIds.add(familyId);
  }
  const needsExemption = inconsistentFamilyIds.size > 0 ||
    [...hullsByKey.keys()].some((hullKey) => expandedHullKeys.has(hullKey));
  const displayedProjection = needsExemption
    ? buildVersionedProvenanceProjection(graph, {
      ...familyGraph,
      families: familyGraph.families.filter((family) =>
        foldingFamilyIds.has(family.id)
      ),
    })
    : baseline;
  const displayedGraph = restoreOriginalNodes(graph, displayedProjection.graph);
  const displayedKeys = new Set(
    displayedGraph.nodes.map((node) => refKey(node.ref)),
  );
  const hiddenMemberKeys = new Set<string>();
  for (const [hullKey, hull] of hullsByKey) {
    if (expandedHullKeys.has(hullKey)) continue;
    for (const familyId of hull.familyIds) {
      const family = foldableById.get(familyId);
      if (!family) continue;
      for (const member of family.members) {
        const key = refKey(member.ref);
        if (!displayedKeys.has(key)) hiddenMemberKeys.add(key);
      }
    }
  }

  const hulls = [...hullsByKey.entries()]
    .map(([hullKey, hull]) => ({
      hullKey,
      historicalCount: hull.historicalCount,
      familyIds: [...hull.familyIds].sort(),
    }))
    .sort((left, right) => left.hullKey.localeCompare(right.hullKey));

  return { displayedGraph, hulls, hiddenMemberKeys };
}

function consistentHullKey(
  family: VersionedEvidenceFamily,
  hullByRecordKey: ReadonlyMap<string, string>,
): string | undefined {
  const hullKeys = new Set<string>();
  for (const member of family.members) {
    const hullKey = hullByRecordKey.get(refKey(member.ref));
    if (!hullKey) return undefined;
    hullKeys.add(hullKey);
  }
  return hullKeys.size === 1 ? [...hullKeys][0] : undefined;
}

function restoreOriginalNodes(
  graph: ThreadGraph,
  displayed: ThreadGraph,
): ThreadGraph {
  const originalByKey = new Map(
    graph.nodes.map((node) => [refKey(node.ref), node] as const),
  );
  return {
    nodes: displayed.nodes.map((node) =>
      originalByKey.get(refKey(node.ref)) ?? node
    ),
    edges: displayed.edges,
  };
}

function refKey(reference: ThreadGraphRef): string {
  return `${reference.kind}:${reference.id}`;
}
