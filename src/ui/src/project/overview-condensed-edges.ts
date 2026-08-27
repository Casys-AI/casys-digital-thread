import type { ThreadGraphEdge, ThreadGraphRef } from "../thread/types.ts";

export interface CondensedGraphEdge {
  readonly key: string;
  readonly from: ThreadGraphRef;
  readonly to: ThreadGraphRef;
  readonly via: readonly string[];
}

/**
 * Preserve exact connectivity when a display mask omits intermediate nodes.
 * Direct visible-visible edges stay themselves. A path that only travels
 * through hidden nodes becomes one condensed edge. No invented relation.
 */
export function condenseEdgesThroughHiddenNodes(
  visibleKeys: ReadonlySet<string>,
  edges: readonly ThreadGraphEdge[],
): readonly CondensedGraphEdge[] {
  const adjacency = new Map<string, ThreadGraphEdge[]>();
  for (const edge of edges) {
    const from = refKey(edge.from);
    const existing = adjacency.get(from) ?? [];
    existing.push(edge);
    adjacency.set(from, existing);
  }
  for (const [from, outgoing] of adjacency) {
    adjacency.set(
      from,
      outgoing.toSorted((left, right) =>
        left.id.localeCompare(right.id) ||
        refKey(left.to).localeCompare(refKey(right.to))
      ),
    );
  }

  const condensed: CondensedGraphEdge[] = [];
  const seen = new Set<string>();
  const visible = [...visibleKeys].toSorted();
  for (const from of visible) {
    walk(from, from, [], new Set());
  }

  function walk(
    origin: string,
    current: string,
    via: readonly string[],
    visiting: Set<string>,
  ): void {
    for (const edge of adjacency.get(current) ?? []) {
      const next = refKey(edge.to);
      if (next === origin) continue;
      if (visibleKeys.has(next)) {
        const key = via.length === 0
          ? edge.id
          : `condensed:${[origin, ...via, next].join(">")}`;
        if (!seen.has(key)) {
          seen.add(key);
          condensed.push({
            key,
            from: parseRefKey(origin),
            to: edge.to,
            via,
          });
        }
        continue;
      }
      if (visiting.has(next) || via.includes(next)) continue;
      visiting.add(next);
      walk(origin, next, [...via, next], visiting);
      visiting.delete(next);
    }
  }

  return condensed.toSorted((left, right) => left.key.localeCompare(right.key));
}

export function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function refKey(ref: ThreadGraphRef): string {
  return graphRefKey(ref);
}

function parseRefKey(key: string): ThreadGraphRef {
  const split = key.indexOf(":");
  return {
    kind: key.slice(0, split) as ThreadGraphRef["kind"],
    id: key.slice(split + 1),
  };
}
