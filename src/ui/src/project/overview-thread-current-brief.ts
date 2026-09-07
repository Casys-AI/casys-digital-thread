import type { ProjectBriefRevision } from "../../../domain/project/project-brief.ts";

export function overviewCurrentBriefViewerId(briefSnapshotId: string): string {
  return `current-brief:${briefSnapshotId}`;
}

export function overviewCurrentBriefViewerTitle(revision: number): string {
  return `Current approved Brief · r${revision}`;
}

export function overviewCurrentBriefMatches(
  brief: ProjectBriefRevision | undefined,
  briefSnapshotId: string,
): boolean {
  return brief?.id === briefSnapshotId;
}

/** Read-only projection of the exact current snapshot; never a Thread session. */
export function overviewCurrentBriefDocument(
  brief: ProjectBriefRevision,
): {
  readonly snapshotId: string;
  readonly briefId: string;
  readonly revision: number;
  readonly contractVersion: string;
  readonly items: ProjectBriefRevision["items"];
} {
  return {
    snapshotId: brief.id,
    briefId: brief.briefId,
    revision: brief.revision,
    contractVersion: brief.contractVersion ?? "1.0",
    items: brief.items,
  };
}
