import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

export { threadSnapshotDescendsFrom } from "../../../domain/thread/thread-snapshot-ancestry.ts";

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
