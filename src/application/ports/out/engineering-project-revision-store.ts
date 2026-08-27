import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";

/**
 * Persistence capability required by project command use cases.
 *
 * Implementations own durable I/O and compare-and-swap semantics; application
 * code depends only on this port.
 */
export interface EngineeringProjectRevisionStore {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
  getRevision(
    projectId: string,
    revision: number,
  ): Promise<EngineeringProjectSnapshot | undefined>;
  createInitial(
    snapshot: EngineeringProjectSnapshot,
  ): Promise<EngineeringProjectSnapshot>;
  commit(
    snapshot: EngineeringProjectSnapshot,
    expectedRevision: number,
  ): Promise<EngineeringProjectSnapshot>;
}

export class EngineeringProjectStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineeringProjectStoreConflictError";
  }
}
