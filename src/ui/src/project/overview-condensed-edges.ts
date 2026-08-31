import type { ThreadGraphEdge, ThreadGraphRef } from "../thread/types.ts";
import {
  structuredOccurrenceKey,
  threadGraphEdgeRecordSignature,
} from "../thread/versioned-provenance-model.ts";

export interface CondensedGraphEdge {
  readonly key: string;
  readonly from: ThreadGraphRef;
  readonly to: ThreadGraphRef;
  readonly via: readonly string[];
}

/**
 * Preserve exact connectivity when a display mask omits intermediate nodes.
 * Every direct visible-visible occurrence stays represented. Reachability
 * through hidden nodes is projected once per visible endpoint pair with one
 * deterministic shortest witness path; alternative simple paths are not
 * enumerated.
 *
 * After one deterministic adjacency sort, each visible source visits every
 * reachable hidden node and outgoing edge at most once: O(S * (V + E)), where
 * S is the number of visible source keys. Witness materialisation is bounded by
 * the returned projection rather than the number of alternative simple paths.
 */
export function condenseEdgesThroughHiddenNodes(
  visibleKeys: ReadonlySet<string>,
  edges: readonly ThreadGraphEdge[],
): readonly CondensedGraphEdge[] {
  const indexedEdges = indexEdgeOccurrences(edges);
  const adjacency = new Map<string, IndexedGraphEdge[]>();
  for (const indexed of indexedEdges) {
    const from = refKey(indexed.edge.from);
    const existing = adjacency.get(from) ?? [];
    existing.push(indexed);
    adjacency.set(from, existing);
  }
  for (const [from, outgoing] of adjacency) {
    adjacency.set(
      from,
      outgoing.toSorted((left, right) =>
        refKey(left.edge.to).localeCompare(refKey(right.edge.to)) ||
        left.signature.localeCompare(right.signature) ||
        left.occurrenceKey.localeCompare(right.occurrenceKey)
      ),
    );
  }

  const condensed: CondensedGraphEdge[] = [];
  const visible = [...visibleKeys].toSorted();
  for (const origin of visible) {
    const queue = [origin];
    let cursor = 0;
    const visitedHidden = new Set<string>();
    const predecessor = new Map<string, string>();
    const hiddenTargetWitness = new Map<
      string,
      { readonly to: ThreadGraphRef; readonly terminalHidden: string }
    >();

    while (cursor < queue.length) {
      const current = queue[cursor++]!;
      for (const indexed of adjacency.get(current) ?? []) {
        const edge = indexed.edge;
        const next = refKey(edge.to);
        if (visibleKeys.has(next)) {
          if (current === origin) {
            condensed.push({
              key: indexed.occurrenceKey,
              from: edge.from,
              to: edge.to,
              via: [],
            });
          } else if (next !== origin && !hiddenTargetWitness.has(next)) {
            hiddenTargetWitness.set(next, {
              to: edge.to,
              terminalHidden: current,
            });
          }
          continue;
        }
        if (visitedHidden.has(next)) continue;
        visitedHidden.add(next);
        predecessor.set(next, current);
        queue.push(next);
      }
    }

    for (
      const [target, witness] of [...hiddenTargetWitness].toSorted(
        ([left], [right]) => left.localeCompare(right),
      )
    ) {
      condensed.push({
        key: structuredOccurrenceKey("overview-condensed-route", [
          origin,
          target,
        ]),
        from: parseRefKey(origin),
        to: witness.to,
        via: reconstructHiddenWitness(
          origin,
          witness.terminalHidden,
          predecessor,
        ),
      });
    }
  }

  return condensed.toSorted((left, right) => left.key.localeCompare(right.key));
}

interface IndexedGraphEdge {
  readonly edge: ThreadGraphEdge;
  readonly signature: string;
  readonly occurrenceKey: string;
}

/**
 * Domain edge ids are not occurrence identities: the Workbench contract
 * permits duplicate ids, including byte-identical records. Assign a graph-local
 * ordinal only when the complete recorded signature is duplicated.
 */
function indexEdgeOccurrences(
  edges: readonly ThreadGraphEdge[],
): readonly IndexedGraphEdge[] {
  const signatures = edges.map(threadGraphEdgeRecordSignature);
  const countBySignature = new Map<string, number>();
  for (const signature of signatures) {
    countBySignature.set(signature, (countBySignature.get(signature) ?? 0) + 1);
  }
  const ordinalBySignature = new Map<string, number>();
  return edges.map((edge, index) => {
    const signature = signatures[index]!;
    const ordinal = ordinalBySignature.get(signature) ?? 0;
    ordinalBySignature.set(signature, ordinal + 1);
    return {
      edge,
      signature,
      occurrenceKey: (countBySignature.get(signature) ?? 0) > 1
        ? structuredOccurrenceKey("overview-direct-edge", [
          signature,
          ordinal,
        ])
        : structuredOccurrenceKey("overview-direct-edge", [signature]),
    };
  });
}

function reconstructHiddenWitness(
  origin: string,
  terminalHidden: string,
  predecessor: ReadonlyMap<string, string>,
): readonly string[] {
  const reversed: string[] = [];
  let current = terminalHidden;
  while (current !== origin) {
    reversed.push(current);
    const previous = predecessor.get(current);
    if (previous === undefined) {
      throw new Error(`Missing hidden-path predecessor for ${current}.`);
    }
    current = previous;
  }
  return reversed.reverse();
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
