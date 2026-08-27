/** Provider-free adapter for preparing a human static-mechanical L5 review. */

import type {
  ProjectEvaluationCloseoutReviewRequest,
  ProjectEvaluationCloseoutReviewResult,
  ProjectEvaluationCloseoutReviewUseCase,
} from "../../../application/ports/in/fea/evaluation-closeout/project-evaluation-closeout-review.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  encodeStaticMechanicalEvaluationCloseoutAdmission,
} from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import {
  resolveStaticMechanicalCloseoutEvidence,
  staticMechanicalCloseoutAdmission,
  type StaticMechanicalCloseoutEvidenceResolverDependencies,
  StaticMechanicalCloseoutResolutionError,
} from "./static-mechanical-closeout-evidence-resolver.ts";

export interface EvaluationCloseoutReviewSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface PrepareProjectEvaluationCloseoutReviewDependencies
  extends StaticMechanicalCloseoutEvidenceResolverDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: EvaluationCloseoutReviewSnapshotStore;
}

/**
 * The public input is exactly `projectId`. This implementation never accepts
 * artifact ids, proof/evaluation identifiers, provider envelopes, measured
 * values, thresholds, family selection, or a proposed human disposition.
 */
export class PrepareProjectEvaluationCloseoutReview
  implements ProjectEvaluationCloseoutReviewUseCase {
  constructor(
    private readonly dependencies: PrepareProjectEvaluationCloseoutReviewDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectEvaluationCloseoutReviewResult> {
    let request: ProjectEvaluationCloseoutReviewRequest;
    try {
      request = parseRequest(value);
    } catch {
      return unavailable(
        "invalid_request",
        "The evaluation-closeout review request must name exactly one project.",
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
        "The project reader did not return the requested project identity.",
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
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      return unavailable(
        "snapshot_not_found",
        "The exact current Thread tip cannot be reopened.",
      );
    }
    try {
      await assertThreadSnapshotLineageIntact(snapshot, this.dependencies.snapshots);
      const resolved = await resolveStaticMechanicalCloseoutEvidence(
        this.dependencies,
        {
          project,
          basis,
          snapshot,
        },
      );
      const reject = staticMechanicalCloseoutAdmission(resolved, "reject");
      const accept = resolved.acceptanceEligible
        ? staticMechanicalCloseoutAdmission(resolved, "accept")
        : undefined;
      return deepFreeze({
        status: "resolved" as const,
        selected: {
          family: "static-mechanical" as const,
          basis: resolved.basis,
          acceptanceEligibility: resolved.acceptanceEligible,
          criteria: resolved.criteria,
          proofLimitations: resolved.proofLimitations,
          evidence: {
            canonicalStep: viewEvidence(resolved.canonicalStep),
            sealedProof: viewEvidence(resolved.sealedProof),
            executionEvidence: viewEvidence(resolved.executionEvidence),
            evaluationCapture: viewEvidence(resolved.evaluationCapture),
          },
          ...(accept === undefined ? {} : {
            accept: {
              admission: accept,
              decisionParameters: encodeStaticMechanicalEvaluationCloseoutAdmission(
                accept,
              ),
            },
          }),
          reject: {
            admission: reject,
            decisionParameters: encodeStaticMechanicalEvaluationCloseoutAdmission(
              reject,
            ),
          },
        },
      });
    } catch (error) {
      if (error instanceof StaticMechanicalCloseoutResolutionError) {
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

function parseRequest(value: unknown): ProjectEvaluationCloseoutReviewRequest {
  const root = exactRecord(value, ["projectId"], "$evaluationCloseoutReview");
  return { projectId: safeId(root.projectId, "$evaluationCloseoutReview.projectId") };
}

async function readExactSnapshot(
  store: EvaluationCloseoutReviewSnapshotStore,
  id: string,
): Promise<ThreadSnapshot | undefined> {
  const snapshot = store.getFresh === undefined
    ? await store.get(id)
    : await store.getFresh(id);
  return snapshot === undefined ? undefined : validateThreadSnapshot(snapshot);
}

function viewEvidence(artifact: {
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
): ProjectEvaluationCloseoutReviewResult {
  return {
    status: "unavailable",
    family: "static-mechanical",
    diagnostic: { code, message },
  };
}

function unresolved(
  code: string,
  message: string,
): ProjectEvaluationCloseoutReviewResult {
  return {
    status: "unresolved",
    family: "static-mechanical",
    diagnostic: { code, message },
  };
}
