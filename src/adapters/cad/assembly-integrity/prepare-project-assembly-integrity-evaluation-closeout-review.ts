/**
 * Provider-free preparation of the human L5 assembly-integrity closeout.
 *
 * The sole public input is projectId. Review reconstructs one exact current
 * L4 branch; it never accepts a provider, tolerance, verdict, gate, or human
 * consequence from the caller.
 */

import type {
  ProjectAssemblyIntegrityEvaluationCloseoutReviewRequest,
  ProjectAssemblyIntegrityEvaluationCloseoutReviewResult,
  ProjectAssemblyIntegrityEvaluationCloseoutReviewUseCase,
} from "../../../application/ports/in/cad/assembly-integrity/project-assembly-integrity-evaluation-closeout-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import { assemblyIntegrityEvaluationCloseoutReviewNext } from "../../../application/use-cases/cad/assembly-integrity/assembly-integrity-evaluation-closeout-review-next.ts";
import {
  type AssemblyIntegrityEvaluationCloseoutAdmission,
  encodeAssemblyIntegrityEvaluationCloseoutAdmission,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-evaluation-closeout-proposal.ts";
import { exactRecord, safeId } from "../../../domain/kernel/case-validation.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  assemblyIntegrityCloseoutAuthorization,
  type AssemblyIntegrityCloseoutEvidenceResolverDependencies,
  AssemblyIntegrityCloseoutResolutionError,
  type AssemblyIntegrityCloseoutResolvedEvidence,
  assemblyIntegrityEvaluationCloseoutAdmission,
  resolveAssemblyIntegrityCloseoutEvidence,
} from "./assembly-integrity-closeout-evidence-resolver.ts";

export interface AssemblyIntegrityCloseoutReviewSnapshotStore
  extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectAssemblyIntegrityEvaluationCloseoutReviewDependencies
  extends AssemblyIntegrityCloseoutEvidenceResolverDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: AssemblyIntegrityCloseoutReviewSnapshotStore;
}

