import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ExactThreadSnapshotReader } from "./engineering-thread-snapshot-resolver.ts";

/** Raised when an immutable ThreadSnapshot predecessor chain is not intact. */
export class ThreadSnapshotLineageIntegrityError extends Error {
  constructor(detail: string) {
    super(`ThreadSnapshot lineage is not intact: ${detail}`);
    this.name = "ThreadSnapshotLineageIntegrityError";
  }
}

/**
 * Resolve every predecessor of a snapshot and prove that it is one continuous
 * immutable lineage for a single subject.
 *
 * This is deliberately stronger than `validateThreadSnapshot`, which validates
 * one JSON document without I/O. Call it at a trusted execution boundary before
 * an external write: a missing predecessor, cross-subject pointer, revision
 * gap, mismatched resolved record, malformed ancestor, or cycle is fail-closed.
 */
export async function assertThreadSnapshotLineageIntact(
  snapshot: ThreadSnapshot,
  snapshots: Pick<ThreadSnapshotStore, "get">,
): Promise<void> {
  const subjectId = snapshot.subject.id;
  const visited = new Set<string>();
  let cursor = snapshot;

  while (true) {
    const cursorKey = `${cursor.id}\u0000${cursor.revision}`;
    if (visited.has(cursorKey)) {
      throw new ThreadSnapshotLineageIntegrityError(
        `cycle detected at ${cursor.id}@${cursor.revision}.`,
      );
    }
    visited.add(cursorKey);

    const previous = cursor.previous;
    if (!previous) {
      if (cursor.revision !== 1) {
        throw new ThreadSnapshotLineageIntegrityError(
          `snapshot ${cursor.id}@${cursor.revision} has no predecessor before revision 1.`,
        );
      }
      return;
    }
    if (previous.revision !== cursor.revision - 1) {
      throw new ThreadSnapshotLineageIntegrityError(
        `snapshot ${cursor.id}@${cursor.revision} points to non-contiguous predecessor ` +
          `${previous.snapshotId}@${previous.revision}.`,
      );
    }

    let ancestor: ThreadSnapshot | undefined;
    try {
      ancestor = await snapshots.get(previous.snapshotId);
    } catch (error) {
      throw new ThreadSnapshotLineageIntegrityError(
        `predecessor ${previous.snapshotId}@${previous.revision} is unreadable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!ancestor) {
      throw new ThreadSnapshotLineageIntegrityError(
        `predecessor ${previous.snapshotId}@${previous.revision} is missing.`,
      );
    }
    if (
      ancestor.id !== previous.snapshotId ||
      ancestor.revision !== previous.revision
    ) {
      throw new ThreadSnapshotLineageIntegrityError(
        `predecessor ${previous.snapshotId}@${previous.revision} resolved to ` +
          `${ancestor.id}@${ancestor.revision}.`,
      );
    }
    if (ancestor.subject.id !== subjectId) {
      throw new ThreadSnapshotLineageIntegrityError(
        `predecessor ${ancestor.id}@${ancestor.revision} belongs to subject ` +
          `${ancestor.subject.id}, expected ${subjectId}.`,
      );
    }
    try {
      cursor = validateThreadSnapshot(ancestor);
    } catch (error) {
      throw new ThreadSnapshotLineageIntegrityError(
        `predecessor ${ancestor.id}@${ancestor.revision} is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

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
