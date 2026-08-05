import {
  EngineeringProjectCommandService,
  type EngineeringProjectInitialCompletionEvidenceValidator,
  type EngineeringProjectPlanningDependencies,
  EngineeringProjectStoreConflictError,
} from "../domain/engineering-project-command-service.ts";
import {
  FileEngineeringProjectRevisionStore,
  FileEngineeringProjectStore,
} from "./engineering-project-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "./validators/engineering-project-completion-evidence-validator.ts";
import type { ExactThreadSnapshotReader } from "./engineering-thread-snapshot-resolver.ts";

export interface EngineeringProjectCommandRuntimeOptions {
  readonly projectId: string;
  readonly trackedManifestPath: string;
  readonly activeDirectory?: string;
  /** Required so a completed run can never publish invented evidence refs. */
  readonly evidenceSnapshots: ExactThreadSnapshotReader;
  /** Optional until a trusted agent planning surface is configured. */
  readonly planning?: EngineeringProjectPlanningDependencies;
  /** Required by the trusted approved-brief documentary baseline executor. */
  readonly initialEvidenceValidator?:
    EngineeringProjectInitialCompletionEvidenceValidator;
}

export interface EngineeringProjectCommandRuntime {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
}

/**
 * Resolve one shared, immutable active store for both the MCP server and BFF.
 * The tracked manifest is used only to seed revision 1 when active state is
 * absent; it never shadows a later active revision.
 */
export async function createEngineeringProjectCommandRuntime(
  options: EngineeringProjectCommandRuntimeOptions,
): Promise<EngineeringProjectCommandRuntime> {
  const projects = new FileEngineeringProjectRevisionStore(
    options.activeDirectory ?? "state/local/engineering-projects",
  );
  let current = await projects.get(options.projectId);
  if (!current) {
    const fallback = await new FileEngineeringProjectStore(
      options.trackedManifestPath,
    ).get();
    if (!fallback) {
      throw new Error(
        `Tracked EngineeringProject fallback not found: ${options.trackedManifestPath}.`,
      );
    }
    if (fallback.project.id !== options.projectId) {
      throw new Error(
        `Tracked EngineeringProject ${fallback.project.id} does not match configured project ${options.projectId}.`,
      );
    }
    try {
      current = await projects.createInitial(fallback);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      // Another Workbench/MCP process may have won the createNew CAS. Accept
      // only a readable active winner; never fall back silently after conflict.
      current = await projects.get(options.projectId);
      if (!current) throw error;
    }
  }
  return {
    projects,
    commands: new EngineeringProjectCommandService(
      projects,
      new ExactThreadCompletionEvidenceValidator(options.evidenceSnapshots),
      undefined,
      options.planning,
      options.initialEvidenceValidator,
    ),
  };
}
