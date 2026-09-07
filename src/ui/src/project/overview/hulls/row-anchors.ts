import type { OverviewHeroNode } from "../../overview-thread-hero-model.ts";
import { overviewThreadD3FlowGroupIdentity } from "../../overview-thread-d3-flow-layout.ts";
import type { ThreadViewerHierarchyProjection } from "../../../../../presentation/workbench/thread/viewer-hierarchy.ts";
import type { OverviewHullContent } from "./content.ts";

/**
 * Placement of actual recorded endpoints beside displayed rows. A navigation
 * row never becomes a Thread ref and parentKey never creates a graph edge.
 */
export function overviewHullRowAnchors(
  contents: ReadonlyMap<string, OverviewHullContent>,
  nodes: readonly OverviewHeroNode[],
  hierarchy?: ThreadViewerHierarchyProjection,
): Readonly<Record<string, Readonly<Record<string, number>>>> {
  const hierarchyById = new Map(
    hierarchy?.status === "available"
      ? hierarchy.nodes.map((node) => [node.id, node])
      : [],
  );
  const result: Record<string, Record<string, number>> = {};
  for (const [groupKey, content] of contents) {
    if (content.mode !== "tree") continue;
    const members = nodes.filter((node) =>
      overviewThreadD3FlowGroupIdentity(node.lane, node.groupKey) === groupKey
    );
    const candidates = new Map<string, Set<number>>();
    const add = (key: string, index: number) => {
      if (members.filter((node) => node.key === key).length !== 1) return;
      const rows = candidates.get(key) ?? new Set<number>();
      rows.add(index);
      candidates.set(key, rows);
    };
    for (const [index, row] of content.rows.entries()) {
      if (row.endpoint && row.nodeKey) add(row.nodeKey, index);
      if (row.kind !== "navigation") continue;
      const occurrence = hierarchyById.get(row.key);
      if (!occurrence) continue;
      const artifactIds = new Set([
        ...occurrence.artifactIds ?? [],
        ...occurrence.geometryArtifactId ? [occurrence.geometryArtifactId] : [],
      ]);
      for (const node of members) {
        if (
          node.kind === "recorded" && node.node.ref.kind === "artifact" &&
          artifactIds.has(node.node.ref.id)
        ) add(node.key, index);
      }
    }
    result[groupKey] = Object.fromEntries(
      [...candidates].flatMap(([key, rows]) =>
        rows.size === 1 ? [[key, [...rows][0]!]] : []
      ),
    );
  }
  return result;
}
