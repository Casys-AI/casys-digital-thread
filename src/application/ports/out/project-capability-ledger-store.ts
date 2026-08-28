import type { ProjectCapabilityLedger } from "../../control-plane/project-capability-authorization.ts";

/** Separate local host-authorization ledger; never an engineering Thread store. */
export interface ProjectCapabilityLedgerStore {
  get(projectId: string): Promise<ProjectCapabilityLedger | undefined>;
  /**
   * Strictly local enumeration used to reconstruct host authorization. This
   * remains outside the engineering Thread and never exposes a project-facing
   * query surface.
   */
  list(): Promise<readonly ProjectCapabilityLedger[]>;
  /**
   * Read one validated, not-yet-claimed next revision. This is only a crash
   * recovery seam: callers must still append it through the same CAS boundary.
   */
  getPending(projectId: string): Promise<ProjectCapabilityLedger | undefined>;
  append(
    ledger: ProjectCapabilityLedger,
    expectedRevision: number,
  ): Promise<ProjectCapabilityLedger>;
}

export class ProjectCapabilityLedgerConflictError extends Error {}
