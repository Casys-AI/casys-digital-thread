import type { ThreadSnapshot } from "./thread-snapshot.ts";

/**
 * Persistence boundary for versioned thread snapshots.
 *
 * Implementations belong in adapters. The domain contract deliberately makes
 * no choice between memory, files, databases, or remote storage.
 */
export interface ThreadSnapshotStore {
  get(snapshotId: string): Promise<ThreadSnapshot | undefined>;
  latest(subjectId: string): Promise<ThreadSnapshot | undefined>;
  save(snapshot: ThreadSnapshot): Promise<void>;
}