export class PrepareProjectAssemblyIntegrityEvaluationCloseoutReview
  implements ProjectAssemblyIntegrityEvaluationCloseoutReviewUseCase {
  constructor(
    private readonly dependencies:
      PrepareProjectAssemblyIntegrityEvaluationCloseoutReviewDependencies,
  ) {}

  async execute(
    value: unknown,
  ): Promise<ProjectAssemblyIntegrityEvaluationCloseoutReviewResult> {
    let request: ProjectAssemblyIntegrityEvaluationCloseoutReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      return unavailable(
        "invalid_request",
        "The assembly-integrity evaluation-closeout review request must name exactly one project.",
      );
    }
    const rawProject = await this.dependencies.projects.get(request.projectId);
    if (!rawProject) {
      return unavailable(
        "project_not_found",
        "The exact engineering project is unavailable.",
      );
    }
    let project;
    try {
      project = validateEngineeringProjectSnapshot(rawProject);
    } catch {
      return unresolved(
        "project_invalid",
        "The engineering project failed closed validation.",
      );
    }
    if (project.project.id !== request.projectId) {
      return unresolved(
        "project_mismatch",
        "The project reader returned a foreign project identity.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unavailable(tip.diagnostic.code, tip.diagnostic.message);
    }
    const basis = tip.basis;
    if (basis.subjectId !== project.project.subjectId) {
      return unresolved(
        "subject_mismatch",
        "The unique current Thread tip is foreign to the project subject.",
      );
    }
    const snapshot = await readExactSnapshot(
      this.dependencies.snapshots,
      basis.snapshotId,
    );
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      return unavailable(
        "snapshot_not_found",
        "The exact current Thread tip cannot be reopened.",
      );
    }
    try {
      await assertThreadSnapshotLineageIntact(snapshot, this.dependencies.snapshots);
      const resolved = await resolveAssemblyIntegrityCloseoutEvidence(
        this.dependencies,
        { project, basis, snapshot },
      );
      const reject = assemblyIntegrityEvaluationCloseoutAdmission(
        resolved,
        "reject",
        assemblyIntegrityCloseoutAuthorization(project, "reject"),
      );
      const accept = resolved.acceptanceEligible
        ? assemblyIntegrityEvaluationCloseoutAdmission(
          resolved,
          "accept",
          assemblyIntegrityCloseoutAuthorization(project, "accept"),
        )
        : undefined;
      return {
        status: "resolved",
        selected: {
          family: "assembly-integrity",
          basis: resolved.basis,
          acceptanceEligibility: resolved.acceptanceEligible,
          criteria: resolved.capture.evaluation.criteria,
          limitations: {
            ...resolved.capture.method.limitations,
            certification: "not-issued",
            l4PassIsNotL5: true,
          },
          evidence: {
            evaluationCapture: evidenceRef(resolved.evaluationCapture),
            geometryModule: evidenceRef(resolved.geometryModule),
            assemblyStep: evidenceRef(resolved.assemblyStep),
            observation: evidenceRef(resolved.observation),
          },
          ...(accept === undefined ? {} : {
            accept: closeoutBranch(project, resolved, accept),
          }),
          reject: closeoutBranch(project, resolved, reject),
        },
      };
    } catch (error) {
      if (error instanceof AssemblyIntegrityCloseoutResolutionError) {
        return error.code === "not-found" || error.code === "stale"
          ? unavailable(error.code, error.message)
          : unresolved(error.code, error.message);
      }
      return unresolved(
        "recross_failed",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}

function parseRequest(
  value: unknown,
): ProjectAssemblyIntegrityEvaluationCloseoutReviewRequest {
  const root = exactRecord(
    value,
    ["projectId"],
    "$assemblyIntegrityEvaluationCloseoutReview",
  );
  return {
    projectId: safeId(
      root.projectId,
      "$assemblyIntegrityEvaluationCloseoutReview.projectId",
    ),
  };
}

async function readExactSnapshot(
  snapshots: AssemblyIntegrityCloseoutReviewSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  const snapshot = snapshots.getFresh === undefined
    ? await snapshots.get(snapshotId)
    : await snapshots.getFresh(snapshotId);
  return snapshot === undefined ? undefined : validateThreadSnapshot(snapshot);
}

function closeoutBranch(
  project: EngineeringProjectSnapshot,
  resolved: AssemblyIntegrityCloseoutResolvedEvidence,
  admission: AssemblyIntegrityEvaluationCloseoutAdmission,
) {
  return {
    admission,
    decisionParameters: encodeAssemblyIntegrityEvaluationCloseoutAdmission(
      admission,
    ),
    next: assemblyIntegrityEvaluationCloseoutReviewNext({
      projectId: project.project.id,
      expectedRevision: project.revision,
      l4WorkItemId: resolved.l4Run.workItemId,
      baseSnapshot: {
        snapshotId: resolved.basis.snapshotId,
        revision: resolved.basis.revision,
        subjectId: resolved.subjectId,
      },
      admission,
    }),
  };
}

function evidenceRef(artifact: {
  readonly id: string;
  readonly fingerprint: { readonly algorithm: "sha256"; readonly digest: string };
  readonly producer: { readonly runId: string };
}) {
  return {
    id: artifact.id,
    fingerprint: artifact.fingerprint,
    producerRunId: artifact.producer.runId,
    freshness: "fresh" as const,
  };
}

function unavailable(
  code: string,
  message: string,
): ProjectAssemblyIntegrityEvaluationCloseoutReviewResult {
  return {
    status: "unavailable",
    family: "assembly-integrity",
    diagnostic: { code, message },
  };
}

function unresolved(
  code: string,
  message: string,
): ProjectAssemblyIntegrityEvaluationCloseoutReviewResult {
  return {
    status: "unresolved",
    family: "assembly-integrity",
    diagnostic: { code, message },
  };
}
