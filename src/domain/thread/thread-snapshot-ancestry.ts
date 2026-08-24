/**
 * Exact ThreadSnapshot ancestry along the immutable `previous` chain.
 *
 * A higher revision, matching subject, or familiar ID prefix is never enough.
 * Callers that need intermediates must read them from ThreadSnapshotStore;
 * numeric revision comparison is not a lineage proof.
 */

import { deterministicJson } from "../kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "./thread-snapshot.ts";

/** Minimal read boundary needed to walk one immutable predecessor chain. */
export interface ThreadSnapshotAncestryReader {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

/**
 * Prove that `descendant` is the ancestor itself or follows its exact
 * `previous` chain, one contiguous revision at a time.
 *
 * Fail-closed: missing/mismatched resolved records, cross-subject pointers,
 * revision gaps, cycles, and byte-inexact ancestor identity all return false.
 */
export async function threadSnapshotDescendsFrom(
  descendant: ThreadSnapshot,
  ancestor: ThreadSnapshot,
  snapshots: ThreadSnapshotAncestryReader,
): Promise<boolean> {
  if (
    descendant.subject.id !== ancestor.subject.id ||
    descendant.revision < ancestor.revision
  ) return false;

  let cursor = descendant;
  const visited = new Set<string>();
  while (cursor.id !== ancestor.id || cursor.revision !== ancestor.revision) {
    const key = `${cursor.id}\u0000${cursor.revision}`;
    if (visited.has(key) || cursor.revision <= ancestor.revision) return false;
    visited.add(key);
    const previous = cursor.previous;
    // A ThreadSnapshot lineage is one immutable revision at a time. Merely
    // pointing to an older record would let a completion proof skip evidence
    // revisions that were part of the run's actual causal history.
    if (!previous || previous.revision !== cursor.revision - 1) return false;
    const resolved = await snapshots.get(previous.snapshotId);
    if (
      !resolved ||
      resolved.id !== previous.snapshotId ||
      resolved.revision !== previous.revision ||
      resolved.subject.id !== ancestor.subject.id
    ) return false;
    cursor = resolved;
  }

  return deterministicJson(cursor) === deterministicJson(ancestor);
}
