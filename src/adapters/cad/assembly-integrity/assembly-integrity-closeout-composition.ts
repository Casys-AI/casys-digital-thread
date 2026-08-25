/**
 * Provider-free L5 assembly-integrity closeout composition.
 *
 * It reopens the typed L4 CAS and contributes only the public review plus
 * human-only documentary executor. No observer, CAD provider, SysON client,
 * tolerance, or generic requirement-evaluation adapter is composed here.
 */

import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { AssemblyIntegrityEvaluationCaptureStore } from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-evaluation-capture-store.ts";
import type { EngineeringProjectCommandService } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { FileAssemblyIntegrityEvaluationCaptureStore } from "./file-assembly-integrity-evaluation-capture-store.ts";
import { DecideAssemblyIntegrityEvaluationCloseoutRunExecutor } from "./decide-assembly-integrity-evaluation-closeout-run-executor.ts";
import { PrepareProjectAssemblyIntegrityEvaluationCloseoutReview } from "./prepare-project-assembly-integrity-evaluation-closeout-review.ts";

export interface AssemblyIntegrityCloseoutSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface AssemblyIntegrityCloseoutProjectOptions {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: AssemblyIntegrityCloseoutSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  /**
   * The exact L4 CAS reader when L4 is composed by the same server. This keeps
   * L5 provider-free while making its historical evidence source explicit.
   */
  readonly evaluationCaptures?: Pick<AssemblyIntegrityEvaluationCaptureStore, "read">;
}

export interface AssemblyIntegrityCloseoutProject {
  readonly assemblyIntegrityEvaluationCloseoutReview:
    PrepareProjectAssemblyIntegrityEvaluationCloseoutReview;
  readonly decideAssemblyIntegrityEvaluationCloseout:
    DecideAssemblyIntegrityEvaluationCloseoutRunExecutor;
}

export function createAssemblyIntegrityCloseoutProject(
  options: AssemblyIntegrityCloseoutProjectOptions,
): AssemblyIntegrityCloseoutProject {
  const evaluationCaptures = options.evaluationCaptures ??
    new FileAssemblyIntegrityEvaluationCaptureStore();
  const closeoutCaptures = new FileCaptureStore(
    ASSEMBLY_INTEGRITY_EVALUATION_CLOSEOUT_CAPTURE_DESCRIPTOR,
  );
  const resolver = { evaluationCaptures } as const;
  return {
    assemblyIntegrityEvaluationCloseoutReview:
      new PrepareProjectAssemblyIntegrityEvaluationCloseoutReview({
        projects: options.projects,
        snapshots: options.snapshots,
        ...resolver,
      }),
    decideAssemblyIntegrityEvaluationCloseout:
      new DecideAssemblyIntegrityEvaluationCloseoutRunExecutor({
        projects: options.projects,
        commands: options.commands,
        snapshots: options.snapshots,
        closeoutCaptures,
        lease: options.lease,
        ...resolver,
      }),
  };
}
