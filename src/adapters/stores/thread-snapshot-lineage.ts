import { deterministicJson } from "../../domain/deterministic-json.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import type { ExactThreadSnapshotReader } from "./engineering-thread-snapshot-resolver.ts";

/**
 * Prove lineage by resolving every immutable `previous` reference exactly.
 * A higher revision, matching subject, or familiar ID prefix is never enough.
 */
export async function threadSnapshotDescendsFrom(
  descendant: ThreadSnapshot,
  ancestor: ThreadSnapshot,
  snapshots: ExactThreadSnapshotReader,
): Promise<boolean> {
  if (
    descendant.subject.id !== ancestor.subject.id ||
    descendant.revision < ancestor.revision
  ) return false;

  let cursor = descendant;
  const visited = new Set<string>();
  while (
    cursor.id !== ancestor.id || cursor.revision !== ancestor.revision
  ) {
    const key = `${cursor.id}\u0000${cursor.revision}`;
    if (visited.has(key) || cursor.revision <= ancestor.revision) return false;
    visited.add(key);
    const previous = cursor.previous;
    if (!previous || previous.revision >= cursor.revision) return false;
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
