import {
  EngineeringProjectCommandService,
  type EngineeringProjectInitialCompletionEvidenceValidator,
  type EngineeringProjectPlanningDependencies,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import type {
  UncertainWriterLifecycleQualifier,
} from "../../application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts";
import { assertThreadWriteClaimAllowed } from "../shared/thread-write-basis-guard.ts";
import {
  EngineeringProjectStoreConflictError,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  FileEngineeringProjectRevisionStore,
  FileEngineeringProjectStore,
} from "../shared/stores/engineering-project-store.ts";
import {
  ExactThreadCompletionEvidenceValidator,
  ExactThreadReconciliationSnapshotValidator,
} from "../validators/engineering-project-completion-evidence-validator.ts";
import type { ExactThreadSnapshotReader } from "../shared/stores/engineering-thread-snapshot-resolver.ts";

export interface EngineeringProjectCommandRuntimeOptions {
  /**
   * Optional explicit seed kept for isolated tests and controlled migrations.
   * Omit this pair for normal runtime composition: project_start and the
   * durable cockpit focus select active projects without a bundled product.
   */
  readonly projectId?: string;
  readonly trackedManifestPath?: string;
  readonly activeDirectory?: string;
  /** Required so a completed run can never publish invented evidence refs. */
  readonly evidenceSnapshots: ExactThreadSnapshotReader;
  /** Optional until a trusted agent planning surface is configured. */
  readonly planning?: EngineeringProjectPlanningDependencies;
  /** Required by the trusted approved-brief documentary baseline executor. */
  readonly initialEvidenceValidator?:
    EngineeringProjectInitialCompletionEvidenceValidator;
  /**
   * Server-computed uncertain-writer lifecycle qualification. Closed by
   * default when omitted; composition injects the Chrono adapter.
   */
  readonly uncertainWriterLifecycle?: UncertainWriterLifecycleQualifier;
}

export interface EngineeringProjectCommandRuntime {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
}

/**
 * Resolve one shared, immutable active store for both the MCP server and BFF.
 * An explicit tracked manifest may seed revision 1 for an isolated test or a
 * controlled migration. Normal composition has no implicit product seed: it
 * reads existing durable projects and lets project_start create new ones.
 */
export async function createEngineeringProjectCommandRuntime(
  options: EngineeringProjectCommandRuntimeOptions,
): Promise<EngineeringProjectCommandRuntime> {
  const projects = new FileEngineeringProjectRevisionStore(
    options.activeDirectory ?? "state/local/engineering-projects",
  );
  if (
    (options.projectId === undefined) !== (options.trackedManifestPath === undefined)
  ) {
    throw new TypeError(
      "Engineering project seed requires projectId and trackedManifestPath together.",
    );
  }
  if (options.projectId !== undefined && options.trackedManifestPath !== undefined) {
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
  }
  return {
    projects,
    commands: new EngineeringProjectCommandService(
      projects,
      new ExactThreadCompletionEvidenceValidator(options.evidenceSnapshots),
      undefined,
      options.planning,
      options.initialEvidenceValidator,
      new ExactThreadReconciliationSnapshotValidator(options.evidenceSnapshots),
      undefined,
      options.uncertainWriterLifecycle,
      options.uncertainWriterLifecycle
        ? (project, run) =>
          assertThreadWriteClaimAllowed(
            project,
            run,
            options.uncertainWriterLifecycle,
          )
        : undefined,
    ),
  };
}
