import type { EngineeringProjectCommandOrigin } from "./engineering-project-command-origin.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";

/** Stable command shared by the one agent-visible execution tool. */
export interface RegisteredProjectRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

/**
 * Inward execution port implemented structurally by each server-owned operation
 * executor. Callers depend on this capability, never on a concrete dispatcher
 * or adapter class.
 */
export interface ProjectRunExecutor {
  execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot>;
}
