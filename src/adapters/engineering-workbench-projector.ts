import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import type { LiveThreadWorkbenchSnapshot } from "./live-thread-update-store.ts";

export const ENGINEERING_WORKBENCH_SCHEMA = "engineering-workbench/0.1" as const;

/** Complete, browser-facing read model for one engineering project. */
export interface EngineeringWorkbenchSnapshot {
  schemaVersion: typeof ENGINEERING_WORKBENCH_SCHEMA;
  project: EngineeringProjectSnapshot;
  thread: LiveThreadWorkbenchSnapshot;
  alignment: EngineeringWorkbenchAlignment;
}

export interface EngineeringWorkbenchAlignment {
  status: "aligned" | "thread-ahead";
  projectThreadRevision: number;
  currentThreadRevision: number;
}

/**
 * Compose project intent and observed thread evidence without deriving new
 * engineering truth. The BFF owns this presentation boundary only.
 */
export function projectEngineeringWorkbenchSnapshot(
  project: EngineeringProjectSnapshot,
  thread: LiveThreadWorkbenchSnapshot,
  currentThreadRevision: number,
): EngineeringWorkbenchSnapshot {
  if (project.project.subjectId !== thread.subject.id) {
    throw new Error(
      `Engineering project subject ${project.project.subjectId} does not match thread subject ${thread.subject.id}.`,
    );
  }
  if (project.threadSnapshots.length === 0) {
    throw new Error("Engineering project must reference an exact thread snapshot.");
  }
  const projectThreadRevision = Math.max(
    ...project.threadSnapshots.map((reference) => reference.revision),
  );
  if (!Number.isSafeInteger(currentThreadRevision) || currentThreadRevision <= 0) {
    throw new Error("Current thread revision must be a positive safe integer.");
  }
  if (currentThreadRevision < projectThreadRevision) {
    throw new Error(
      `Current thread revision ${currentThreadRevision} precedes project thread revision ${projectThreadRevision}.`,
    );
  }
  return {
    schemaVersion: ENGINEERING_WORKBENCH_SCHEMA,
    project: structuredClone(project),
    thread: structuredClone(thread),
    alignment: {
      status: currentThreadRevision === projectThreadRevision
        ? "aligned"
        : "thread-ahead",
      projectThreadRevision,
      currentThreadRevision,
    },
  };
}
