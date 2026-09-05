import type { ProjectCapabilityLedger } from "../../../domain/capability/project-capability-authorization.ts";

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
   * Strictly enumerate every validated pending next revision, including a
   * project directory that has no published ledger yet. A store must reject
   * an unreadable or non-exact pending record rather than omit it.
   */
  listPending(): Promise<readonly ProjectCapabilityLedger[]>;
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
