/**
 * Persist and reopen one opaque project-source closure locator.
 *
 * Callers never submit the full closure document. Resource reopen stays
 * with the application use case before persist.
 */

import type {
  ProjectSourceClosure,
  ProjectSourceClosureLocator,
} from "../../../../domain/project-source-workspace/closure.ts";

export type ProjectSourceClosureStoreErrorCode =
  | "closure_invalid"
  | "locator_cas_tampered"
  | "closure_readback_failed";

export class ProjectSourceClosureStoreError extends Error {
  constructor(
    readonly code: ProjectSourceClosureStoreErrorCode,
    message: string,
    readonly reference?: unknown,
  ) {
    super(message);
    this.name = "ProjectSourceClosureStoreError";
  }
}

export interface ReopenedProjectSourceClosure {
  readonly locator: ProjectSourceClosureLocator;
  readonly document: ProjectSourceClosure;
}

export interface ProjectSourceClosureStore {
  persist(document: ProjectSourceClosure): Promise<ProjectSourceClosureLocator>;
  reopenLocator(value: unknown): Promise<ReopenedProjectSourceClosure>;
}
